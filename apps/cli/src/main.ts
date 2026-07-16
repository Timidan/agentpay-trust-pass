#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  AgentPayApiError,
  AgentPayHttpClient,
  PaymentAuditError,
  checkedX402Call,
  loadCasperSignerFromPem,
  type CasperSigner,
  type CheckPaymentInput
} from "@agent-pay/client";
import { verifyPurchaseReceipt } from "@agent-pay/core";
import { OperatorApiError, OperatorClient, type ProviderDecisionInput } from "./operatorClient.js";
import {
  paymentVerdictExitCode,
  settlementVerdictExitCode,
  writeError,
  writeResult,
  type CommandError,
  type CommandResult,
  type ExitCode
} from "./output.js";

const DEFAULT_API_URL = "http://127.0.0.1:4021";
const HELP = `Usage:
  agentpay check --file <input.json>
  agentpay verify-settlement --check <id> --tx <hash>
  agentpay call --url <https://service> --key <secret.pem> [--method GET|POST]
  agentpay policy show
  agentpay policy set --file <policy.json> --key <secret.pem>
  agentpay provider list
  agentpay provider pin|deny --origin <origin> --payee <address> --asset <hash> --ceiling <amount> --key <secret.pem>
  agentpay receipt show --id <receipt-id>
  agentpay receipt verify --file <receipt.json>

Options:
  --api-url <origin>       AgentPay API origin
  --token <token>          Scoped agent token
  --session-token <token>  Operator session token
  --json                   Canonical JSON output
  --help                   Show this help`;

type CliOptions = {
  json?: boolean;
  help?: boolean;
  file?: string;
  check?: string;
  tx?: string;
  id?: string;
  key?: string;
  url?: string;
  method?: string;
  body?: string;
  "body-file"?: string;
  header?: string[];
  "api-url"?: string;
  token?: string;
  "session-token"?: string;
  origin?: string;
  payee?: string;
  asset?: string;
  "path-prefix"?: string;
  ceiling?: string;
  expires?: string;
  "expires-in"?: string;
  "prompted-by-check"?: string;
  "max-response-bytes"?: string;
  "timeout-ms"?: string;
};

class CliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CliError";
  }
}

async function main(args: string[]): Promise<void> {
  const jsonRequested = args.includes("--json") || !process.stdout.isTTY;
  try {
    const parsed = parseCliArgs(args);
    const json = parsed.options.json === true || !process.stdout.isTTY;
    const result = parsed.options.help || parsed.positionals.length === 0
      ? { value: { usage: HELP }, exitCode: 0 as const, summary: HELP }
      : await dispatch(parsed.positionals, parsed.options);
    writeResult(result, json);
    process.exitCode = result.exitCode;
  } catch (error) {
    const mapped = mapError(error);
    writeError(mapped.error, jsonRequested);
    process.exitCode = mapped.exitCode;
  }
}

function parseCliArgs(args: string[]): { positionals: string[]; options: CliOptions } {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        file: { type: "string" },
        check: { type: "string" },
        tx: { type: "string" },
        id: { type: "string" },
        key: { type: "string" },
        url: { type: "string" },
        method: { type: "string" },
        body: { type: "string" },
        "body-file": { type: "string" },
        header: { type: "string", multiple: true },
        "api-url": { type: "string" },
        token: { type: "string" },
        "session-token": { type: "string" },
        origin: { type: "string" },
        payee: { type: "string" },
        asset: { type: "string" },
        "path-prefix": { type: "string" },
        ceiling: { type: "string" },
        expires: { type: "string" },
        "expires-in": { type: "string" },
        "prompted-by-check": { type: "string" },
        "max-response-bytes": { type: "string" },
        "timeout-ms": { type: "string" }
      }
    });
    return { positionals: parsed.positionals, options: parsed.values as CliOptions };
  } catch {
    throw new CliError("invalid_options", "Invalid command options");
  }
}

async function dispatch(positionals: string[], options: CliOptions): Promise<CommandResult> {
  const [command, action, ...extra] = positionals;
  if (command === "check" && action === undefined) return checkCommand(options);
  if (command === "verify-settlement" && action === undefined) return verifySettlementCommand(options);
  if (command === "call" && action === undefined) return callCommand(options);
  if (command === "policy" && extra.length === 0 && (action === "show" || action === "set")) {
    return policyCommand(action, options);
  }
  if (command === "provider" && extra.length === 0 && (action === "list" || action === "pin" || action === "deny")) {
    return providerCommand(action, options);
  }
  if (command === "receipt" && extra.length === 0 && (action === "show" || action === "verify")) {
    return receiptCommand(action, options);
  }
  throw new CliError("unknown_command", "Unknown or incomplete AgentPay command");
}

