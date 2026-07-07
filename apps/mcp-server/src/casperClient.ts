import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ToolConfigError } from "./errors.js";

const execFileAsync = promisify(execFile);
const DEFAULT_RECORD_SCRIPT = "contracts/agent-pay-registry/scripts/record-decision-testnet.sh";
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export type RecordDecisionInput = {
  datasetId: string;
  datasetRoot: string;
  reportHash: string;
  paymentReceiptHash: string;
  decision: "approved" | "rejected" | "needs_review";
};

export type RecordDecisionResult = {
  mode: "submitted";
  txHash: string;
  hashKind: AgentPaySubmittedHashKind;
  confirmation: AgentPayRegistryConfirmation;
  input: RecordDecisionInput;
};

type AgentPaySubmittedHashKind = "transaction" | "deploy";

type SubmittedHash = {
  value: string;
  kind: AgentPaySubmittedHashKind;
};

export type RegistryStatusCheck = {
  name: string;
  status: "pass" | "fail" | "missing";
  message: string;
};

export type RegistryStatus = {
  status: "ready" | "configuration_required" | "rpc_unavailable";
  reason: string | null;
  checkedAt: string;
  checks: RegistryStatusCheck[];
  registryPackageHash: string | null;
  recordScript: string;
  rpc: {
    url: string;
    apiVersion: string | null;
    chainspecName: string | null;
    latestBlockHeight: number | null;
    latestBlockHash: string | null;
  } | null;
};

export type AgentPayRegistryConfirmation = {
  rpcUrl: string;
  method: "info_get_transaction" | "info_get_deploy";
  apiVersion: string | null;
  executionState: "executed" | "pending" | "unknown";
  blockHash: string | null;
  attempts: number;
  observedAt: string;
};

export async function getRegistryStatus(): Promise<RegistryStatus> {
  const checks: RegistryStatusCheck[] = [];
  const registryPackageHash = process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH ?? null;
  const rpcUrl = process.env.CASPER_RPC_URL ?? null;
  const script = recordScriptPath();

  if (!registryPackageHash) {
    checks.push({
      name: "registry_package",
      status: "missing",
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH is required"
    });
  } else if (!isCasperPackageHash(registryPackageHash)) {
    checks.push({
      name: "registry_package",
      status: "fail",
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars"
    });
  } else {
    checks.push({
      name: "registry_package",
      status: "pass",
      message: "registry package configured"
    });
  }

  if (!rpcUrl) {
    checks.push({
      name: "casper_rpc",
      status: "missing",
      message: "CASPER_RPC_URL is required"
    });
  } else {
    checks.push({
      name: "casper_rpc",
      status: "pass",
      message: rpcUrl
    });
  }

  try {
    await access(script, constants.X_OK);
    checks.push({
      name: "record_script",
      status: "pass",
      message: "record script configured and executable"
    });
  } catch {
    checks.push({
      name: "record_script",
      status: "missing",
      message: "record script must exist and be executable"
    });
  }

  if (!process.env.CASPER_SECRET_KEY_PATH) {
    checks.push({
      name: "casper_secret_key",
      status: "missing",
      message: "CASPER_SECRET_KEY_PATH is required to submit registry decisions"
    });
  } else {
    try {
      await access(process.env.CASPER_SECRET_KEY_PATH, constants.R_OK);
      checks.push({
        name: "casper_secret_key",
        status: "pass",
        message: "CASPER_SECRET_KEY_PATH is configured and readable"
      });
    } catch {
      checks.push({
        name: "casper_secret_key",
        status: "fail",
        message: "CASPER_SECRET_KEY_PATH points to a missing or unreadable key file"
      });
    }
  }

  if (isDefaultRecordScript(script) && !(await canResolveCasperClientCommand())) {
    checks.push({
      name: "casper_client",
      status: "missing",
      message: "configured Casper client must be available to submit registry decisions"
    });
  } else {
    checks.push({
      name: "casper_client",
      status: "pass",
      message: isDefaultRecordScript(script)
        ? "configured Casper client available"
        : "custom record script configured"
    });
  }

  const blockingConfiguration = checks.find((check) => check.status !== "pass");
  if (blockingConfiguration || !rpcUrl) {
    return registryStatus("configuration_required", registryReason(blockingConfiguration), checks, registryPackageHash, script, null);
  }

  let rpcStatus: RegistryStatus["rpc"];
  try {
    rpcStatus = await queryCasperRpcStatus(rpcUrl);
  } catch (error) {
    checks.push({
      name: "rpc_status",
      status: "fail",
      message: error instanceof Error ? error.message : "Casper RPC status check failed"
    });
    return registryStatus("rpc_unavailable", "casper_rpc_status_check_failed", checks, registryPackageHash, script, null);
  }

  checks.push({
    name: "rpc_status",
    status: "pass",
    message: rpcStatus.chainspecName ?? rpcStatus.url
  });

  return registryStatus("ready", null, checks, registryPackageHash, script, rpcStatus);
}

