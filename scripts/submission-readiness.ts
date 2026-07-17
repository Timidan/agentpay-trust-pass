import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const SOURCE_INTEGRITY_PATHS = [
  ".env.example",
  "README.md",
  "docs/live-capabilities.md",
  "docs/dorahacks-submission.md",
  "docs/real-product-constraints.md",
  "apps/web/src",
  "apps/report-api/src",
  "apps/mcp-server/src",
  "apps/cli/src",
  "packages/agent-pay-client/src",
  "packages/agent-pay-core/src",
  "contracts/agent-pay-registry/src",
  "contracts/agent-pay-registry/scripts",
  "scripts/dev.sh",
  "scripts/smoke.sh",
  "scripts/submission-deploy-registry.ts",
  "scripts/submission-evidence.ts",
  "package.json"
];

type ProhibitedSourcePattern = {
  label: string;
  pattern: RegExp;
  runtimeOnly?: boolean;
};

const PROHIBITED_SOURCE_PATTERNS: ProhibitedSourcePattern[] = [
  { label: "fake receipt marker", pattern: /\bfake receipt\b/i },
  { label: "fake payment marker", pattern: /\bfake payment\b/i },
  { label: "mock payment marker", pattern: /\bmock payment\b/i },
  { label: "mock receipt marker", pattern: /\bmock receipt\b/i },
  {
    label: "fabricated runtime marker",
    pattern: /\b(?:fake|mock(?:ed)?|simulated|hardcoded)\s+(?:evidence|verdict|receipt|payment|settlement|transaction|success|result|hash)\b/i,
    runtimeOnly: true
  },
  {
    label: "hardcoded Casper identifier",
    pattern: /["'`](?:hash-|account-hash-)?[0-9a-f]{64}["'`]/i,
    runtimeOnly: true
  },
  {
    label: "placeholder evidence source",
    pattern: /\bsourceUrl\s*:\s*["'`]https?:\/\/[^"'`]*\.invalid(?:[/:]|["'`])/i,
    runtimeOnly: true
  },
  {
    label: "placeholder evidence timestamp",
    pattern: /\bobservedAt\s*:\s*["'`]1970-01-01T00:00:00(?:\.000)?Z["'`]/i,
    runtimeOnly: true
  },
  {
    label: "generated zero evidence hash",
    pattern: /\b(?:rawHash|recordHash|reportHash|receiptHash|transactionHash)\s*:\s*["'`]0["'`]\.repeat\(\s*64\s*\)/i,
    runtimeOnly: true
  },
  { label: "demo credential marker", pattern: /\bdemo credential\b/i },
  { label: "sample hash marker", pattern: /\bsample hash\b/i },
  { label: "example GitHub URL", pattern: /github\.com\/example\//i },
  { label: "example demo video URL", pattern: /youtu\.be\/example/i },
  { label: "non-real key marker", pattern: /not-a-real-key/i }
];

type CheckStatus = "pass" | "missing" | "fail";
export type ConfirmationStatus = "missing" | "executed" | "failed" | "pending" | "unverified";
type PublicLinkStatus = "missing" | "reachable" | "unreachable" | "unchecked";
type AccountFundingStatus = "missing" | "sufficient" | "insufficient" | "unverified";

export type SubmissionReadinessCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
};

export type SubmissionReadinessInput = {
  files: {
    readmeExists: boolean;
    liveCapabilitiesExists: boolean;
    registryWasmExists: boolean;
  };
  commands: {
    casperClientAvailable: boolean;
  };
  env: Record<string, string | undefined>;
  secrets: {
    casperSecretKeyReadable: boolean;
    registryRecorderKeyReadable?: boolean;
  };
  funding: {
    casperAccount: {
      status: AccountFundingStatus;
      balanceMotes: string | null;
      minimumMotes: string;
      message: string | null;
    };
  };
  confirmations: {
    registryInstall: ConfirmationStatus;
    receiptAnchor: ConfirmationStatus;
    decisionRecord: ConfirmationStatus;
    x402Settlement: ConfirmationStatus;
  };
  links: {
    githubRepository: PublicLinkStatus;
    demoVideo: PublicLinkStatus;
  };
  sourceIntegrity: {
    prohibitedSignals: string[];
  };
};

export type SubmissionReadinessReport = {
  ready: boolean;
  generatedAt: string;
  checks: SubmissionReadinessCheck[];
  blockers: string[];
};

type OutputFormat = "json" | "markdown";

type CliOptions = {
  envFiles: string[];
  format: OutputFormat;
};

export function evaluateSubmissionReadiness(input: SubmissionReadinessInput): SubmissionReadinessReport {
  const checks: SubmissionReadinessCheck[] = [
    fileCheck("readme", "README documentation", input.files.readmeExists, "README.md is present", "README.md is required"),
    fileCheck(
      "live_capabilities",
      "Live capability ledger",
      input.files.liveCapabilitiesExists,
      "docs/live-capabilities.md is present",
      "docs/live-capabilities.md is required"
    ),
    fileCheck(
      "registry_wasm",
      "AgentPayRegistry Wasm artifact",
      input.files.registryWasmExists,
      "agent_pay_registry_contract.wasm is present",
      "Build agent_pay_registry_contract.wasm with npm run build:contract"
    ),
    sourceIntegrityCheck(input.sourceIntegrity.prohibitedSignals),
    envCheck(
      "casper_rpc",
      "Casper RPC URL",
      input.env.CASPER_RPC_URL,
      "CASPER_RPC_URL is configured",
      "CASPER_RPC_URL is required"
    ),
    commandCheck(input.commands.casperClientAvailable),
    secretKeyCheck(input),
    accountFundingCheck(input),
    packageHashCheck(input.env.AGENT_PAY_REGISTRY_PACKAGE_HASH),
    contractHashCheck(input.env.AGENT_PAY_REGISTRY_CONTRACT_HASH),
    recorderAccountCheck(input.env.AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH),
    recorderKeyCheck(input),
    confirmationCheck({
      id: "registry_install_confirmation",
      label: "Registry install confirmation",
      envName: "AGENT_PAY_REGISTRY_INSTALL_HASH",
      value: input.env.AGENT_PAY_REGISTRY_INSTALL_HASH,
      status: input.confirmations.registryInstall
    }),
    confirmationCheck({
      id: "receipt_anchor_confirmation",
      label: "Purchase receipt anchor confirmation",
      envName: "AGENT_PAY_RECEIPT_ANCHOR_HASH",
      value: input.env.AGENT_PAY_RECEIPT_ANCHOR_HASH,
      status: input.confirmations.receiptAnchor
    }),
    x402ConfigurationCheck(input.env),
    confirmationCheck({
      id: "x402_settlement_confirmation",
      label: "x402 settlement confirmation",
      envName: "AGENT_PAY_SETTLEMENT_TX_HASH",
      value: input.env.AGENT_PAY_SETTLEMENT_TX_HASH,
      status: input.confirmations.x402Settlement
    }),
    confirmationCheck({
      id: "decision_confirmation",
      label: "Decision record confirmation",
      envName: "AGENT_PAY_DECISION_TX_HASH",
      value: input.env.AGENT_PAY_DECISION_TX_HASH,
      status: input.confirmations.decisionRecord
    }),
    urlCheck(
      "github_repository",
      "Open-source GitHub repository",
      input.env.SUBMISSION_GITHUB_URL,
      input.links.githubRepository,
      "SUBMISSION_GITHUB_URL points to a GitHub repository",
      "SUBMISSION_GITHUB_URL is required"
    ),
    urlCheck(
      "demo_video",
      "Public demo video",
      input.env.SUBMISSION_DEMO_VIDEO_URL,
      input.links.demoVideo,
      "SUBMISSION_DEMO_VIDEO_URL is configured",
      "SUBMISSION_DEMO_VIDEO_URL is required"
    )
  ];

  const blockers = blockersFor(checks);
  return {
    ready: checks.every((check) => check.status === "pass"),
    generatedAt: new Date().toISOString(),
    checks,
    blockers
  };
}

export function formatSubmissionReadinessMarkdown(report: SubmissionReadinessReport): string {
  const lines = [
    "# AgentPay Submission Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.ready ? "READY" : "NOT READY"}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Message |",
    "|---|---|---|",
    ...report.checks.map((check) => `| ${escapeMarkdownTable(check.label)} | ${check.status} | ${escapeMarkdownTable(check.message)} |`),
    "",
    "## Blockers",
    ""
  ];

  if (report.blockers.length === 0) {
    lines.push("- None");
  } else {
    lines.push(...report.blockers.map((blocker) => `- ${blocker}`));
  }

  return `${lines.join("\n")}\n`;
}

export async function loadSubmissionEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  envFiles = defaultSubmissionEnvFiles()
): Promise<NodeJS.ProcessEnv> {
  const fileEnv: NodeJS.ProcessEnv = {};

  for (const envFile of envFiles) {
    const envPath = isAbsolute(envFile) ? envFile : resolve(REPO_ROOT, envFile);
    if (!(await pathExists(envPath))) continue;
    Object.assign(fileEnv, parseEnvFile(await readFile(envPath, "utf8")));
  }

  return {
    ...fileEnv,
    ...baseEnv
  };
}

export function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    parsed[key] = parseEnvValue(assignment.slice(separatorIndex + 1).trim());
  }

  return parsed;
}