async function checkCommand(options: CliOptions): Promise<CommandResult> {
  const input = await readJson(required(options.file, "check requires --file"));
  if (!isRecord(input) || !isRecord(input.request) || !isRecord(input.paymentRequired)) {
    throw new CliError("invalid_input", "Check input must contain request and paymentRequired objects");
  }
  const checkInput = input as unknown as CheckPaymentInput;
  const result = await agentClient(options).check({
    ...checkInput,
    idempotencyKey: nonEmpty(checkInput.idempotencyKey) ? checkInput.idempotencyKey : randomUUID()
  });
  const verdict = result.check.decision.verdict;
  return {
    value: result,
    exitCode: paymentVerdictExitCode(verdict),
    summary: `${verdict.toUpperCase()} ${result.check.id}`
  };
}

async function verifySettlementCommand(options: CliOptions): Promise<CommandResult> {
  const checkId = required(options.check, "verify-settlement requires --check");
  const transactionHash = normalizeHash(required(options.tx, "verify-settlement requires --tx"), "transaction hash");
  const result = await agentClient(options).verifySettlement(checkId, transactionHash);
  const verdict = result.proof.verdict;
  return {
    value: result,
    exitCode: settlementVerdictExitCode(verdict),
    summary: `${verdict.toUpperCase()} ${checkId}`
  };
}

async function callCommand(options: CliOptions): Promise<CommandResult> {
  const url = validHttpUrl(required(options.url, "call requires --url"));
  const signer = await readSigner(options);
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") throw new CliError("invalid_input", "call --method must be GET or POST");
  if (options.body !== undefined && options["body-file"] !== undefined) {
    throw new CliError("invalid_input", "call accepts only one of --body or --body-file");
  }
  const bodyText = options["body-file"] === undefined
    ? options.body
    : await readText(options["body-file"], "Could not read the requested request-body file");
  const body = bodyText === undefined ? undefined : parseJsonOrText(bodyText);
  const result = await checkedX402Call({
    url,
    method,
    body,
    headers: parseHeaders(options.header ?? []),
    signer,
    api: await callAgentClient(options, signer),
    maxResponseBytes: options["max-response-bytes"] === undefined
      ? undefined
      : positiveInteger(options["max-response-bytes"], "max response bytes"),
    requestTimeoutMs: options["timeout-ms"] === undefined
      ? undefined
      : positiveInteger(options["timeout-ms"], "request timeout milliseconds")
  });
  const contentType = result.response.headers.get("content-type");
  const responseText = await result.response.text();
  const serviceBody = contentType?.toLowerCase().includes("application/json")
    ? parseJsonOrText(responseText)
    : responseText;
  const value = {
    check: result.check,
    settlement: result.settlement,
    observation: result.observation,
    receipt: result.receipt,
    serviceResponse: {
      status: result.response.status,
      contentType,
      body: serviceBody
    }
  };
  return {
    value,
    exitCode: result.response.ok ? 0 : 4,
    summary: `MATCH ${result.check.id}; HTTP ${result.response.status}`
  };
}

async function policyCommand(action: "show" | "set", options: CliOptions): Promise<CommandResult> {
  const client = operatorClient(options);
  if (action === "show") {
    const token = await operatorToken(client, options);
    const policy = await client.currentPolicy(token);
    if (!policy) throw new CliError("policy_not_found", "No signed operator policy is installed");
    return { value: { policy }, exitCode: 0, summary: `Policy revision ${policy.revision}` };
  }

  const input = await readJson(required(options.file, "policy set requires --file"));
  if (!isRecord(input)) throw new CliError("invalid_input", "Policy input must be a JSON object");
  const { signer, token } = await operatorSigningSession(client, options);
  const policy = await client.installPolicy(input, signer, token);
  return { value: { policy }, exitCode: 0, summary: `Installed policy revision ${policy.revision}` };
}

