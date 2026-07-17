import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadCasperSignerFromPem } from "@agent-pay/client";
import {
  buildAuthorizationIntent,
  type PaymentTerms
} from "../packages/agent-pay-core/src/index.js";

const apiUrl = normalizedApiUrl(process.env.AGENTPAY_E2E_API_URL);
const keyPath = process.env.CASPER_SECRET_KEY_PATH;
if (!keyPath) throw new Error("CASPER_SECRET_KEY_PATH is required");

const signer = loadCasperSignerFromPem(await readFile(resolve(keyPath), "utf8"));
const cliPath = resolve("apps/cli/dist/main.js");
const workingDirectory = await mkdtemp(join(tmpdir(), "agentpay-agent-cli-"));

let operatorToken: string | null = null;
let agentToken: string | null = null;
let agentTokenId: string | null = null;
let revoked = false;

try {
  const session = runCli(["session", "create"], {});
  operatorToken = stringField(session, "token");

  const operatorEnv = { AGENT_PAY_OPERATOR_SESSION_TOKEN: operatorToken };
  const policyResult = runCli(["policy", "show"], operatorEnv);
  const policy = record(policyResult.policy, "policy");
  const providerResult = runCli(["provider", "list"], operatorEnv);
  assert.ok(Array.isArray(providerResult.decisions), "provider list did not return decisions");

  const issued = runCli([
    "agent-token",
    "issue",
    "--name",
    `live-e2e-${Date.now()}`,
    "--scope",
    "checks:write",
    "--payer",
    signer.publicKeyHex,
    "--expires-in",
    "600"
  ], operatorEnv);
  agentToken = stringField(issued, "token");
  const issuedRecord = record(issued.record, "issued token record");
  agentTokenId = stringField(issuedRecord, "id");
  assert.deepEqual(issuedRecord.scopes, ["checks:write"]);
  assert.deepEqual(issuedRecord.allowedPayerPublicKeys, [signer.publicKeyHex]);

  const listed = runCli(["agent-token", "list"], operatorEnv);
  const listedRecords = arrayField(listed, "records").map((value) => record(value, "listed token"));
  assert.ok(
    listedRecords.some((value) => value.id === agentTokenId),
    "issued agent token was not returned by the CLI"
  );
  assert.ok(
    listedRecords.every((value) => !("tokenHash" in value)),
    "agent-token list exposed a bearer-token hash"
  );

  const requestedSubject = process.env.AGENTPAY_E2E_SUBJECT?.trim() || "WCSPR";
  const quoteSubject = await resolveTokenSubject(requestedSubject);
  const quote = await fetchJson(`${apiUrl}/reports/quote?${new URLSearchParams({
    subject: quoteSubject,
    network: process.env.AGENTPAY_E2E_EVIDENCE_NETWORK?.trim() || "casper-mainnet"
  })}`);
  const paymentResource = record(quote.paymentResource, "quote payment resource");
  const paymentResourceUrl = stringField(paymentResource, "url");

  const probe = await fetchJson(`${apiUrl}/v1/probes`, {
    method: "POST",
    headers: bearerHeaders(agentToken),
    body: JSON.stringify({ url: paymentResourceUrl, method: "POST", body: {} })
  });
  const terms = record(probe.terms, "probe payment terms") as PaymentTerms;
  const authorization = buildAuthorizationIntent({
    terms,
    payerPublicKey: signer.publicKeyHex,
    nowEpochSeconds: Math.floor(Date.now() / 1_000),
    nonce: randomBytes(32).toString("hex")
  });
  const checkFile = join(workingDirectory, "check.json");
  await writeFile(checkFile, JSON.stringify({
    request: record(probe.request, "probe request"),
    paymentRequired: record(probe.paymentRequired, "probe payment requirement"),
    authorization
  }), { encoding: "utf8", mode: 0o600 });

  const checkResult = runCli(
    ["check", "--file", checkFile],
    { AGENT_PAY_API_TOKEN: agentToken },
    new Set([0, 2, 3])
  );
  const check = record(checkResult.check, "payment check");
  const decision = record(check.decision, "payment decision");
  const verdict = stringField(decision, "verdict");
  assert.ok(["pay", "review", "block"].includes(verdict), "CLI returned an unknown verdict");

  const isolated = runCli(
    ["policy", "show"],
    { AGENT_PAY_OPERATOR_SESSION_TOKEN: agentToken },
    new Set([4])
  );
  assert.match(stringField(record(isolated.error, "agent admin error"), "message"), /operator session/i);

  runCli(["agent-token", "revoke", "--id", agentTokenId], operatorEnv);
  revoked = true;
  const revokedResponse = await fetch(`${apiUrl}/v1/checks/${encodeURIComponent(stringField(check, "id"))}`, {
    headers: { authorization: `Bearer ${agentToken}` },
    signal: AbortSignal.timeout(15_000)
  });
  assert.equal(revokedResponse.status, 401, "revoked agent token could still authenticate");
  await revokedResponse.body?.cancel();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    apiUrl,
    operatorPublicKey: signer.publicKeyHex,
    policyRevision: numberField(policy, "revision"),
    providerDecisionCount: providerResult.decisions.length,
    agentTokenId,
    checkId: stringField(check, "id"),
    verdict,
    adminIsolation: true,
    revocationEnforced: true
  })}\n`);
} finally {
  if (operatorToken && agentTokenId && !revoked) {
    try {
      runCli(
        ["agent-token", "revoke", "--id", agentTokenId],
        { AGENT_PAY_OPERATOR_SESSION_TOKEN: operatorToken }
      );
    } catch {
      process.stderr.write(`Cleanup failed for agent token ${agentTokenId}\n`);
    }
  }
  await rm(workingDirectory, { recursive: true, force: true });
}

function runCli(
  args: string[],
  extraEnv: NodeJS.ProcessEnv,
  acceptedExitCodes = new Set([0])
): Record<string, unknown> {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--api-url", apiUrl, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 60_000
  });
  if (result.error) throw result.error;
  const status = result.status ?? 4;
  let output: unknown;
  try {
    output = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(`AgentPay CLI returned invalid JSON (exit ${status})`);
  }
  if (!acceptedExitCodes.has(status)) {
    const error = record(record(output, "CLI output").error, "CLI error");
    throw new Error(`AgentPay CLI failed (${status}): ${String(error.message ?? "unknown error")}`);
  }
  return record(output, "CLI output");
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    const error = record(body, "HTTP error");
    throw new Error(`${url} returned HTTP ${response.status}: ${String(error.message ?? error.error ?? "request failed")}`);
  }
  return record(body, "HTTP response");
}

async function resolveTokenSubject(subject: string): Promise<string> {
  if (/^(?:hash-)?[0-9a-f]{64}$/i.test(subject)) return subject;
  if (!/^[A-Za-z][A-Za-z0-9._]{0,15}$/.test(subject)) {
    throw new Error("AGENTPAY_E2E_SUBJECT must be a token symbol or package hash");
  }
  const resolved = await fetchJson(`${apiUrl}/resolve?${new URLSearchParams({ symbol: subject })}`);
  return stringField(resolved, "packageHash");
}

function normalizedApiUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error("AGENTPAY_E2E_API_URL is required");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("AGENTPAY_E2E_API_URL must be an HTTPS URL without credentials, query, or fragment");
  }
  return url.toString().replace(/\/+$/, "");
}

function bearerHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return candidate;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const candidate = value[field];
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) {
    throw new Error(`${field} must be a safe integer`);
  }
  return candidate;
}

function arrayField(value: Record<string, unknown>, field: string): unknown[] {
  const candidate = value[field];
  if (!Array.isArray(candidate)) throw new Error(`${field} must be an array`);
  return candidate;
}