export async function recordAgentPayDecision(input: RecordDecisionInput): Promise<RecordDecisionResult> {
  const registryPackageHash = process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH;
  if (!registryPackageHash) {
    throw new ToolConfigError("AGENT_PAY_REGISTRY_PACKAGE_HASH is required to record an AgentPay decision");
  }
  if (!isCasperPackageHash(registryPackageHash)) {
    throw new ToolConfigError("AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars");
  }
  if (!process.env.CASPER_RPC_URL) {
    throw new ToolConfigError("CASPER_RPC_URL is required to confirm a Casper decision submission");
  }
  if (!process.env.CASPER_SECRET_KEY_PATH) {
    throw new ToolConfigError("CASPER_SECRET_KEY_PATH is required to submit an AgentPay registry decision");
  }
  try {
    await access(process.env.CASPER_SECRET_KEY_PATH, constants.R_OK);
  } catch {
    throw new ToolConfigError("CASPER_SECRET_KEY_PATH points to a missing or unreadable key file");
  }

  const submittedHash = await submitRecordDecisionDeploy(input);
  const confirmation = await confirmAgentPaySubmission(submittedHash);
  return {
    mode: "submitted",
    txHash: submittedHash.value,
    hashKind: submittedHash.kind,
    confirmation,
    input
  };
}

async function submitRecordDecisionDeploy(input: RecordDecisionInput): Promise<SubmittedHash> {
  const script = recordScriptPath();
  const { stdout } = await execFileAsync(script, [
    input.datasetId,
    input.datasetRoot,
    input.reportHash,
    input.paymentReceiptHash,
    input.decision
  ]);

  const submittedHash = parseSubmittedHash(stdout);
  if (!submittedHash) {
    throw new Error(`Casper submission hash not found in record-decision output: ${stdout}`);
  }
  return submittedHash;
}

function recordScriptPath(): string {
  const repoRoot = process.env.AGENT_PAY_REPO_ROOT ?? resolve(MODULE_DIR, "../../..");
  return resolve(repoRoot, process.env.AGENT_PAY_RECORD_SCRIPT ?? DEFAULT_RECORD_SCRIPT);
}

function isDefaultRecordScript(script: string): boolean {
  return script.endsWith(DEFAULT_RECORD_SCRIPT);
}

function isCasperPackageHash(value: string): boolean {
  return /^(hash-)?[0-9a-f]{64}$/i.test(value);
}

function registryReason(check: RegistryStatusCheck | undefined): string {
  if (check?.name === "registry_package" && check.status === "fail") {
    return "agent_pay_registry_package_hash_invalid";
  }

  switch (check?.name) {
    case "registry_package":
      return "agent_pay_registry_package_hash_required";
    case "casper_rpc":
      return "casper_rpc_url_required";
    case "record_script":
      return "agent_pay_record_script_required";
    case "casper_secret_key":
      return check.status === "fail" ? "casper_secret_key_unreadable" : "casper_secret_key_required";
    case "casper_client":
      return "casper_client_required";
    default:
      return "agent_pay_registry_configuration_required";
  }
}