async function providerCommand(
  action: "list" | "pin" | "deny",
  options: CliOptions
): Promise<CommandResult> {
  const client = operatorClient(options);
  if (action === "list") {
    const token = await operatorToken(client, options);
    const decisions = await client.providerDecisions(token);
    return { value: { decisions }, exitCode: 0, summary: `${decisions.length} provider decisions` };
  }

  const origin = exactOrigin(required(options.origin, `provider ${action} requires --origin`));
  const input: ProviderDecisionInput = {
    kind: action,
    origin,
    payee: normalizeAccountAddress(required(options.payee, `provider ${action} requires --payee`)),
    asset: normalizeHash(required(options.asset, `provider ${action} requires --asset`), "asset"),
    resourcePathPrefix: pathPrefix(options["path-prefix"]),
    perCallCeiling: decimalAmount(required(options.ceiling, `provider ${action} requires --ceiling`)),
    expiresAt: expiry(options),
    promptedByCheckId: options["prompted-by-check"]?.trim() || "cli-manual"
  };
  const { signer, token } = await operatorSigningSession(client, options);
  const decision = await client.installProviderDecision(input, signer, token);
  return { value: { decision }, exitCode: 0, summary: `${action.toUpperCase()} revision ${decision.revision}` };
}

async function receiptCommand(action: "show" | "verify", options: CliOptions): Promise<CommandResult> {
  if (action === "show") {
    const receiptId = required(options.id, "receipt show requires --id");
    const record = await agentClient(options).getReceiptRecord(receiptId);
    return { value: record, exitCode: 0, summary: `Receipt ${receiptId}` };
  }
  const input = await readJson(required(options.file, "receipt verify requires --file"));
  const receipt = isRecord(input) && "receipt" in input ? input.receipt : input;
  const verification = verifyPurchaseReceipt(receipt);
  return {
    value: verification,
    exitCode: verification.verified ? 0 : 4,
    summary: verification.verified ? "VERIFIED" : `INVALID (${verification.errors.length} errors)`
  };
}

function agentClient(options: CliOptions): AgentPayHttpClient {
  const token = configuredApiToken(options);
  if (!token) throw new CliError("configuration_required", "An AgentPay bearer token is required");
  return createAgentClient(options, token);
}

async function callAgentClient(options: CliOptions, signer: CasperSigner): Promise<AgentPayHttpClient> {
  const token = configuredApiToken(options) ?? await operatorClient(options).createSession(signer);
  return createAgentClient(options, token);
}

function configuredApiToken(options: CliOptions): string | undefined {
  return [
    options.token,
    process.env.AGENT_PAY_API_TOKEN,
    options["session-token"],
    process.env.AGENT_PAY_OPERATOR_SESSION_TOKEN
  ].find((value) => value?.trim())?.trim();
}

function createAgentClient(options: CliOptions, token: string): AgentPayHttpClient {
  try {
    return new AgentPayHttpClient({ baseUrl: apiUrl(options), token });
  } catch {
    throw new CliError("configuration_required", "AgentPay API configuration is invalid");
  }
}

function operatorClient(options: CliOptions): OperatorClient {
  try {
    return new OperatorClient({ baseUrl: apiUrl(options) });
  } catch {
    throw new CliError("configuration_required", "AgentPay operator API configuration is invalid");
  }
}

async function operatorToken(client: OperatorClient, options: CliOptions): Promise<string> {
  const configuredToken = options["session-token"] ?? process.env.AGENT_PAY_OPERATOR_SESSION_TOKEN;
  if (configuredToken) return configuredToken;
  const signer = await readSigner(options);
  return client.createSession(signer);
}

async function operatorSigningSession(
  client: OperatorClient,
  options: CliOptions
): Promise<{ token: string; signer: CasperSigner }> {
  const signer = await readSigner(options);
  const configuredToken = options["session-token"] ?? process.env.AGENT_PAY_OPERATOR_SESSION_TOKEN;
  return { token: configuredToken ?? await client.createSession(signer), signer };
}

async function readSigner(options: CliOptions): Promise<CasperSigner> {
  const keyPath = options.key ?? process.env.CASPER_SECRET_KEY_PATH;
  if (!keyPath) throw new CliError("configuration_required", "A Casper secret key is required for this command");
  const pem = await readText(keyPath, "Could not read the configured Casper secret key");
  try {
    return loadCasperSignerFromPem(pem);
  } catch {
    throw new CliError("configuration_required", "The configured Casper secret key is invalid");
  }
}

