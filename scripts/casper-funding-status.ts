import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadSubmissionEnv } from "./submission-readiness";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_CASPER_CLIENT_COMMAND = "casper-client";
const DEFAULT_CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";
const TESTNET_FAUCET_URL = "https://testnet.cspr.live/tools/faucet";
const MOTES_PER_CSPR = 1_000_000_000n;

export type CasperFundingStatus = {
  accountHash: string | null;
  accountIdentifier?: string | null;
  balanceMotes: string | null;
  requiredMotes: string;
  funded: boolean;
  faucetUrl: string;
  publicKeyPath: string | null;
  rpcUrl: string;
  message: string;
};

export async function createCasperFundingStatus(env: NodeJS.ProcessEnv): Promise<CasperFundingStatus> {
  const rpcUrl = env.CASPER_RPC_URL ?? DEFAULT_CASPER_RPC_URL;
  const requiredMotes = requiredCasperDeployMotes(env);
  const command = env.CASPER_CLIENT_COMMAND ?? DEFAULT_CASPER_CLIENT_COMMAND;
  const identifier = await casperAccountIdentifierFromEnv(env);

  if (!identifier.ok) {
    return {
      accountHash: null,
      accountIdentifier: null,
      balanceMotes: null,
      requiredMotes: requiredMotes.toString(),
      funded: false,
      faucetUrl: TESTNET_FAUCET_URL,
      publicKeyPath: env.CASPER_PUBLIC_KEY_PATH ?? null,
      rpcUrl,
      message: identifier.message
    };
  }

  const accountHash = identifier.accountHash ?? (identifier.publicKeyPath ? await accountHashForPublicKey(command, identifier.value) : null);
  const balance = await balanceForIdentifier(command, rpcUrl, identifier.value);

  if (balance.status === "missing") {
    return {
      accountHash,
      accountIdentifier: identifier.value,
      balanceMotes: "0",
      requiredMotes: requiredMotes.toString(),
      funded: false,
      faucetUrl: TESTNET_FAUCET_URL,
      publicKeyPath: identifier.publicKeyPath,
      rpcUrl,
      message: "Account is not funded on Casper Testnet yet"
    };
  }

  if (balance.status === "unknown") {
    return {
      accountHash,
      accountIdentifier: identifier.value,
      balanceMotes: null,
      requiredMotes: requiredMotes.toString(),
      funded: false,
      faucetUrl: TESTNET_FAUCET_URL,
      publicKeyPath: identifier.publicKeyPath,
      rpcUrl,
      message: balance.message
    };
  }

  return {
    accountHash,
    accountIdentifier: identifier.value,
    balanceMotes: balance.motes.toString(),
    requiredMotes: requiredMotes.toString(),
    funded: balance.motes >= requiredMotes,
    faucetUrl: TESTNET_FAUCET_URL,
    publicKeyPath: identifier.publicKeyPath,
    rpcUrl,
    message:
      balance.motes >= requiredMotes
        ? "Account has enough Testnet balance for AgentPay registry transactions"
        : "Account balance is below the required AgentPay registry transaction budget"
  };
}

export function formatCasperFundingStatus(status: CasperFundingStatus): string {
  return [
    "AgentPay Casper Testnet Funding",
    "",
    `Account: ${status.accountHash ?? "not available"}`,
    `Account identifier: ${status.accountIdentifier ?? "not configured"}`,
    `Public key path: ${status.publicKeyPath ?? "not configured"}`,
    `RPC: ${status.rpcUrl}`,
    `Balance: ${status.balanceMotes ?? "unknown"} motes${status.balanceMotes ? ` (${formatCSPR(BigInt(status.balanceMotes))} CSPR)` : ""}`,
    `Required: ${status.requiredMotes} motes (${formatCSPR(BigInt(status.requiredMotes))} CSPR)`,
    `Funded: ${status.funded ? "yes" : "no"}`,
    `Faucet: ${status.faucetUrl}`,
    "",
    status.message
  ].join("\n");
}