async function canResolveCasperClientCommand(): Promise<boolean> {
  const command = process.env.CASPER_CLIENT_COMMAND ?? "casper-client";
  try {
    await execFileAsync("sh", ["-c", "command -v \"$1\" >/dev/null 2>&1", "sh", command]);
    return true;
  } catch {
    return false;
  }
}

function registryStatus(
  status: RegistryStatus["status"],
  reason: string | null,
  checks: RegistryStatusCheck[],
  registryPackageHash: string | null,
  recordScript: string,
  rpc: RegistryStatus["rpc"]
): RegistryStatus {
  return {
    status,
    reason,
    checkedAt: new Date().toISOString(),
    checks,
    registryPackageHash,
    recordScript: describeRecordScript(recordScript),
    rpc
  };
}

function describeRecordScript(script: string): string {
  return isDefaultRecordScript(script) ? DEFAULT_RECORD_SCRIPT : "custom record script";
}

async function queryCasperRpcStatus(rpcUrl: string): Promise<NonNullable<RegistryStatus["rpc"]>> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "agent-pay-registry-status",
      jsonrpc: "2.0",
      method: "info_get_status",
      params: []
    })
  });
  const body = (await response.json()) as CasperRpcEnvelope;
  if (!response.ok) {
    throw new Error(`info_get_status HTTP ${response.status}`);
  }
  if (body.error) {
    throw new Error(`info_get_status RPC ${body.error.code}: ${body.error.message}`);
  }

  const value = body.result?.value ?? body.result;
  return {
    url: rpcUrl,
    apiVersion: findNamedString(value, new Set(["api_version", "apiVersion"])),
    chainspecName: findNamedString(value, new Set(["chainspec_name", "chainspecName"])),
    latestBlockHeight: findNamedNumber(value, new Set(["height", "block_height", "blockHeight"])),
    latestBlockHash: findNamedString(value, new Set(["hash", "block_hash", "blockHash"]))
  };
}

