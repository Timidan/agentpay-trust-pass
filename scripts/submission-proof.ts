import { fileURLToPath } from "node:url";
import {
  confirmCasperHashExecution,
  loadSubmissionEnv,
  type ConfirmationStatus
} from "./submission-readiness";

type ProofStatus = "pass" | "fail";
type FacilitatorKind = "hosted" | "self-hosted";

export type DemoProofEdge = {
  id: "facilitator" | "registryPackage" | "registryInstall" | "x402Settlement" | "decisionRecord";
  label: string;
  status: ProofStatus;
  value: string | null;
  message: string;
  explorerUrl: string | null;
};

export type DemoProofBundle = {
  generatedAt: string;
  status: ProofStatus;
  facilitator: {
    url: string;
    kind: FacilitatorKind;
  };
  run: {
    quoteId: string | null;
    datasetRoot: string | null;
  };
  edges: DemoProofEdge[];
};

type DemoProofBundleInput = {
  env: Record<string, string | undefined>;
  confirmations: {
    registryInstall: ConfirmationStatus;
    x402Settlement: ConfirmationStatus;
    decisionRecord: ConfirmationStatus;
  };
  generatedAt?: string;
};

type CreateDemoProofBundleOptions = {
  env?: NodeJS.ProcessEnv;
  confirmHashExecution?: (rpcUrl: string, hash: string) => Promise<ConfirmationStatus>;
};

type CliOptions = {
  envFiles: string[];
  format: "markdown" | "json";
};

export function buildDemoProofBundle(input: DemoProofBundleInput): DemoProofBundle {
  const env = input.env;
  const facilitatorUrl = env.X402_FACILITATOR_URL ?? "https://x402-facilitator.cspr.cloud";
  const facilitatorKind = kindForFacilitator(facilitatorUrl);
  const explorerBase = explorerBaseUrl(env);
  const edges: DemoProofEdge[] = [
    {
      id: "facilitator",
      label: "Facilitator",
      status: "pass",
      value: facilitatorUrl,
      message:
        facilitatorKind === "hosted"
          ? "Hosted facilitator configured; captured run must still prove this path separately"
          : "Self-hosted facilitator configured",
      explorerUrl: null
    },
    registryPackageEdge(env.AGENT_PAY_REGISTRY_PACKAGE_HASH, explorerBase),
    confirmationEdge({
      id: "registryInstall",
      label: "Registry install",
      envName: "AGENT_PAY_REGISTRY_INSTALL_HASH",
      value: env.AGENT_PAY_REGISTRY_INSTALL_HASH,
      confirmation: input.confirmations.registryInstall,
      explorerUrl: explorerLink(explorerBase, "deploy", env.AGENT_PAY_REGISTRY_INSTALL_HASH)
    }),
    confirmationEdge({
      id: "x402Settlement",
      label: "x402 settlement",
      envName: "AGENT_PAY_SETTLEMENT_TX_HASH",
      value: env.AGENT_PAY_SETTLEMENT_TX_HASH,
      confirmation: input.confirmations.x402Settlement,
      explorerUrl: explorerLink(explorerBase, "transaction", env.AGENT_PAY_SETTLEMENT_TX_HASH)
    }),
    confirmationEdge({
      id: "decisionRecord",
      label: "Decision record",
      envName: "AGENT_PAY_DECISION_TX_HASH",
      value: env.AGENT_PAY_DECISION_TX_HASH,
      confirmation: input.confirmations.decisionRecord,
      explorerUrl: explorerLink(explorerBase, "deploy", env.AGENT_PAY_DECISION_TX_HASH)
    })
  ];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: edges.every((edge) => edge.status === "pass") ? "pass" : "fail",
    facilitator: {
      url: facilitatorUrl,
      kind: facilitatorKind
    },
    run: {
      quoteId: firstPresent(env.AGENT_PAY_QUOTE_ID, env.AGENT_PAY_DEMO_QUOTE_ID),
      datasetRoot: firstPresent(env.AGENT_PAY_DATASET_ROOT, env.AGENT_PAY_DEMO_DATASET_ROOT)
    },
    edges
  };
}

export async function createDemoProofBundle(options: CreateDemoProofBundleOptions = {}): Promise<DemoProofBundle> {
  const env = options.env ?? process.env;
  const confirmHashExecution = options.confirmHashExecution ?? confirmCasperHashExecution;
  const confirmations = {
    registryInstall: await confirmationFromEnv(env, "AGENT_PAY_REGISTRY_INSTALL_HASH", confirmHashExecution),
    x402Settlement: await confirmationFromEnv(env, "AGENT_PAY_SETTLEMENT_TX_HASH", confirmHashExecution),
    decisionRecord: await confirmationFromEnv(env, "AGENT_PAY_DECISION_TX_HASH", confirmHashExecution)
  };
  return buildDemoProofBundle({ env, confirmations });
}