export async function createSubmissionReadinessReport(env: NodeJS.ProcessEnv = process.env): Promise<SubmissionReadinessReport> {
  const casperRpcUrl = env.CASPER_RPC_URL;
  const registryInstall = await confirmationFromEnv(casperRpcUrl, env.AGENT_PAY_REGISTRY_INSTALL_HASH);
  const receiptAnchor = await confirmationFromEnv(casperRpcUrl, env.AGENT_PAY_RECEIPT_ANCHOR_HASH);
  const decisionRecord = await confirmationFromEnv(casperRpcUrl, env.AGENT_PAY_DECISION_TX_HASH);
  const x402Settlement = await confirmationFromEnv(casperRpcUrl, env.AGENT_PAY_SETTLEMENT_TX_HASH);
  const githubRepository = await publicLinkStatus(env.SUBMISSION_GITHUB_URL);
  const demoVideo = await publicLinkStatus(env.SUBMISSION_DEMO_VIDEO_URL);

  return evaluateSubmissionReadiness({
    files: {
      readmeExists: await pathExists(resolve(REPO_ROOT, "README.md")),
      liveCapabilitiesExists: await pathExists(resolve(REPO_ROOT, "docs/live-capabilities.md")),
      registryWasmExists: await pathExists(
        resolve(
          REPO_ROOT,
          "contracts/agent-pay-registry/target/wasm32-unknown-unknown/release/agent_pay_registry_contract.wasm"
        )
      )
    },
    commands: {
      casperClientAvailable: await commandExists(env.CASPER_CLIENT_COMMAND ?? "casper-client")
    },
    env,
    secrets: {
      casperSecretKeyReadable: env.CASPER_SECRET_KEY_PATH ? await readable(env.CASPER_SECRET_KEY_PATH) : false,
      registryRecorderKeyReadable: env.AGENT_PAY_REGISTRY_RECORDER_KEY_PATH
        ? await readable(env.AGENT_PAY_REGISTRY_RECORDER_KEY_PATH)
        : false
    },
    funding: {
      casperAccount: await casperAccountFundingFromEnv(env)
    },
    confirmations: {
      registryInstall,
      receiptAnchor,
      decisionRecord,
      x402Settlement
    },
    links: {
      githubRepository,
      demoVideo
    },
    sourceIntegrity: {
      prohibitedSignals: await scanSourceIntegrity()
    }
  });
}

