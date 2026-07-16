import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactHash,
  normalizeOriginalRequest,
  normalizePaymentRequired,
  verifyCasperMessageSignature,
  type AuthorizationIntent,
  type OriginalRequestInput
} from "@agent-pay/core";

const ROOT = resolve(import.meta.dirname, "../../..");
const TOKEN = "test-agent-token-that-is-longer-than-32-characters";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("agentpay CLI", () => {
  it.each([
    ["pay", 0],
    ["review", 2],
    ["block", 3]
  ] as const)("maps a %s payment check to exit code %s", async (verdict, expectedCode) => {
    await withApi({ verdict }, async (apiUrl) => {
      const file = await inputFile(checkInput());
      const result = await runCli(["check", "--file", file, "--json"], apiUrl);

      expect(result.code).toBe(expectedCode);
      expect(JSON.parse(result.stdout)).toMatchObject({ check: { decision: { verdict } } });
      expect(result.stderr).toBe("");
    });
  });

  it.each([
    ["match", 0],
    ["pending", 2],
    ["mismatch", 3],
    ["unverifiable", 4]
  ] as const)("maps a %s settlement to exit code %s", async (verdict, expectedCode) => {
    await withApi({ settlementVerdict: verdict }, async (apiUrl) => {
      const result = await runCli([
        "verify-settlement",
        "--check",
        "check-1",
        "--tx",
        "f".repeat(64),
        "--json"
      ], apiUrl);

      expect(result.code).toBe(expectedCode);
      expect(JSON.parse(result.stdout)).toMatchObject({ proof: { verdict } });
    });
  });

  it("returns a stable client-error code without echoing credentials", async () => {
    const secret = "never-print-this-token-value-123456789";
    const result = await runCli(["check", "--file", "/missing/private/key.json", "--token", secret, "--json"], "http://127.0.0.1:1");

    expect(result.code).toBe(4);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(`${result.stdout}${result.stderr}`).not.toContain("/missing/private/key.json");
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("shows receipts and maps invalid offline receipt verification to exit code 4", async () => {
    await withApi({}, async (apiUrl) => {
      const shown = await runCli(["receipt", "show", "--id", "receipt-1", "--json"], apiUrl);
      expect(shown.code).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({ receipt: { receiptId: "receipt-1" } });

      const file = await inputFile({ receiptId: "not-a-valid-receipt" });
      const verified = await runCli(["receipt", "verify", "--file", file, "--json"], apiUrl);
      expect(verified.code).toBe(4);
      expect(JSON.parse(verified.stdout)).toMatchObject({ verified: false });
    });
  });

  it("shows operator state using a session token without reading a secret key", async () => {
    const behavior: ApiBehavior = { policy: policyFixture(), decisions: [] };
    await withApi(behavior, async (apiUrl) => {
      const policy = await runCli(["policy", "show", "--json"], apiUrl);
      const providers = await runCli(["provider", "list", "--json"], apiUrl);

      expect(policy.code).toBe(0);
      expect(JSON.parse(policy.stdout)).toMatchObject({ policy: { revision: 1 } });
      expect(providers.code).toBe(0);
      expect(JSON.parse(providers.stdout)).toEqual({ decisions: [] });
    });
  });

  it("signs policy and provider revisions locally", async () => {
    const behavior: ApiBehavior = { policy: null, decisions: [] };
    await withApi(behavior, async (apiUrl) => {
      const key = await secretKeyFile();
      const policyInput = await inputFile({
        assetDailyCaps: { ["5".repeat(64)]: "1000000" },
        maximumConcurrentReservations: 50
      });
      const policyResult = await runCli(["policy", "set", "--file", policyInput, "--key", key, "--json"], apiUrl);
      expect(policyResult.code).toBe(0);
      const policy = JSON.parse(policyResult.stdout).policy;
      expect(policy).toMatchObject({ revision: 1, maximumConcurrentReservations: 50 });
      expect(verifyCasperMessageSignature({
        message: policy.signatureMessage,
        publicKeyHex: policy.operatorPublicKey,
        signatureHex: policy.signature
      })).toBe(true);

      const providerResult = await runCli([
        "provider",
        "pin",
        "--origin",
        "https://service.example",
        "--payee",
        `00${"3".repeat(64)}`,
        "--asset",
        "5".repeat(64),
        "--ceiling",
        "1000",
        "--prompted-by-check",
        "check-1",
        "--key",
        key,
        "--json"
      ], apiUrl);
      expect(providerResult.code).toBe(0);
      const decision = JSON.parse(providerResult.stdout).decision;
      expect(decision).toMatchObject({ kind: "pin", revision: 1, promptedByCheckId: "check-1" });
      expect(verifyCasperMessageSignature({
        message: decision.signatureMessage,
        publicKeyHex: decision.operatorPublicKey,
        signatureHex: decision.signature
      })).toBe(true);
    });
  });

  it("runs the complete checked-call sequence with a local signer", async () => {
    await withCheckedCallServices(async ({ apiUrl, serviceUrl }) => {
      const key = await secretKeyFile();
      const result = await runCli(["call", "--url", serviceUrl, "--key", key, "--json"], apiUrl);

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        settlement: { proof: { verdict: "match" } },
        receipt: { receiptId: "receipt-checked" },
        serviceResponse: { status: 200, body: { answer: "paid" } }
      });
    });
  });
});

