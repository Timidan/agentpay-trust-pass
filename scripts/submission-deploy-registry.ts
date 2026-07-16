import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createCasperFundingStatus } from "./casper-funding-status";
import {
  confirmCasperHashExecution,
  loadSubmissionEnv,
  type ConfirmationStatus
} from "./submission-readiness";
import { writeSubmissionEvidence } from "./submission-evidence";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_ENV_FILE = ".env.submission.local";
const DEFAULT_CASPER_CLIENT_COMMAND = "casper-client";
const DEFAULT_DEPLOY_SCRIPT = "contracts/agent-pay-registry/scripts/deploy-testnet.sh";
const REGISTRY_PACKAGE_NAME = "agentpay_registry_v2_package";
const REGISTRY_CONTRACT_NAME = "agentpay_registry_v2";
const HEX_64 = "[0-9a-fA-F]{64}";

export type RegistryDeployCliOptions = {
  envFile: string;
  deployScript: string;
  maxAttempts: number;
  pollIntervalMs: number;
};

export type RegistryDeployCaptureResult = {
  registryInstallHash: string;
  registryPackageHash: string;
  registryContractHash: string;
  envPath: string;
  updatedKeys: string[];
};

export async function deployAndCaptureAgentPayRegistry(
  options: Partial<RegistryDeployCliOptions> = {},
  baseEnv: NodeJS.ProcessEnv = process.env
): Promise<RegistryDeployCaptureResult> {
  const envFile = options.envFile ?? DEFAULT_ENV_FILE;
  const deployScript = resolveFromRepo(options.deployScript ?? DEFAULT_DEPLOY_SCRIPT);
  const maxAttempts = options.maxAttempts ?? 40;
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const env = await loadSubmissionEnv(baseEnv, [".env", ".env.local", envFile]);

  const rpcUrl = requiredEnv(env, "CASPER_RPC_URL");
  const clientCommand = env.CASPER_CLIENT_COMMAND ?? DEFAULT_CASPER_CLIENT_COMMAND;
  const secretKeyPath = resolveFromRepo(requiredEnv(env, "CASPER_SECRET_KEY_PATH"));
  const recorderAccountHash = normalizeRecorderAccountHash(
    requiredEnv(env, "AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH")
  );
  const accountIdentifier = await casperAccountIdentifierFromEnv(env);
  if (!accountIdentifier.ok) {
    throw new Error(accountIdentifier.message);
  }

  if (!(await commandExists(clientCommand))) {
    throw new Error(`${clientCommand} must be available before deploying AgentPayRegistry`);
  }
  await assertReadable(secretKeyPath, "CASPER_SECRET_KEY_PATH");

  const funding = await createCasperFundingStatus({
    ...env,
    CASPER_CLIENT_COMMAND: clientCommand,
    CASPER_ACCOUNT_IDENTIFIER: accountIdentifier.value,
    CASPER_PUBLIC_KEY_PATH: accountIdentifier.publicKeyPath ?? "",
    CASPER_RPC_URL: rpcUrl
  });
  if (!funding.funded) {
    throw new Error(`Casper Testnet account is not funded for registry deployment: ${funding.message}`);
  }
  if (funding.accountHash?.toLowerCase() === recorderAccountHash) {
    throw new Error("The registry recorder account must be separate from the deploying owner account");
  }

  const deployOutput = await runDeployScript(deployScript, {
    ...env,
    CASPER_CLIENT_COMMAND: clientCommand,
    CASPER_SECRET_KEY_PATH: secretKeyPath,
    AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH: recorderAccountHash,
    CASPER_NODE_ADDRESS: env.CASPER_NODE_ADDRESS ?? rpcUrl,
    CASPER_CHAIN_NAME: env.CASPER_CHAIN_NAME ?? "casper-test"
  });
  const registryInstallHash = extractSubmittedHash(deployOutput);
  if (!registryInstallHash) {
    throw new Error("Could not find a Casper deploy or transaction hash in the registry deploy output");
  }

  await waitForCasperExecution({
    rpcUrl,
    hash: registryInstallHash,
    maxAttempts,
    pollIntervalMs
  });

  const registryHashes = await waitForRegistryHashes({
    clientCommand,
    rpcUrl,
    accountIdentifier: accountIdentifier.value,
    maxAttempts,
    pollIntervalMs
  });

  const evidence = await writeSubmissionEvidence({
    envFile,
    updates: {
      AGENT_PAY_REGISTRY_INSTALL_HASH: registryInstallHash,
      AGENT_PAY_REGISTRY_PACKAGE_HASH: registryHashes.packageHash,
      AGENT_PAY_REGISTRY_CONTRACT_HASH: registryHashes.contractHash
    }
  });

  return {
    registryInstallHash,
    registryPackageHash: registryHashes.packageHash,
    registryContractHash: registryHashes.contractHash,
    envPath: evidence.envPath,
    updatedKeys: evidence.updatedKeys
  };
}