function fileCheck(id: string, label: string, present: boolean, passMessage: string, missingMessage: string): SubmissionReadinessCheck {
  return {
    id,
    label,
    status: present ? "pass" : "missing",
    message: present ? passMessage : missingMessage
  };
}

function envCheck(
  id: string,
  label: string,
  value: string | undefined,
  passMessage: string,
  missingMessage: string
): SubmissionReadinessCheck {
  return {
    id,
    label,
    status: value ? "pass" : "missing",
    message: value ? passMessage : missingMessage
  };
}

function commandCheck(available: boolean): SubmissionReadinessCheck {
  return {
    id: "casper_client",
    label: "Casper client",
    status: available ? "pass" : "missing",
    message: available ? "casper-client is available" : "casper-client is required for Testnet deploys"
  };
}

function secretKeyCheck(input: SubmissionReadinessInput): SubmissionReadinessCheck {
  if (!input.env.CASPER_SECRET_KEY_PATH) {
    return {
      id: "casper_secret_key",
      label: "Casper signing key",
      status: "missing",
      message: "CASPER_SECRET_KEY_PATH is required"
    };
  }
  return {
    id: "casper_secret_key",
    label: "Casper signing key",
    status: input.secrets.casperSecretKeyReadable ? "pass" : "fail",
    message: input.secrets.casperSecretKeyReadable
      ? "CASPER_SECRET_KEY_PATH is readable"
      : "CASPER_SECRET_KEY_PATH does not exist or is not readable"
  };
}