type ApiBehavior = {
  verdict?: "pay" | "review" | "block";
  settlementVerdict?: "match" | "pending" | "mismatch" | "unverifiable";
  policy?: Record<string, unknown> | null;
  decisions?: Array<Record<string, unknown>>;
  paymentRequired?: Record<string, unknown>;
};

async function withApi<T>(behavior: ApiBehavior, fn: (url: string) => Promise<T>): Promise<T> {
  const server = createServer(async (request, response) => handleRequest(request, response, behavior));
  await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API did not bind");
  try {
    const url = `http://127.0.0.1:${address.port}`;
    return await fn(url);
  } finally {
    await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, behavior: ApiBehavior): Promise<void> {
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    sendJson(response, 401, { code: "invalid_credentials" });
    return;
  }
  if (request.url === "/v1/checks") {
    const body = await readRequestJson(request);
    if (behavior.paymentRequired) {
      const originalRequest = normalizeOriginalRequest(body.request as OriginalRequestInput);
      const normalized = normalizePaymentRequired(body.paymentRequired, originalRequest);
      if (!normalized.ok) throw new Error("Checked-call test payment requirement did not normalize");
      const authorization = body.authorization as AuthorizationIntent;
      const decisionContent = {
        checkId: "check-1",
        verdict: "pay" as const,
        basis: "operator_pinned" as const,
        reasons: [],
        advisories: [],
        policyHash: "a".repeat(64),
        authorizationDigest: authorization.digest,
        reservation: { amount: normalized.terms.amount, expiresAt: "2026-07-16T00:00:00.000Z" },
        decidedAt: "2026-07-15T21:00:00.000Z"
      };
      sendJson(response, 201, {
        created: true,
        check: {
          id: "check-1",
          request: originalRequest,
          terms: normalized.terms,
          authorization,
          decision: { ...decisionContent, decisionHash: artifactHash(decisionContent) },
          status: "reserved"
        }
      });
      return;
    }
    sendJson(response, 201, { created: true, check: { id: "check-1", decision: { verdict: behavior.verdict ?? "pay" } } });
    return;
  }
  if (request.url === "/v1/checks/check-1/verify-settlement") {
    await consume(request);
    const verdict = behavior.settlementVerdict ?? "match";
    sendJson(response, 200, {
      created: true,
      check: { id: "check-1", status: verdict === "match" ? "settled" : verdict },
      proof: { verdict, transactionHash: "f".repeat(64) },
      receipt: null
    });
    return;
  }
  if (request.url === "/v1/checks/check-1/response-observations") {
    await consume(request);
    sendJson(response, 201, {
      created: true,
      observation: { checkId: "check-1" },
      receipt: { receiptId: "receipt-checked", checkId: "check-1" }
    });
    return;
  }
  if (request.url === "/v1/receipts/receipt-1") {
    sendJson(response, 200, { receipt: { receiptId: "receipt-1", checkId: "check-1" } });
    return;
  }
  if (request.url === "/v1/policies/current") {
    if (behavior.policy === null) sendJson(response, 404, { code: "policy_not_found", message: "No policy" });
    else sendJson(response, 200, { policy: behavior.policy ?? policyFixture() });
    return;
  }
  if (request.url === "/v1/provider-decisions" && request.method === "GET") {
    sendJson(response, 200, { decisions: behavior.decisions ?? [] });
    return;
  }
  if (request.url === "/v1/auth/challenges") {
    await consume(request);
    sendJson(response, 201, { challengeId: "challenge-1", message: "AgentPay CLI test challenge" });
    return;
  }
  if (request.url === "/v1/policies/revisions") {
    const body = await readRequestJson(request);
    sendJson(response, 201, { policy: body.policy });
    return;
  }
  if (request.url === "/v1/provider-decisions" && request.method === "POST") {
    const body = await readRequestJson(request);
    sendJson(response, 201, { decision: body.decision });
    return;
  }
  sendJson(response, 404, { code: "not_found" });
}

