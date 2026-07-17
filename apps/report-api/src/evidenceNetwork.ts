export const EVIDENCE_NETWORKS = ["casper-mainnet", "casper-testnet"] as const;

export type EvidenceNetwork = (typeof EVIDENCE_NETWORKS)[number];

const DEFAULT_MAINNET_RPC_URL = "https://node.mainnet.casper.network/rpc";
const DEFAULT_TESTNET_RPC_URL = "https://node.testnet.casper.network/rpc";

export function parseEvidenceNetwork(value: unknown): EvidenceNetwork | null {
  return value === "casper-mainnet" || value === "casper-testnet" ? value : null;
}

export function defaultEvidenceNetwork(env: NodeJS.ProcessEnv = process.env): EvidenceNetwork {
  const configured = env.AGENTPAY_DEFAULT_EVIDENCE_NETWORK?.trim();
  if (!configured) return "casper-testnet";
  const network = parseEvidenceNetwork(configured);
  if (!network) {
    throw new TypeError(
      "AGENTPAY_DEFAULT_EVIDENCE_NETWORK must be casper-mainnet or casper-testnet"
    );
  }
  return network;
}

export function evidenceRpcUrl(
  network: EvidenceNetwork,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (network === "casper-mainnet") {
    return env.AGENTPAY_MAINNET_RPC_URL?.trim() || DEFAULT_MAINNET_RPC_URL;
  }
  return (
    env.AGENTPAY_TESTNET_RPC_URL?.trim() ||
    env.CASPER_RPC_URL?.trim() ||
    DEFAULT_TESTNET_RPC_URL
  );
}

export function csprCloudEndpoints(
  network: EvidenceNetwork,
  env: NodeJS.ProcessEnv = process.env
): { restBase: string; nodeRpcUrl: string } {
  return network === "casper-mainnet"
    ? {
        restBase: env.CSPR_CLOUD_BASE_URL?.trim() || "https://api.cspr.cloud",
        nodeRpcUrl: env.CSPR_CLOUD_NODE_RPC_URL?.trim() || "https://node.cspr.cloud/rpc"
      }
    : {
        restBase:
          env.CSPR_CLOUD_SUBJECT_BASE_URL?.trim() ||
          "https://api.testnet.cspr.cloud",
        nodeRpcUrl:
          env.CSPR_CLOUD_SUBJECT_NODE_RPC_URL?.trim() ||
          "https://node.testnet.cspr.cloud/rpc"
      };
}