function accountFundingCheck(input: SubmissionReadinessInput): SubmissionReadinessCheck {
  if (!input.env.CASPER_PUBLIC_KEY_PATH && !input.env.CASPER_ACCOUNT_IDENTIFIER && !input.env.CASPER_ACCOUNT_HASH) {
    return {
      id: "casper_account_funding",
      label: "Casper account funding",
      status: "missing",
      message: "CASPER_PUBLIC_KEY_PATH or CASPER_ACCOUNT_IDENTIFIER is required to verify Testnet funding"
    };
  }

  const funding = input.funding.casperAccount;
  if (funding.status === "sufficient") {
    return {
      id: "casper_account_funding",
      label: "Casper account funding",
      status: "pass",
      message: `account balance ${funding.balanceMotes} motes covers required ${funding.minimumMotes} motes`
    };
  }
  if (funding.status === "insufficient") {
    return {
      id: "casper_account_funding",
      label: "Casper account funding",
      status: "fail",
      message: `account balance ${funding.balanceMotes ?? "unknown"} motes is below required ${funding.minimumMotes} motes`
    };
  }

  return {
    id: "casper_account_funding",
    label: "Casper account funding",
    status: "fail",
    message: funding.message ?? "Casper account balance was not verified"
  };
}

function sourceIntegrityCheck(prohibitedSignals: string[]): SubmissionReadinessCheck {
  if (prohibitedSignals.length === 0) {
    return {
      id: "source_integrity",
      label: "No fake runtime evidence markers",
      status: "pass",
      message: "runtime and submission-facing files do not contain prohibited fake evidence markers"
    };
  }

  return {
    id: "source_integrity",
    label: "No fake runtime evidence markers",
    status: "fail",
    message: `Remove prohibited fake evidence markers: ${prohibitedSignals.slice(0, 3).join("; ")}`
  };
}

export function prohibitedSourceLineSignals(line: string, runtimeSource: boolean): string[] {
  return PROHIBITED_SOURCE_PATTERNS
    .filter(({ pattern, runtimeOnly }) => (!runtimeOnly || runtimeSource) && pattern.test(line))
    .map(({ label }) => label);
}

function packageHashCheck(value: string | undefined): SubmissionReadinessCheck {
  if (!value) {
    return {
      id: "registry_package_hash",
      label: "Deployed registry package hash",
      status: "missing",
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH is required"
    };
  }
  const valid = /^(hash-)?[0-9a-f]{64}$/i.test(value);
  return {
    id: "registry_package_hash",
    label: "Deployed registry package hash",
    status: valid ? "pass" : "fail",
    message: valid
      ? "AGENT_PAY_REGISTRY_PACKAGE_HASH has Casper package-hash shape"
      : "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars"
  };
}

function contractHashCheck(value: string | undefined): SubmissionReadinessCheck {
  if (!value) {
    return {
      id: "registry_contract_hash",
      label: "Deployed registry contract hash",
      status: "missing",
      message: "AGENT_PAY_REGISTRY_CONTRACT_HASH is required"
    };
  }
  const valid = /^(hash-)?[0-9a-f]{64}$/.test(value);
  return {
    id: "registry_contract_hash",
    label: "Deployed registry contract hash",
    status: valid ? "pass" : "fail",
    message: valid
      ? "AGENT_PAY_REGISTRY_CONTRACT_HASH has Casper contract-hash shape"
      : "AGENT_PAY_REGISTRY_CONTRACT_HASH must be hash-<64 lowercase hex chars> or 64 lowercase hex chars"
  };
}

function recorderAccountCheck(value: string | undefined): SubmissionReadinessCheck {
  if (!value) {
    return {
      id: "registry_recorder_account",
      label: "Registry recorder account",
      status: "missing",
      message: "AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH is required"
    };
  }
  const valid = /^account-hash-[0-9a-f]{64}$/.test(value);
  return {
    id: "registry_recorder_account",
    label: "Registry recorder account",
    status: valid ? "pass" : "fail",
    message: valid
      ? "AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH has canonical account-hash shape"
      : "AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH must be account-hash-<64 lowercase hex chars>"
  };
}