function requiredCasperDeployMotes(env: Record<string, string | undefined>): bigint {
  return parseMotes(env.AGENT_PAY_INSTALL_PAYMENT_AMOUNT, 150_000_000_000n) + parseMotes(env.AGENT_PAY_RECORD_PAYMENT_AMOUNT, 5_000_000_000n);
}

function parseMotes(value: string | undefined, fallback: bigint): bigint {
  if (!value || !/^[0-9]+$/.test(value)) return fallback;
  return BigInt(value);
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function casperAccountIdentifierFromEnv(env: NodeJS.ProcessEnv): Promise<
  | { ok: true; value: string; publicKeyPath: string | null; accountHash: string | null }
  | { ok: false; message: string }
> {
  const directIdentifier = (env.CASPER_ACCOUNT_IDENTIFIER ?? env.CASPER_ACCOUNT_HASH)?.trim();
  if (directIdentifier) {
    const normalized = normalizeAccountIdentifier(directIdentifier);
    return {
      ok: true,
      value: normalized,
      publicKeyPath: null,
      accountHash: normalized.match(/^account-hash-[0-9a-f]{64}$/i) ? normalized.toLowerCase() : null
    };
  }

  const publicKeyPath = env.CASPER_PUBLIC_KEY_PATH ?? null;
  if (!publicKeyPath) {
    return {
      ok: false,
      message: "CASPER_PUBLIC_KEY_PATH or CASPER_ACCOUNT_IDENTIFIER is required"
    };
  }

  const resolvedPublicKeyPath = isAbsolute(publicKeyPath) ? publicKeyPath : resolve(REPO_ROOT, publicKeyPath);
  if (!(await readable(resolvedPublicKeyPath))) {
    return {
      ok: false,
      message: `CASPER_PUBLIC_KEY_PATH does not exist or is not readable: ${publicKeyPath}`
    };
  }

  return {
    ok: true,
    value: resolvedPublicKeyPath,
    publicKeyPath,
    accountHash: null
  };
}

function normalizeAccountIdentifier(value: string): string {
  if (/^[0-9a-f]{64}$/i.test(value)) return `account-hash-${value.toLowerCase()}`;
  if (/^(account-hash|entity-account)-[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  return value;
}

function formatCSPR(motes: bigint): string {
  const whole = motes / MOTES_PER_CSPR;
  const fraction = motes % MOTES_PER_CSPR;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

async function accountHashForPublicKey(command: string, publicKeyPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, ["account-address", "--public-key", publicKeyPath]);
    const match = stdout.match(/account-hash-[0-9a-f]{64}/i);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

async function balanceForIdentifier(
  command: string,
  rpcUrl: string,
  identifier: string
): Promise<{ status: "known"; motes: bigint } | { status: "missing" } | { status: "unknown"; message: string }> {
  try {
    const { stdout } = await execFileAsync(command, [
      "query-balance",
      "--node-address",
      rpcUrl,
      "--purse-identifier",
      identifier
    ]);
    const balance = parseBalanceMotes(stdout);
    return balance === null ? { status: "unknown", message: "Casper balance response did not contain a balance" } : { status: "known", motes: balance };
  } catch (error) {
    const errorText = commandErrorText(error);
    if (/Purse not found|No such account/i.test(errorText)) return { status: "missing" };
    return { status: "unknown", message: errorText || "Casper balance check failed" };
  }
}

function parseBalanceMotes(stdout: string): bigint | null {
  try {
    const payload = JSON.parse(stdout) as unknown;
    const balance = findProperty(payload, "balance");
    if (typeof balance === "string" && /^[0-9]+$/.test(balance)) return BigInt(balance);
    if (typeof balance === "number" && Number.isSafeInteger(balance) && balance >= 0) return BigInt(balance);
  } catch {
    return null;
  }
  return null;
}

function findProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) return (value as Record<string, unknown>)[key];
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findProperty(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
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
  const env = await loadSubmissionEnv();
  const status = await createCasperFundingStatus(env);
  console.log(formatCasperFundingStatus(status));
  process.exitCode = status.funded ? 0 : 1;
}