export function parseRegistryDeployCliArgs(args: string[]): RegistryDeployCliOptions {
  const options: RegistryDeployCliOptions = {
    envFile: DEFAULT_ENV_FILE,
    deployScript: DEFAULT_DEPLOY_SCRIPT,
    maxAttempts: 40,
    pollIntervalMs: 15_000
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;

    if (arg === "--env-file") {
      options.envFile = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--deploy-script") {
      options.deployScript = requiredArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--max-attempts") {
      options.maxAttempts = positiveInteger(requiredArgValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--poll-ms") {
      options.pollIntervalMs = positiveInteger(requiredArgValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown registry deploy flag: ${arg}`);
  }

  return options;
}

export function extractSubmittedHash(output: string): string | null {
  const parsed = parseJsonMaybe(output);
  const structuredHash = findHashByKeys(parsed, ["deploy_hash", "transaction_hash"]);
  if (structuredHash) return structuredHash;

  const labelPattern = new RegExp(`(?:deploy[_ -]?hash|transaction[_ -]?hash)[^0-9a-fA-F]*(${HEX_64})`, "i");
  return output.match(labelPattern)?.[1].toLowerCase() ?? null;
}

export function extractRegistryPackageHash(accountPayload: unknown): string | null {
  const payload = typeof accountPayload === "string" ? parseJsonMaybe(accountPayload) : accountPayload;
  return findNamedKeyPackageHash(payload, REGISTRY_PACKAGE_NAME);
}

export function extractRegistryContractHash(accountPayload: unknown): string | null {
  const payload = typeof accountPayload === "string" ? parseJsonMaybe(accountPayload) : accountPayload;
  return findNamedKeyPackageHash(payload, REGISTRY_CONTRACT_NAME);
}

async function runDeployScript(deployScript: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", [deployScript], {
      cwd: REPO_ROOT,
      env,
      maxBuffer: 1024 * 1024 * 8
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    throw new Error(`AgentPayRegistry deploy failed: ${commandErrorText(error) || "casper-client returned an error"}`);
  }
}

async function waitForCasperExecution(input: {
  rpcUrl: string;
  hash: string;
  maxAttempts: number;
  pollIntervalMs: number;
}): Promise<void> {
  let latestStatus: ConfirmationStatus = "unverified";

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    latestStatus = await confirmCasperHashExecution(input.rpcUrl, input.hash);
    if (latestStatus === "executed") return;
    if (latestStatus === "failed") {
      throw new Error(`Registry install failed on Casper: ${input.hash}`);
    }
    if (attempt < input.maxAttempts) await sleep(input.pollIntervalMs);
  }

  throw new Error(`Registry install hash was not confirmed as executed on Casper; latest status: ${latestStatus}`);
}

async function waitForRegistryHashes(input: {
  clientCommand: string;
  rpcUrl: string;
  accountIdentifier: string;
  maxAttempts: number;
  pollIntervalMs: number;
}): Promise<{ packageHash: string; contractHash: string }> {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const accountOutput = await getAccount(input.clientCommand, input.rpcUrl, input.accountIdentifier);
    const packageHash = extractRegistryPackageHash(accountOutput);
    const contractHash = extractRegistryContractHash(accountOutput);
    if (packageHash && contractHash) return { packageHash, contractHash };
    if (attempt < input.maxAttempts) await sleep(input.pollIntervalMs);
  }

  throw new Error(
    `Could not find ${REGISTRY_PACKAGE_NAME} and ${REGISTRY_CONTRACT_NAME} in the deploying account's Casper named keys`
  );
}

async function getAccount(clientCommand: string, rpcUrl: string, accountIdentifier: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(clientCommand, [
      "get-account",
      "--node-address",
      rpcUrl,
      "--account-identifier",
      accountIdentifier
    ], {
      cwd: REPO_ROOT,
      maxBuffer: 1024 * 1024 * 8
    });
    return stdout;
  } catch (error) {
    throw new Error(`Could not query Casper account named keys: ${commandErrorText(error) || "casper-client returned an error"}`);
  }
}

function findHashByKeys(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findHashByKeys(item, keys);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const found = hashFromValue(record[key]);
      if (found) return found;
    }
  }
  for (const child of Object.values(record)) {
    const found = findHashByKeys(child, keys);
    if (found) return found;
  }
  return null;
}

function hashFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(new RegExp(`^(?:deploy-|transaction-)?(${HEX_64})$`, "i"));
    return match?.[1].toLowerCase() ?? null;
  }
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = hashFromValue(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["Version1", "Deploy", "Transaction"]) {
    const found = hashFromValue(record[key]);
    if (found) return found;
  }
  return null;
}

function findNamedKeyPackageHash(value: unknown, name: string): string | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNamedKeyPackageHash(item, name);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.name === name) {
    const found = packageHashFromValue(record.key) ?? packageHashFromValue(record.value);
    if (found) return found;
  }

  const namedKeys = record.named_keys;
  if (namedKeys && typeof namedKeys === "object" && !Array.isArray(namedKeys)) {
    const namedKeyRecord = namedKeys as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(namedKeyRecord, name)) {
      const found = packageHashFromValue(namedKeyRecord[name]);
      if (found) return found;
    }
  }

  for (const child of Object.values(record)) {
    const found = findNamedKeyPackageHash(child, name);
    if (found) return found;
  }
  return null;
}

function packageHashFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(new RegExp(`^(?:hash-)?(${HEX_64})$`, "i"));
    return match ? `hash-${match[1].toLowerCase()}` : null;
  }
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = packageHashFromValue(item);
      if (found) return found;
    }
    return null;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = packageHashFromValue(child);
    if (found) return found;
  }
  return null;
}

function parseJsonMaybe(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

async function casperAccountIdentifierFromEnv(env: NodeJS.ProcessEnv): Promise<
  | { ok: true; value: string; publicKeyPath: string | null }
  | { ok: false; message: string }
> {
  const directIdentifier = (env.CASPER_ACCOUNT_IDENTIFIER ?? env.CASPER_ACCOUNT_HASH)?.trim();
  if (directIdentifier) {
    return { ok: true, value: normalizeAccountIdentifier(directIdentifier), publicKeyPath: null };
  }

  const publicKeyPath = env.CASPER_PUBLIC_KEY_PATH;
  if (!publicKeyPath) {
    return {
      ok: false,
      message: "CASPER_PUBLIC_KEY_PATH or CASPER_ACCOUNT_IDENTIFIER is required"
    };
  }

  const resolvedPublicKeyPath = resolveFromRepo(publicKeyPath);
  try {
    await access(resolvedPublicKeyPath, constants.R_OK);
  } catch {
    return {
      ok: false,
      message: `CASPER_PUBLIC_KEY_PATH does not exist or is not readable: ${publicKeyPath}`
    };
  }

  return { ok: true, value: resolvedPublicKeyPath, publicKeyPath };
}

function normalizeAccountIdentifier(value: string): string {
  if (/^[0-9a-f]{64}$/i.test(value)) return `account-hash-${value.toLowerCase()}`;
  if (/^(account-hash|entity-account)-[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  return value;
}

function normalizeRecorderAccountHash(value: string): string {
  const normalized = normalizeAccountIdentifier(value.trim());
  if (!/^account-hash-[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(
      "AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH must be account-hash-<64 hex chars> or 64 hex chars"
    );
  }
  return normalized;
}

async function assertReadable(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${label} does not exist or is not readable: ${path}`);
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", "command -v \"$1\" >/dev/null 2>&1", "sh", command]);
    return true;
  } catch {
    return false;
  }
}

function resolveFromRepo(path: string): string {
  return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

function requiredArgValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function positiveInteger(value: string, flag: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return Number(value);
}

function commandErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    for (const value of [record.stderr, record.stdout, record.message]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await deployAndCaptureAgentPayRegistry(parseRegistryDeployCliArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to deploy and capture AgentPayRegistry evidence");
    process.exitCode = 2;
  }
}