function recorderKeyCheck(input: SubmissionReadinessInput): SubmissionReadinessCheck {
  if (!input.env.AGENT_PAY_REGISTRY_RECORDER_KEY_PATH) {
    return {
      id: "registry_recorder_key",
      label: "Registry recorder key",
      status: "missing",
      message: "AGENT_PAY_REGISTRY_RECORDER_KEY_PATH is required"
    };
  }
  return {
    id: "registry_recorder_key",
    label: "Registry recorder key",
    status: input.secrets.registryRecorderKeyReadable ? "pass" : "fail",
    message: input.secrets.registryRecorderKeyReadable
      ? "AGENT_PAY_REGISTRY_RECORDER_KEY_PATH is readable"
      : "AGENT_PAY_REGISTRY_RECORDER_KEY_PATH does not exist or is not readable"
  };
}

function x402ConfigurationCheck(env: Record<string, string | undefined>): SubmissionReadinessCheck {
  if (!env.X402_ASSET_PACKAGE_HASH) {
    return {
      id: "x402_configuration",
      label: "Casper x402 configuration",
      status: "missing",
      message: "X402_ASSET_PACKAGE_HASH is required"
    };
  }
  if (!/^[0-9a-f]{64}$/i.test(env.X402_ASSET_PACKAGE_HASH)) {
    return {
      id: "x402_configuration",
      label: "Casper x402 configuration",
      status: "fail",
      message: "X402_ASSET_PACKAGE_HASH must be 64 hex chars"
    };
  }
  if (!env.PAYEE_ADDRESS) {
    return {
      id: "x402_configuration",
      label: "Casper x402 configuration",
      status: "missing",
      message: "PAYEE_ADDRESS is required"
    };
  }
  if (!/^00[0-9a-f]{64}$/i.test(env.PAYEE_ADDRESS)) {
    return {
      id: "x402_configuration",
      label: "Casper x402 configuration",
      status: "fail",
      message: "PAYEE_ADDRESS must be 00 plus 64 hex chars"
    };
  }
  // The facilitator auth token is only required for the hosted CSPR.cloud
  // facilitator. A self-hosted casper-x402 facilitator needs no token, matching
  // the report API's readiness logic.
  const facilitatorUrl = env.X402_FACILITATOR_URL ?? "https://x402-facilitator.cspr.cloud";
  const requiresAuth = facilitatorUrl.includes("cspr.cloud");
  const hasAuth = Boolean(env.CSPR_CLOUD_ACCESS_TOKEN ?? env.X402_FACILITATOR_AUTH_TOKEN);
  if (requiresAuth && !hasAuth) {
    return {
      id: "x402_configuration",
      label: "Casper x402 configuration",
      status: "missing",
      message: "CSPR_CLOUD_ACCESS_TOKEN or X402_FACILITATOR_AUTH_TOKEN is required for the CSPR.cloud facilitator"
    };
  }
  return {
    id: "x402_configuration",
    label: "Casper x402 configuration",
    status: "pass",
    message: requiresAuth
      ? "x402 asset, payee, and CSPR.cloud facilitator auth are configured"
      : "x402 asset, payee, and self-hosted facilitator are configured"
  };
}

function confirmationCheck(input: {
  id: string;
  label: string;
  envName: string;
  value: string | undefined;
  status: ConfirmationStatus;
}): SubmissionReadinessCheck {
  if (!input.value) {
    return {
      id: input.id,
      label: input.label,
      status: "missing",
      message: `${input.envName} is required`
    };
  }
  if (!/^[0-9a-f]{64}$/i.test(input.value)) {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      message: `${input.envName} must be 64 hex chars`
    };
  }
  if (input.status === "executed") {
    return {
      id: input.id,
      label: input.label,
      status: "pass",
      message: `${input.envName} is confirmed executed on Casper`
    };
  }
  if (input.status === "pending") {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      message: `${input.envName} is still pending on Casper`
    };
  }
  if (input.status === "failed") {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      message: `${input.envName} failed during Casper execution`
    };
  }
  return {
    id: input.id,
    label: input.label,
    status: "fail",
    message: `${input.envName} was not confirmed as executed on Casper`
  };
}