export function formatDemoProofBundleMarkdown(bundle: DemoProofBundle): string {
  const lines = [
    "# Demo Proof Bundle",
    "",
    `Generated: ${bundle.generatedAt}`,
    `Status: ${bundle.status.toUpperCase()}`,
    `Facilitator: ${bundle.facilitator.kind} (\`${bundle.facilitator.url}\`)`,
    "",
    "## Run Metadata",
    "",
    `- Quote ID: ${inlineOrMissing(bundle.run.quoteId)}`,
    `- Dataset/Merkle root: ${inlineOrMissing(bundle.run.datasetRoot)}`,
    "",
    "## Proof Edges",
    "",
    "| Edge | Status | Value | Message | Explorer |",
    "|---|---|---|---|---|",
    ...bundle.edges.map((edge) =>
      [
        edge.label,
        edge.status.toUpperCase(),
        inlineOrMissing(edge.value),
        escapeMarkdownTable(edge.message),
        edge.explorerUrl ? `[cspr.live](${edge.explorerUrl})` : "n/a"
      ].join(" | ")
    ).map((row) => `| ${row} |`)
  ];

  return `${lines.join("\n")}\n`;
}

function registryPackageEdge(value: string | undefined, explorerBase: string): DemoProofEdge {
  if (!value) {
    return {
      id: "registryPackage",
      label: "Registry package",
      status: "fail",
      value: null,
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH is required",
      explorerUrl: null
    };
  }
  if (!/^(hash-)?[0-9a-f]{64}$/i.test(value)) {
    return {
      id: "registryPackage",
      label: "Registry package",
      status: "fail",
      value,
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars",
      explorerUrl: null
    };
  }
  return {
    id: "registryPackage",
    label: "Registry package",
    status: "pass",
    value,
    message: "AGENT_PAY_REGISTRY_PACKAGE_HASH has Casper package-hash shape",
    explorerUrl: `${explorerBase}/contract-package/${value}`
  };
}

function confirmationEdge(input: {
  id: "registryInstall" | "x402Settlement" | "decisionRecord";
  label: string;
  envName: string;
  value: string | undefined;
  confirmation: ConfirmationStatus;
  explorerUrl: string | null;
}): DemoProofEdge {
  if (!input.value) {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      value: null,
      message: `${input.envName} is required`,
      explorerUrl: null
    };
  }
  if (!/^[0-9a-f]{64}$/i.test(input.value)) {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      value: input.value,
      message: `${input.envName} must be 64 hex chars`,
      explorerUrl: null
    };
  }
  if (input.confirmation === "executed") {
    return {
      id: input.id,
      label: input.label,
      status: "pass",
      value: input.value,
      message: `${input.envName} is confirmed executed on Casper`,
      explorerUrl: input.explorerUrl
    };
  }
  if (input.confirmation === "pending") {
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      value: input.value,
      message: `${input.envName} is still pending on Casper`,
      explorerUrl: input.explorerUrl
    };
  }
  return {
    id: input.id,
    label: input.label,
    status: "fail",
    value: input.value,
    message: `${input.envName} was not confirmed as executed on Casper`,
    explorerUrl: input.explorerUrl
  };
}

async function confirmationFromEnv(
  env: Record<string, string | undefined>,
  envName: string,
  confirmHashExecution: (rpcUrl: string, hash: string) => Promise<ConfirmationStatus>
): Promise<ConfirmationStatus> {
  const hash = env[envName];
  if (!hash) return "missing";
  if (!/^[0-9a-f]{64}$/i.test(hash) || !env.CASPER_RPC_URL) return "unverified";
  return confirmHashExecution(env.CASPER_RPC_URL, hash);
}

function explorerBaseUrl(env: Record<string, string | undefined>): string {
  const network = [env.CASPER_CHAIN_NAME, env.CASPER_NETWORK, env.X402_NETWORK]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return network.includes("mainnet") || network === "casper" ? "https://cspr.live" : "https://testnet.cspr.live";
}

function explorerLink(baseUrl: string, kind: "deploy" | "transaction", value: string | undefined): string | null {
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) return null;
  return `${baseUrl}/${kind}/${value}`;
}

function kindForFacilitator(url: string): FacilitatorKind {
  return url.includes("cspr.cloud") ? "hosted" : "self-hosted";
}

function firstPresent(...values: Array<string | undefined>): string | null {
  return values.find((value) => Boolean(value)) ?? null;
}

function inlineOrMissing(value: string | null): string {
  return value ? `\`${value}\`` : "not captured";
}

function escapeMarkdownTable(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function parseCliOptions(args: string[]): CliOptions {
  const envFiles: string[] = [];
  let format: "markdown" | "json" = "markdown";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format" && args[index + 1]) {
      format = args[index + 1] === "json" ? "json" : "markdown";
      index += 1;
      continue;
    }
    if (arg === "--json") {
      format = "json";
      continue;
    }
    if (arg === "--env-file" && args[index + 1]) {
      envFiles.push(args[index + 1]);
      index += 1;
    }
  }

  return { envFiles, format };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseCliOptions(process.argv.slice(2));
  const env =
    options.envFiles.length > 0
      ? await loadSubmissionEnv(process.env, options.envFiles)
      : await loadSubmissionEnv(process.env);
  const bundle = await createDemoProofBundle({ env });
  console.log(options.format === "json" ? JSON.stringify(bundle, null, 2) : formatDemoProofBundleMarkdown(bundle));
  process.exitCode = bundle.status === "pass" ? 0 : 1;
}