function apiUrl(options: CliOptions): string {
  return options["api-url"] ?? process.env.AGENT_PAY_API_URL ?? DEFAULT_API_URL;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readText(path, "Could not read the requested JSON file");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliError("invalid_input", "The requested file does not contain valid JSON");
  }
}

async function readText(path: string, errorMessage: string): Promise<string> {
  try {
    return await readFile(resolve(process.cwd(), path), "utf8");
  } catch {
    throw new CliError("invalid_input", errorMessage);
  }
}

function required(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new CliError("invalid_input", message);
  return value.trim();
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeHash(value: string, label: string): string {
  const normalized = value.toLowerCase().replace(/^hash-/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new CliError("invalid_input", `${label} must be 64 hexadecimal characters`);
  return normalized;
}

function normalizeAccountAddress(value: string): string {
  const normalized = value.toLowerCase().replace(/^account-hash-/, "00");
  if (!/^00[0-9a-f]{64}$/.test(normalized)) {
    throw new CliError("invalid_input", "payee must be a Casper account address");
  }
  return normalized;
}

function validHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) throw new Error();
    return url.toString();
  } catch {
    throw new CliError("invalid_input", "call --url must be an HTTP(S) URL");
  }
}

function exactOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== value.replace(/\/+$/, "") || (url.protocol !== "http:" && url.protocol !== "https:")) throw new Error();
    return url.origin;
  } catch {
    throw new CliError("invalid_input", "provider origin must be an exact HTTP(S) origin");
  }
}

function pathPrefix(value: string | undefined): string | null {
  if (value === undefined || value === "null") return null;
  if (!value.startsWith("/")) throw new CliError("invalid_input", "provider path prefix must start with /");
  return value;
}

function decimalAmount(value: string): string {
  if (!/^[1-9][0-9]*$/.test(value)) throw new CliError("invalid_input", "provider ceiling must be a positive base-unit amount");
  return value;
}

function expiry(options: CliOptions): string {
  if (options.expires && options["expires-in"]) {
    throw new CliError("invalid_input", "provider accepts only one of --expires or --expires-in");
  }
  if (options.expires) {
    const milliseconds = Date.parse(options.expires);
    if (!Number.isFinite(milliseconds)) throw new CliError("invalid_input", "provider expiry must be an ISO timestamp");
    return new Date(milliseconds).toISOString();
  }
  const seconds = options["expires-in"] === undefined
    ? 30 * 24 * 60 * 60
    : positiveInteger(options["expires-in"], "provider expiry seconds");
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function positiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new CliError("invalid_input", `${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CliError("invalid_input", `${label} is too large`);
  return parsed;
}

function parseHeaders(values: string[]): Headers {
  const headers = new Headers();
  for (const value of values) {
    const separator = value.indexOf(":");
    if (separator <= 0) throw new CliError("invalid_input", "call headers must use 'Name: value'");
    const name = value.slice(0, separator).trim();
    const content = value.slice(separator + 1).trim();
    if (name.toLowerCase() === "payment-signature") {
      throw new CliError("invalid_input", "PAYMENT-SIGNATURE is controlled by AgentPay");
    }
    try {
      headers.append(name, content);
    } catch {
      throw new CliError("invalid_input", "call contains an invalid header");
    }
  }
  return headers;
}

function parseJsonOrText(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapError(error: unknown): { error: CommandError; exitCode: ExitCode } {
  if (error instanceof PaymentAuditError) {
    const exitCode = error.verdict === "review" || error.verdict === "pending"
      ? 2
      : error.verdict === "block" || error.verdict === "mismatch"
        ? 3
        : 4;
    return {
      exitCode,
      error: {
        code: "payment_audit_failed",
        message: error.message,
        verdict: error.verdict,
        checkId: error.checkId
      }
    };
  }
  if (error instanceof AgentPayApiError || error instanceof OperatorApiError) {
    return {
      exitCode: 4,
      error: {
        code: "api_error",
        message: error.message,
        retryable: error.retryable
      }
    };
  }
  if (error instanceof CliError) {
    return { exitCode: 4, error: { code: error.code, message: error.message } };
  }
  return { exitCode: 4, error: { code: "client_error", message: "AgentPay could not complete the command" } };
}

await main(process.argv.slice(2));