function urlCheck(
  id: string,
  label: string,
  value: string | undefined,
  linkStatus: PublicLinkStatus,
  passMessage: string,
  missingMessage: string
): SubmissionReadinessCheck {
  if (!value) {
    return { id, label, status: "missing", message: missingMessage };
  }
  try {
    const url = new URL(value);
    const valid = url.protocol === "https:" && (id !== "github_repository" || url.hostname === "github.com");
    if (!valid) {
      return {
        id,
        label,
        status: "fail",
        message: `${id === "github_repository" ? "GitHub" : "Demo video"} URL must be public HTTPS`
      };
    }
    if (linkStatus === "reachable") {
      return { id, label, status: "pass", message: passMessage };
    }
    if (linkStatus === "unreachable") {
      return {
        id,
        label,
        status: "fail",
        message:
          id === "github_repository"
            ? "SUBMISSION_GITHUB_URL was not reachable as a public URL"
            : "SUBMISSION_DEMO_VIDEO_URL was not reachable as a public URL"
      };
    }
    return {
      id,
      label,
      status: "fail",
      message:
        id === "github_repository"
          ? "SUBMISSION_GITHUB_URL was not verified as reachable"
          : "SUBMISSION_DEMO_VIDEO_URL was not verified as reachable"
    };
  } catch {
    return { id, label, status: "fail", message: `${id === "github_repository" ? "GitHub" : "Demo video"} URL is invalid` };
  }
}

function blockersFor(checks: SubmissionReadinessCheck[]): string[] {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const blockers: string[] = [];

  if (
    byId.get("registry_package_hash")?.status !== "pass" ||
    byId.get("registry_contract_hash")?.status !== "pass" ||
    byId.get("registry_recorder_account")?.status !== "pass" ||
    byId.get("registry_recorder_key")?.status !== "pass" ||
    byId.get("registry_install_confirmation")?.status !== "pass"
  ) {
    blockers.push("Deploy AgentPayRegistry v2 and configure its package, contract, and dedicated recorder values.");
  }
  if (byId.get("receipt_anchor_confirmation")?.status !== "pass") {
    blockers.push("Anchor one finalized AgentPay purchase receipt on Casper and confirm its execution hash.");
  }
  if (byId.get("x402_configuration")?.status !== "pass" || byId.get("x402_settlement_confirmation")?.status !== "pass") {
    blockers.push("Run one real x402-paid AgentPay settlement and confirm the Casper settlement hash.");
  }
  if (byId.get("decision_confirmation")?.status !== "pass") {
    blockers.push("Record one verified AgentPay decision on Casper and confirm the execution hash.");
  }
  if (byId.get("github_repository")?.status !== "pass") {
    blockers.push("Publish the open-source GitHub repository URL.");
  }
  if (byId.get("demo_video")?.status !== "pass") {
    blockers.push("Publish the public demo video URL.");
  }
  if (byId.get("source_integrity")?.status !== "pass") {
    blockers.push("Remove fake/manual runtime evidence markers from submission-facing files.");
  }
  if (byId.get("live_capabilities")?.status !== "pass") {
    blockers.push("Maintain docs/live-capabilities.md before submission.");
  }
  if (byId.get("casper_account_funding")?.status !== "pass") {
    blockers.push("Fund the Casper Testnet account and set CASPER_PUBLIC_KEY_PATH.");
  }
  for (const check of checks) {
    if (check.status !== "pass" && !blockers.some((blocker) => blocker.includes(check.label))) {
      if (
        check.id === "readme" ||
        check.id === "registry_wasm" ||
        check.id === "casper_rpc" ||
        check.id === "casper_client" ||
        check.id === "casper_secret_key"
      ) {
        blockers.push(check.message);
      }
    }
  }
  return [...new Set(blockers)];
}

async function confirmationFromEnv(rpcUrl: string | undefined, hash: string | undefined): Promise<ConfirmationStatus> {
  if (!hash) return "missing";
  if (!/^[0-9a-f]{64}$/i.test(hash) || !rpcUrl) return "unverified";
  return confirmCasperHashExecution(rpcUrl, hash);
}

