import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "./submission-readiness";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_ENV_FILE = ".env.submission.local";

const FIELD_TO_ENV = new Map<string, string>([
  ["--casper-rpc-url", "CASPER_RPC_URL"],
  ["--casper-client-command", "CASPER_CLIENT_COMMAND"],
  ["--casper-secret-key-path", "CASPER_SECRET_KEY_PATH"],
  ["--casper-public-key-path", "CASPER_PUBLIC_KEY_PATH"],
  ["--casper-account-identifier", "CASPER_ACCOUNT_IDENTIFIER"],
  ["--registry-package-hash", "AGENT_PAY_REGISTRY_PACKAGE_HASH"],
  ["--registry-install-hash", "AGENT_PAY_REGISTRY_INSTALL_HASH"],
  ["--x402-asset-package-hash", "X402_ASSET_PACKAGE_HASH"],
  ["--payee-address", "PAYEE_ADDRESS"],
  ["--settlement-tx-hash", "AGENT_PAY_SETTLEMENT_TX_HASH"],
  ["--decision-tx-hash", "AGENT_PAY_DECISION_TX_HASH"],
  ["--github-url", "SUBMISSION_GITHUB_URL"],
  ["--demo-video-url", "SUBMISSION_DEMO_VIDEO_URL"]
]);

const KEY_ORDER = [
  "CASPER_RPC_URL",
  "CASPER_CLIENT_COMMAND",
  "CASPER_SECRET_KEY_PATH",
  "CASPER_PUBLIC_KEY_PATH",
  "CASPER_ACCOUNT_IDENTIFIER",
  "AGENT_PAY_REGISTRY_PACKAGE_HASH",
  "AGENT_PAY_REGISTRY_INSTALL_HASH",
  "X402_ASSET_PACKAGE_HASH",
  "PAYEE_ADDRESS",
  "AGENT_PAY_SETTLEMENT_TX_HASH",
  "AGENT_PAY_DECISION_TX_HASH",
  "SUBMISSION_GITHUB_URL",
  "SUBMISSION_DEMO_VIDEO_URL",
  "CSPR_CLOUD_ACCESS_TOKEN",
  "X402_FACILITATOR_AUTH_TOKEN"
];

export type EvidenceCliOptions = {
  envFile: string;
  updates: Record<string, string>;
};

export async function writeSubmissionEvidence(options: EvidenceCliOptions): Promise<{
  envPath: string;
  updatedKeys: string[];
}> {
  if (Object.keys(options.updates).length === 0) {
    throw new Error("At least one evidence flag is required");
  }

  const envPath = isAbsolute(options.envFile) ? options.envFile : resolve(REPO_ROOT, options.envFile);
  const current = await readExistingEnv(envPath);
  const next = {
    ...current,
    ...options.updates
  };

  for (const [key, value] of Object.entries(options.updates)) {
    const validationError = await validateEvidenceValue(key, value);
    if (validationError) {
      throw new Error(validationError);
    }
  }

  await mkdir(dirname(envPath), { recursive: true });
  await writeFile(envPath, formatEnvFile(next));
  return {
    envPath,
    updatedKeys: Object.keys(options.updates).sort()
  };
}

export function parseEvidenceCliArgs(args: string[]): EvidenceCliOptions {
  let envFile = DEFAULT_ENV_FILE;
  const updates: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--env-file") {
      envFile = requiredValue(args, index, arg);
      index += 1;
      continue;
    }

    const envKey = FIELD_TO_ENV.get(arg);
    if (!envKey) {
      throw new Error(`Unknown evidence flag: ${arg}`);
    }
    updates[envKey] = requiredValue(args, index, arg);
    index += 1;
  }

  return { envFile, updates };
}

export function formatEnvFile(env: Record<string, string | undefined>): string {
  const keys = [
    ...KEY_ORDER.filter((key) => env[key] !== undefined),
    ...Object.keys(env).filter((key) => !KEY_ORDER.includes(key)).sort()
  ];

  return `${keys.map((key) => `${key}=${formatEnvValue(env[key] ?? "")}`).join("\n")}\n`;
}

async function validateEvidenceValue(key: string, value: string): Promise<string | null> {
  if (!value.trim()) return `${key} cannot be empty`;

  if (key === "CASPER_RPC_URL") {
    return validUrl(value, { httpsOnly: true }) ? null : "CASPER_RPC_URL must be an HTTPS URL";
  }
  if (key === "CASPER_CLIENT_COMMAND") {
    return value.includes("\n") ? "CASPER_CLIENT_COMMAND cannot contain a newline" : null;
  }
  if (key === "CASPER_SECRET_KEY_PATH") {
    try {
      await access(value, constants.R_OK);
      return null;
    } catch {
      return `CASPER_SECRET_KEY_PATH does not exist or is not readable: ${value}`;
    }
  }
  if (key === "CASPER_PUBLIC_KEY_PATH") {
    try {
      await access(value, constants.R_OK);
      return null;
    } catch {
      return `CASPER_PUBLIC_KEY_PATH does not exist or is not readable: ${value}`;
    }
  }
  if (key === "CASPER_ACCOUNT_IDENTIFIER") {
    return /^(account-hash|entity-account)-[0-9a-f]{64}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value)
      ? null
      : "CASPER_ACCOUNT_IDENTIFIER must be account-hash-<64 hex chars>, entity-account-<64 hex chars>, or 64 hex chars";
  }
  if (key === "AGENT_PAY_REGISTRY_PACKAGE_HASH") {
    return /^(hash-)?[0-9a-f]{64}$/i.test(value)
      ? null
      : "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars";
  }
  if (key === "X402_ASSET_PACKAGE_HASH") {
    return /^[0-9a-f]{64}$/i.test(value) ? null : "X402_ASSET_PACKAGE_HASH must be 64 hex chars";
  }
  if (key === "PAYEE_ADDRESS") {
    return /^00[0-9a-f]{64}$/i.test(value) ? null : "PAYEE_ADDRESS must be 00 plus 64 hex chars";
  }
  if (
    key === "AGENT_PAY_REGISTRY_INSTALL_HASH" ||
    key === "AGENT_PAY_SETTLEMENT_TX_HASH" ||
    key === "AGENT_PAY_DECISION_TX_HASH"
  ) {
    return /^[0-9a-f]{64}$/i.test(value) ? null : `${key} must be 64 hex chars`;
  }
  if (key === "SUBMISSION_GITHUB_URL") {
    return validGitHubUrl(value) ? null : "SUBMISSION_GITHUB_URL must be a public HTTPS github.com URL";
  }
  if (key === "SUBMISSION_DEMO_VIDEO_URL") {
    return validUrl(value, { httpsOnly: true }) ? null : "SUBMISSION_DEMO_VIDEO_URL must be an HTTPS URL";
  }
  return null;
}

async function readExistingEnv(envPath: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(envPath, "utf8"));
  } catch {
    return {};
  }
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function validGitHubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function validUrl(value: string, options: { httpsOnly: boolean }): boolean {
  try {
    const url = new URL(value);
    return options.httpsOnly ? url.protocol === "https:" : url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await writeSubmissionEvidence(parseEvidenceCliArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to write AgentPay submission evidence");
    process.exitCode = 2;
  }
}
