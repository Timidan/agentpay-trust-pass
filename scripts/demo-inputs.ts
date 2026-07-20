import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://agentpay.timidan.xyz";
const TOKEN_INPUT = "WCSPR";
const TOKEN_EVIDENCE_NETWORK = "casper-mainnet";
const WALLET_INPUT =
  "account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785";
const CASPER_PACKAGE_HASH = /^(?:hash-)?[0-9a-f]{64}$/i;

export type DemoInputs = {
  generatedAt: string;
  token: {
    input: string;
    packageHash: string;
    evidenceNetwork: string;
  };
  wallet: {
    input: string;
  };
  payment: {
    endpoint: string;
    challengeStatus: 402;
    method: "POST";
    body: Record<string, never>;
    expiresAt: string;
    amount: string;
    amountDisplay: string;
    asset: string;
    assetPackageHash: string;
    network: string;
    payTo: string;
  };
  bridgeStatusEndpoint: string;
};

export async function getDemoInputs(options: {
  origin?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<DemoInputs> {
  const origin = productionOrigin(options.origin ?? process.env.AGENTPAY_PRODUCTION_URL ?? DEFAULT_ORIGIN);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();

  const resolution = await fetchObject(
    fetchImpl,
    new URL(`/api/resolve?symbol=${TOKEN_INPUT}`, origin),
    "WCSPR resolution"
  );
  const packageHash = requireString(resolution.packageHash, "WCSPR package hash");
  if (!CASPER_PACKAGE_HASH.test(packageHash)) {
    throw new Error("WCSPR resolution returned an invalid Casper package hash");
  }
  if (resolution.network !== TOKEN_EVIDENCE_NETWORK) {
    throw new Error(`WCSPR resolution returned ${String(resolution.network)} instead of ${TOKEN_EVIDENCE_NETWORK}`);
  }

  const quoteUrl = new URL("/api/reports/quote", origin);
  quoteUrl.searchParams.set("subject", packageHash);
  quoteUrl.searchParams.set("network", TOKEN_EVIDENCE_NETWORK);
  const quote = await fetchObject(fetchImpl, quoteUrl, "fresh x402 quote");
  const paymentResource = requireObject(quote.paymentResource, "payment resource");
  const paymentRequirements = Array.isArray(quote.paymentRequirements) ? quote.paymentRequirements : [];
  const requirement = requireObject(paymentRequirements[0], "payment requirement");
  const endpoint = new URL(requireString(paymentResource.url, "payment resource URL"));
  const expiresAt = new Date(requireString(quote.expiresAt, "quote expiry"));

  if (endpoint.protocol !== "https:" || endpoint.origin !== origin || !endpoint.pathname.startsWith("/api/reports/buy/")) {
    throw new Error("fresh x402 endpoint is not an AgentPay HTTPS purchase URL");
  }
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error("fresh x402 quote is already expired");
  }
  if (requireObject(quote.paymentReadiness, "payment readiness").status !== "ready") {
    throw new Error("AgentPay x402 payment path is not ready");
  }
  const challenge = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  if (challenge.status !== 402 || !challenge.headers.get("payment-required")) {
    throw new Error(`fresh x402 endpoint returned HTTP ${challenge.status} without a PAYMENT-REQUIRED header`);
  }

  return {
    generatedAt: now.toISOString(),
    token: {
      input: TOKEN_INPUT,
      packageHash,
      evidenceNetwork: TOKEN_EVIDENCE_NETWORK
    },
    wallet: { input: WALLET_INPUT },
    payment: {
      endpoint: endpoint.toString(),
      challengeStatus: 402,
      method: "POST",
      body: {},
      expiresAt: expiresAt.toISOString(),
      amount: requireString(requirement.amount, "payment amount"),
      amountDisplay: requireString(quote.amountDisplay, "display amount"),
      asset: requireString(quote.asset, "payment asset"),
      assetPackageHash: requireString(quote.assetPackageHash, "payment asset package hash"),
      network: requireString(requirement.network, "payment network"),
      payTo: requireString(requirement.payTo, "payment recipient")
    },
    bridgeStatusEndpoint: new URL("/bridge/tools/payment_status", origin).toString()
  };
}

export function formatDemoInputs(inputs: DemoInputs): string {
  return [
    "AgentPay one-take demo inputs",
    `Generated: ${inputs.generatedAt}`,
    "",
    "PAYMENT CHECKER",
    `URL: ${inputs.payment.endpoint}`,
    `Challenge: HTTP ${inputs.payment.challengeStatus} verified`,
    `Method: ${inputs.payment.method}`,
    `Body: ${JSON.stringify(inputs.payment.body)}`,
    `Expires: ${inputs.payment.expiresAt}`,
    `Charge: ${inputs.payment.amountDisplay} ${inputs.payment.asset} (${inputs.payment.amount} base units)`,
    `Network: ${inputs.payment.network}`,
    `Payment token: hash-${inputs.payment.assetPackageHash.replace(/^hash-/, "")}`,
    `Pay to: ${inputs.payment.payTo}`,
    "",
    "TOKEN CHECK",
    `Input: ${inputs.token.input}`,
    `Resolved package: ${inputs.token.packageHash}`,
    `Evidence network: ${inputs.token.evidenceNetwork}`,
    "",
    "WALLET CHECK",
    `Input: ${inputs.wallet.input}`,
    "",
    "PUBLIC HTTP BRIDGE CHECK",
    `curl -fsS -X POST ${inputs.bridgeStatusEndpoint} -H 'Content-Type: application/json' --data '{}'`
  ].join("\n");
}

function productionOrigin(candidate: string): string {
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("AgentPay production URL must be an HTTPS origin");
  }
  return url.origin;
}

async function fetchObject(fetchImpl: typeof fetch, url: URL, label: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return requireObject(await response.json(), label);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing`);
  return value;
}

async function main(): Promise<void> {
  console.log(formatDemoInputs(await getDemoInputs()));
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