async function publicLinkStatus(value: string | undefined): Promise<PublicLinkStatus> {
  if (!value) return "missing";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "unchecked";
  } catch {
    return "unchecked";
  }

  if (await canFetchPublicUrl(value, "HEAD")) return "reachable";
  if (await canFetchPublicUrl(value, "GET")) return "reachable";
  return "unreachable";
}

async function canFetchPublicUrl(url: string, method: "HEAD" | "GET"): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(10_000)
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

export async function confirmCasperHashExecution(rpcUrl: string, hash: string): Promise<ConfirmationStatus> {
  // Casper 2.0 JSON-RPC: info_get_transaction takes the transaction hash value directly.
  // A settlement may be a native TransactionV1 or a legacy Deploy, so try both variants.
  for (const variant of ["Version1", "Deploy"] as const) {
    const transaction = await queryCasper(rpcUrl, "info_get_transaction", {
      transaction_hash: { [variant]: hash }
    });
    const state = executionState(transaction);
    if (state !== "unverified") return state;
  }

  const deploy = await queryCasper(rpcUrl, "info_get_deploy", {
    deploy_hash: hash,
    finalized_approvals: false
  });
  return executionState(deploy);
}

async function queryCasper(rpcUrl: string, method: string, params: unknown): Promise<unknown> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `agentpay-submission-${method}`, method, params })
    });
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    if (!response.ok || body.error) return null;
    return body.result;
  } catch {
    return null;
  }
}

function executionState(payload: unknown): ConfirmationStatus {
  if (!payload) return "unverified";
  const executionInfo = findProperty(payload, "execution_info")
    ?? findProperty(payload, "execution_results");
  // Casper 1.x style: execution_info as an array (empty = pending).
  if (Array.isArray(executionInfo)) {
    if (executionInfo.some(isFailedExecution)) return "failed";
    return executionInfo.length > 0 ? "executed" : "pending";
  }
  // Casper 2.0 style: execution_info is an object carrying execution_result once finalized.
  if (executionInfo && typeof executionInfo === "object") {
    if (isFailedExecution(executionInfo)) return "failed";
    const result = findProperty(executionInfo, "execution_result");
    return result !== undefined && result !== null ? "executed" : "pending";
  }
  // Transaction/deploy exists but is not yet executed (execution_info null) => pending;
  // nothing found at all => unverified.
  const found = findProperty(payload, "transaction") ?? findProperty(payload, "deploy");
  return found ? "pending" : "unverified";
}

