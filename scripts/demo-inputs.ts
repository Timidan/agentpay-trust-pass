import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://agentpay.timidan.xyz";
const TOKEN_INPUT = "WCSPR";
const TOKEN_EVIDENCE_NETWORK = "casper-mainnet";
const PAYMENT_SERVICE = "Tab402";
const PAYMENT_ENDPOINT = "https://tab402.fly.dev/v1/speak";
const PAYMENT_SOURCE_REPOSITORY = "https://github.com/Eienel/tab402";
const PAYMENT_BODY = { text: "AgentPay live final demo" } as const;
const WALLET_INPUT =
  "account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785";
const CASPER_PACKAGE_HASH = /^(?:hash-)?[0-9a-f]{64}$/i;
const CASPER_ACCOUNT_ADDRESS = /^00[0-9a-f]{64}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

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
    service: string;
    sourceRepository: string;
    endpoint: string;
    challengeStatus: 402;
    method: "POST";
    body: { text: string };
    declaredResource: string;
    description: string;
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

  const endpoint = new URL(PAYMENT_ENDPOINT);
  const challenge = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(PAYMENT_BODY)
  });
  const encodedPaymentRequired = challenge.headers.get("payment-required");
  if (challenge.status !== 402 || !encodedPaymentRequired) {
    throw new Error(
      `${PAYMENT_SERVICE} returned HTTP ${challenge.status} without a PAYMENT-REQUIRED header`
    );
  }

  const paymentRequired = decodePaymentRequired(encodedPaymentRequired);
  if (paymentRequired.x402Version !== 2) {
    throw new Error(`${PAYMENT_SERVICE} does not advertise x402 version 2`);
  }
  const acceptances = Array.isArray(paymentRequired.accepts) ? paymentRequired.accepts : [];
  const compatible = acceptances.filter((value) => {
    const candidate = requireObject(value, "payment acceptance");
    return candidate.scheme === "exact" && candidate.network === "casper:casper-test";
  });
  if (compatible.length !== 1) {
    throw new Error(`${PAYMENT_SERVICE} must offer exactly one Casper Testnet exact payment`);
  }

  const requirement = requireObject(compatible[0], "payment requirement");
  const paymentResource = requireObject(paymentRequired.resource, "payment resource");
  const declaredResource = new URL(requireString(paymentResource.url, "payment resource URL"));
  if (declaredResource.host !== endpoint.host || declaredResource.pathname !== endpoint.pathname) {
    throw new Error(`${PAYMENT_SERVICE} declared a different paid resource`);
  }
  const amount = requirePositiveInteger(requirement.amount, "payment amount");
  const assetPackageHash = requireString(requirement.asset, "payment asset package hash").replace(/^hash-/, "");
  if (!CASPER_PACKAGE_HASH.test(assetPackageHash)) {
    throw new Error(`${PAYMENT_SERVICE} returned an invalid Casper payment asset package hash`);
  }
  const payTo = requireString(requirement.payTo, "payment recipient");
  if (!CASPER_ACCOUNT_ADDRESS.test(payTo)) {
    throw new Error(`${PAYMENT_SERVICE} returned an invalid Casper payment recipient`);
  }
  const extra = requireObject(requirement.extra, "payment asset metadata");
  const decimals = requireDecimals(extra.decimals);
  const asset = requireString(extra.symbol, "payment asset symbol");

  return {
    generatedAt: now.toISOString(),
    token: {
      input: TOKEN_INPUT,
      packageHash,
      evidenceNetwork: TOKEN_EVIDENCE_NETWORK
    },
    wallet: { input: WALLET_INPUT },
    payment: {
      service: PAYMENT_SERVICE,
      sourceRepository: PAYMENT_SOURCE_REPOSITORY,
      endpoint: endpoint.toString(),
      challengeStatus: 402,
      method: "POST",
      body: { ...PAYMENT_BODY },
      declaredResource: declaredResource.toString(),
      description: requireString(paymentResource.description, "payment resource description"),
      amount,
      amountDisplay: formatAtomicAmount(amount, decimals),
      asset,
      assetPackageHash,
      network: requireString(requirement.network, "payment network"),
      payTo
    },
    bridgeStatusEndpoint: new URL("/bridge/tools/payment_status", origin).toString()
  };
}

export function formatDemoInputs(inputs: DemoInputs): string {
  return [
    "AgentPay one-take demo inputs",
    `Generated: ${inputs.generatedAt}`,
    "",
    "PAYMENT CHECKER - THIRD-PARTY CASPER SERVICE",
    `Service: ${inputs.payment.service} (not operated by AgentPay)`,
    `Source: ${inputs.payment.sourceRepository}`,
    `URL: ${inputs.payment.endpoint}`,
    `Challenge: HTTP ${inputs.payment.challengeStatus} verified`,
    `Method: ${inputs.payment.method}`,
    `Body: ${JSON.stringify(inputs.payment.body)}`,
    `Declared resource: ${inputs.payment.declaredResource}`,
    `Description: ${inputs.payment.description}`,
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

function requirePositiveInteger(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (!POSITIVE_INTEGER.test(parsed)) throw new Error(`${label} must be a positive integer string`);
  return parsed;
}

function requireDecimals(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error("payment asset decimals must be an integer from 0 to 255");
  }
  return parsed;
}

function formatAtomicAmount(amount: string, decimals: number): string {
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function decodePaymentRequired(encoded: string): Record<string, unknown> {
  if (!encoded.trim() || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded.trim())) {
    throw new Error(`${PAYMENT_SERVICE} returned a malformed PAYMENT-REQUIRED header`);
  }
  try {
    return requireObject(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")), "PAYMENT-REQUIRED");
  } catch {
    throw new Error(`${PAYMENT_SERVICE} returned a malformed PAYMENT-REQUIRED header`);
  }
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