function parseSubmittedHash(stdout: string): SubmittedHash | null {
  const transactionMatch =
    stdout.match(/TRANSACTION_HASH=([0-9a-fA-F]{64})/) ??
    stdout.match(/"transaction_hash"\s*:\s*\{\s*"Version1"\s*:\s*"([0-9a-fA-F]{64})"/) ??
    stdout.match(/transaction\/([0-9a-fA-F]{64})/i);
  if (transactionMatch) {
    return { value: transactionMatch[1], kind: "transaction" };
  }

  const deployMatch =
    stdout.match(/DEPLOY_HASH=([0-9a-fA-F]{64})/) ??
    stdout.match(/"deploy_hash"\s*:\s*"([0-9a-fA-F]{64})"/) ??
    stdout.match(/deploy\/([0-9a-fA-F]{64})/i);
  if (deployMatch) {
    return { value: deployMatch[1], kind: "deploy" };
  }

  return null;
}

async function confirmAgentPaySubmission(submittedHash: SubmittedHash): Promise<AgentPayRegistryConfirmation> {
  const rpcUrl = process.env.CASPER_RPC_URL;
  if (!rpcUrl) {
    throw new ToolConfigError("CASPER_RPC_URL is required to confirm a Casper decision submission");
  }

  const attempts = readPositiveInteger("CASPER_CONFIRMATION_ATTEMPTS", 5);
  const delayMs = readNonNegativeInteger("CASPER_CONFIRMATION_DELAY_MS", 1500);
  let lastError: string | null = null;
  const methods =
    submittedHash.kind === "transaction"
      ? (["info_get_transaction", "info_get_deploy"] as const)
      : (["info_get_deploy", "info_get_transaction"] as const);
  const variant = submittedHash.kind === "transaction" ? "Version1" : "Deploy";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const method of methods) {
      const confirmation = await queryCasperSubmission(rpcUrl, method, submittedHash.value, attempt, variant);
      if ("confirmation" in confirmation) {
        return confirmation.confirmation;
      }
      lastError = confirmation.reason;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Casper submission ${submittedHash.value} was not executed at ${rpcUrl} after ${attempts} attempts: ${lastError ?? "not found"}`
  );
}

type QueryConfirmationResult =
  | { confirmation: AgentPayRegistryConfirmation }
  | { reason: string };

async function queryCasperSubmission(
  rpcUrl: string,
  method: AgentPayRegistryConfirmation["method"],
  hash: string,
  attempt: number,
  variant: "Version1" | "Deploy"
): Promise<QueryConfirmationResult> {
  // Casper 2.0 JSON-RPC expects the hash value directly, not a {name,value} wrapper.
  // A legacy Deploy is also reachable through info_get_transaction via the Deploy variant.
  const payload =
    method === "info_get_transaction"
      ? {
          id: "agent-pay-confirm-transaction",
          jsonrpc: "2.0",
          method,
          params: { transaction_hash: { [variant]: hash } }
        }
      : {
          id: "agent-pay-confirm-deploy",
          jsonrpc: "2.0",
          method,
          params: { deploy_hash: hash, finalized_approvals: false }
        };

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const body = (await response.json()) as CasperRpcEnvelope;
  if (!response.ok) {
    return { reason: `${method} HTTP ${response.status}` };
  }
  if (body.error) {
    return { reason: `${method} RPC ${body.error.code}: ${body.error.message}` };
  }

  const value = body.result?.value ?? body.result;
  const submittedObject = method === "info_get_transaction" ? value?.transaction : value?.deploy;
  if (!submittedObject) {
    return { reason: `${method} response did not include a submitted object` };
  }

  const executionInfo = value?.execution_info;
  const executionState = readExecutionState(executionInfo);
  if (executionState !== "executed") {
    return { reason: `${method} transaction not executed` };
  }

  return {
    confirmation: {
      rpcUrl,
      method,
      apiVersion: typeof value?.api_version === "string" ? value.api_version : null,
      executionState,
      blockHash: findNamedString(executionInfo, new Set(["block_hash", "blockHash"])) ?? null,
      attempts: attempt,
      observedAt: new Date().toISOString()
    }
  };
}

type CasperRpcEnvelope = {
  result?: {
    value?: Record<string, unknown>;
    [key: string]: unknown;
  };
  error?: {
    code: number;
    message: string;
  };
};

function readExecutionState(executionInfo: unknown): AgentPayRegistryConfirmation["executionState"] {
  // Casper 1.x style: execution_info as an array (empty = not yet executed).
  if (Array.isArray(executionInfo)) {
    return executionInfo.length > 0 ? "executed" : "pending";
  }
  // Casper 2.0 style: execution_info is an object that gains execution_result once finalized.
  if (executionInfo && typeof executionInfo === "object") {
    const executionResult = (executionInfo as Record<string, unknown>).execution_result;
    if (!executionResult) {
      return "pending";
    }
    // A reverted submission carries a non-null error_message; do not report it as executed.
    const errorMessage = findNamedString(executionResult, new Set(["error_message"]));
    return errorMessage ? "unknown" : "executed";
  }
  if (executionInfo === null || executionInfo === undefined) {
    return "pending";
  }
  return "unknown";
}

function findNamedString(value: unknown, keys: Set<string>): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findNamedString(item, keys);
      if (match) {
        return match;
      }
    }
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (keys.has(key) && typeof nestedValue === "string") {
      return nestedValue;
    }
    const match = findNamedString(nestedValue, keys);
    if (match) {
      return match;
    }
  }
  return null;
}

function findNamedNumber(value: unknown, keys: Set<string>): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findNamedNumber(item, keys);
      if (match !== null) {
        return match;
      }
    }
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (keys.has(key) && typeof nestedValue === "number") {
      return nestedValue;
    }
    const match = findNamedNumber(nestedValue, keys);
    if (match !== null) {
      return match;
    }
  }
  return null;
}

function readPositiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}