function isFailedExecution(value: unknown): boolean {
  const failure = findProperty(value, "Failure");
  if (failure !== undefined && failure !== null) return true;
  const errorMessage = findProperty(value, "error_message");
  return typeof errorMessage === "string" && errorMessage.trim().length > 0;
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
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

async function casperAccountFundingFromEnv(
  env: NodeJS.ProcessEnv
): Promise<SubmissionReadinessInput["funding"]["casperAccount"]> {
  const minimumMotes = requiredCasperDeployMotes(env).toString();
  const purseIdentifier = await casperPurseIdentifierFromEnv(env);
  if (!purseIdentifier.ok) {
    return {
      status: "missing",
      balanceMotes: null,
      minimumMotes,
      message: purseIdentifier.message
    };
  }

  if (!env.CASPER_RPC_URL) {
    return {
      status: "unverified",
      balanceMotes: null,
      minimumMotes,
      message: "CASPER_RPC_URL is required to verify account funding"
    };
  }

  if (!(await commandExists(env.CASPER_CLIENT_COMMAND ?? "casper-client"))) {
    return {
      status: "unverified",
      balanceMotes: null,
      minimumMotes,
      message: `${env.CASPER_CLIENT_COMMAND ?? "casper-client"} must be available to verify account funding`
    };
  }

  try {
    const { stdout } = await execFileAsync(env.CASPER_CLIENT_COMMAND ?? "casper-client", [
      "query-balance",
      "--node-address",
      env.CASPER_RPC_URL,
      "--purse-identifier",
      purseIdentifier.value
    ]);
    const balanceMotes = parseBalanceMotes(stdout);
    if (balanceMotes === null) {
      return {
        status: "unverified",
        balanceMotes: null,
        minimumMotes,
        message: "Casper account balance response did not contain a balance"
      };
    }

    const requiredMotes = BigInt(minimumMotes);
    return {
      status: balanceMotes >= requiredMotes ? "sufficient" : "insufficient",
      balanceMotes: balanceMotes.toString(),
      minimumMotes,
      message: null
    };
  } catch (error) {
    const errorText = commandErrorText(error);
    if (/Purse not found/i.test(errorText)) {
      return {
        status: "insufficient",
        balanceMotes: "0",
        minimumMotes,
        message: "Casper account was not found on Testnet; fund the account before deployment"
      };
    }
    return {
      status: "unverified",
      balanceMotes: null,
      minimumMotes,
      message: errorText || "Casper account balance check failed"
    };
  }
}

async function casperPurseIdentifierFromEnv(env: NodeJS.ProcessEnv): Promise<
  | { ok: true; value: string }
  | { ok: false; message: string }
> {
  const directIdentifier = (env.CASPER_ACCOUNT_IDENTIFIER ?? env.CASPER_ACCOUNT_HASH)?.trim();
  if (directIdentifier) {
    return { ok: true, value: normalizeAccountIdentifier(directIdentifier) };
  }

  const publicKeyPath = env.CASPER_PUBLIC_KEY_PATH;
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

  return { ok: true, value: resolvedPublicKeyPath };
}

function normalizeAccountIdentifier(value: string): string {
  if (/^[0-9a-f]{64}$/i.test(value)) return `account-hash-${value.toLowerCase()}`;
  if (/^(account-hash|entity-account)-[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  return value;
}

function requiredCasperDeployMotes(env: Record<string, string | undefined>): bigint {
  return parseMotes(env.AGENT_PAY_INSTALL_PAYMENT_AMOUNT, 150_000_000_000n) + parseMotes(env.AGENT_PAY_RECORD_PAYMENT_AMOUNT, 5_000_000_000n);
}

function parseMotes(value: string | undefined, fallback: bigint): bigint {
  if (!value || !/^[0-9]+$/.test(value)) return fallback;
  return BigInt(value);
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

function commandErrorText(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    for (const value of [record.stderr, record.stdout, record.message]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

async function scanSourceIntegrity(): Promise<string[]> {
  const signals: string[] = [];
  const files = await sourceIntegrityFiles();

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const projectPath = relative(REPO_ROOT, file);
    const runtimeSource = /^(?:apps|contracts|packages|scripts)\//.test(projectPath);
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const label of prohibitedSourceLineSignals(line, runtimeSource)) {
        signals.push(`${projectPath}:${index + 1} ${label}`);
      }
    });
  }

  return signals;
}

async function sourceIntegrityFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const entry of SOURCE_INTEGRITY_PATHS) {
    files.push(...await collectSourceFiles(resolve(REPO_ROOT, entry)));
  }
  return files;
}

async function collectSourceFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const childPath = resolve(path, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectSourceFiles(childPath));
      } else if (entry.isFile() && sourceIntegrityFileAllowed(childPath)) {
        files.push(childPath);
      }
    }
    return files;
  } catch {
    return sourceIntegrityFileAllowed(path) && await pathExists(path) ? [path] : [];
  }
}

function sourceIntegrityFileAllowed(path: string): boolean {
  return /\.(css|html|json|md|rs|sh|ts|tsx)$/.test(path) || path.endsWith(".env.example");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseCliOptions(process.argv.slice(2));
  const env = await loadSubmissionEnv(process.env, options.envFiles);
  const report = await createSubmissionReadinessReport(env);
  console.log(options.format === "markdown" ? formatSubmissionReadinessMarkdown(report) : JSON.stringify(report, null, 2));
  process.exitCode = report.ready ? 0 : 1;
}

function parseCliOptions(args: string[]): CliOptions {
  const envFiles: string[] = [];
  let format: OutputFormat = "json";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--markdown") {
      format = "markdown";
      continue;
    }
    if (arg === "--format" && args[index + 1]) {
      format = args[index + 1] === "markdown" ? "markdown" : "json";
      index += 1;
      continue;
    }
    if (arg === "--env-file" && args[index + 1]) {
      envFiles.push(args[index + 1]);
      index += 1;
    }
  }

  return {
    envFiles: envFiles.length > 0 ? envFiles : defaultSubmissionEnvFiles(),
    format
  };
}

function defaultSubmissionEnvFiles(): string[] {
  return [".env", ".env.local", ".env.submission.local"];
}

function parseEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

function escapeMarkdownTable(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