async function runCli(
  args: string[],
  apiUrl: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "apps/cli/src/main.ts", ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        AGENT_PAY_API_URL: apiUrl,
        AGENT_PAY_API_TOKEN: TOKEN,
        AGENT_PAY_OPERATOR_SESSION_TOKEN: TOKEN,
        NO_COLOR: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code: code ?? 4, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function inputFile(value: unknown): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "agentpay-cli-"));
  temporaryDirectories.push(directory);
  const path = resolve(directory, "input.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

async function secretKeyFile(): Promise<string> {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const directory = await mkdtemp(resolve(tmpdir(), "agentpay-cli-key-"));
  temporaryDirectories.push(directory);
  const path = resolve(directory, "secret.pem");
  await writeFile(path, pem, { encoding: "utf8", mode: 0o600 });
  return path;
}

function checkInput() {
  return {
    request: {
      method: "GET",
      url: "https://service.example/resource",
      bodyHash: "0".repeat(64),
      bodyBytes: 0,
      capturedAt: "2026-07-15T21:00:00.000Z",
      adapterVersion: "cli-test/1"
    },
    paymentRequired: { x402Version: 2, accepts: [] },
    authorization: null,
    idempotencyKey: "cli-check-1"
  };
}

async function consume(request: IncomingMessage): Promise<void> {
  for await (const _chunk of request) {
    // Drain the request body before responding.
  }
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return JSON.parse(body) as Record<string, unknown>;
}

async function withCheckedCallServices(
  fn: (input: { apiUrl: string; serviceUrl: string }) => Promise<void>
): Promise<void> {
  let paid = false;
  let paymentRequired: Record<string, unknown>;
  const service = createServer((request, response) => {
    if (!request.headers["payment-signature"]) {
      sendJson(response, 402, { error: "payment_required" }, {
        "payment-required": Buffer.from(JSON.stringify(paymentRequired), "utf8").toString("base64")
      });
      return;
    }
    paid = true;
    sendJson(response, 200, { transactionHash: "f".repeat(64), answer: "paid" });
  });
  await new Promise<void>((resolveListening) => service.listen(0, "127.0.0.1", resolveListening));
  const serviceAddress = service.address();
  if (!serviceAddress || typeof serviceAddress === "string") throw new Error("Test service did not bind");
  const serviceUrl = `http://127.0.0.1:${serviceAddress.port}/resource`;
  paymentRequired = {
    x402Version: 2,
    resource: { url: serviceUrl, description: "Paid test service", mimeType: "application/json" },
    accepts: [{
      scheme: "exact",
      network: "casper:casper-test",
      asset: "5".repeat(64),
      amount: "100",
      payTo: `00${"3".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Test token", version: "1", decimals: "9", symbol: "TEST" }
    }]
  };
  try {
    await withApi({ paymentRequired }, async (apiUrl) => fn({ apiUrl, serviceUrl }));
    expect(paid).toBe(true);
  } finally {
    await new Promise<void>((resolveClosed, reject) => service.close((error) => error ? reject(error) : resolveClosed()));
  }
}

function policyFixture(): Record<string, unknown> {
  return {
    policyId: "policy-1",
    operatorPublicKey: `01${"1".repeat(64)}`,
    revision: 1,
    policyHash: "a".repeat(64)
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}
