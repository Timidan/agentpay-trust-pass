import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const DEFAULT_ORIGIN = "https://agentpay.timidan.xyz";
const LOOPBACK_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/gi;
const CASPER_PACKAGE_HASH = /^(?:hash-)?[0-9a-f]{64}$/i;

export interface ProductionVerificationOptions {
  origin?: string;
  fetchImpl?: typeof fetch;
}

export interface ProductionVerificationResult {
  origin: string;
  checks: string[];
  applicationAssets: string[];
}

export async function verifyProduction(
  options: ProductionVerificationOptions = {}
): Promise<ProductionVerificationResult> {
  const origin = normalizeProductionOrigin(
    options.origin ?? process.env.AGENTPAY_PRODUCTION_URL ?? DEFAULT_ORIGIN
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const checks: string[] = [];
  const failures: string[] = [];

  const html = await captureFailure(failures, () =>
    fetchText(fetchImpl, new URL("/", origin), "web app")
  );
  const applicationAssets = html === null ? [] : firstPartyScriptUrls(html, origin);
  if (html !== null) {
    await captureFailure(failures, async () => {
      rejectLoopbackUrl(html, "public HTML");
      if (applicationAssets.length === 0) {
        throw new Error("public HTML does not load a first-party application script");
      }
      for (const assetUrl of applicationAssets) {
        const source = await fetchText(fetchImpl, new URL(assetUrl), `application asset ${assetUrl}`);
        rejectLoopbackUrl(source, `application asset ${assetUrl}`);
      }
      checks.push("application bundle has no loopback URL");
    });

    await captureFailure(failures, async () => {
      requireText(
        html,
        "AgentPay: check x402 charges before paying on Casper",
        "public HTML is not the current payment-auditor build"
      );
      checks.push("current public HTML");
    });
  }

  await captureFailure(failures, async () => {
    await fetchJson(fetchImpl, new URL("/api/health", origin), "report API health");
    await fetchJson(fetchImpl, new URL("/bridge/health", origin), "MCP bridge health");
    checks.push("public API and MCP bridge health");
  });

  await captureFailure(failures, async () => {
    const paymentStatus = await fetchJson(
      fetchImpl,
      new URL("/bridge/tools/payment_status", origin),
      "public payment status",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }
    );
    const serializedPaymentStatus = JSON.stringify(paymentStatus);
    rejectLoopbackUrl(serializedPaymentStatus, "public payment status");
    if ("facilitatorUrl" in paymentStatus) {
      throw new Error("public payment status exposes facilitator URL");
    }
    const supportedKind = asRecord(paymentStatus.supportedKind);
    if (supportedKind && "feePayer" in supportedKind) {
      throw new Error("public payment status exposes facilitator fee payer");
    }
    if (paymentStatus.status !== "ready") {
      const reason = typeof paymentStatus.reason === "string" ? `: ${paymentStatus.reason}` : "";
      throw new Error(`public payment status is not ready${reason}`);
    }
    if (
      supportedKind?.x402Version !== 2 ||
      supportedKind.scheme !== "exact" ||
      supportedKind.network !== "casper:casper-test"
    ) {
      throw new Error("public payment status does not confirm x402 v2 exact Casper Testnet support");
    }
    checks.push("public payment status is ready and hides server-only facilitator details");
  });

  await captureFailure(failures, async () => {
    const registryStatus = await fetchJson(
      fetchImpl,
      new URL("/bridge/tools/registry_status", origin),
      "public registry status",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }
    );
    const serializedRegistryStatus = JSON.stringify(registryStatus);
    rejectLoopbackUrl(serializedRegistryStatus, "public registry status");
    if ("recordScript" in registryStatus) {
      throw new Error("public registry status exposes record script");
    }
    const registryRpc = asRecord(registryStatus.rpc);
    if (registryRpc && "url" in registryRpc) {
      throw new Error("public registry status exposes RPC endpoint");
    }
    const receiptAnchors = asRecord(registryStatus.receiptAnchors);
    if (receiptAnchors && ("recordScript" in receiptAnchors || "recorderKeyConfigured" in receiptAnchors)) {
      throw new Error("public registry status exposes receipt recorder internals");
    }
    if (/CASPER_SECRET_KEY_PATH|AGENT_PAY_RECORD_SCRIPT|record-decision/i.test(serializedRegistryStatus)) {
      throw new Error("public registry status exposes server configuration details");
    }
    const registryChecks = Array.isArray(registryStatus.checks)
      ? registryStatus.checks.map(asRecord).filter((check): check is Record<string, unknown> => check !== null)
      : [];
    const privateCheckNames = new Set(["record_script", "casper_secret_key", "casper_client"]);
    if (registryChecks.some((check) => typeof check.name === "string" && privateCheckNames.has(check.name))) {
      throw new Error("public registry status exposes private readiness checks");
    }
    if (registryStatus.status !== "ready" || receiptAnchors?.status !== "ready") {
      throw new Error("public registry and receipt recording are not ready");
    }
    checks.push("public registry status hides server internals and confirms receipt recording");
  });

  await captureFailure(failures, async () => {
    const resolution = await fetchJson(
      fetchImpl,
      new URL("/api/resolve?symbol=WCSPR", origin),
      "public WCSPR resolution"
    );
    const packageHash = resolution.packageHash;
    if (typeof packageHash !== "string" || !CASPER_PACKAGE_HASH.test(packageHash)) {
      throw new Error("public WCSPR resolution returned an invalid Casper package hash");
    }
    const quoteUrl = new URL("/api/reports/quote", origin);
    quoteUrl.searchParams.set("subject", packageHash);
    quoteUrl.searchParams.set("network", "casper-mainnet");
    const quote = await fetchJson(fetchImpl, quoteUrl, "fresh WCSPR quote");
    rejectLoopbackUrl(JSON.stringify(quote), "fresh WCSPR quote");
    const paymentResource = asRecord(quote.paymentResource);
    const paymentResourceUrl = paymentResource?.url;
    if (typeof paymentResourceUrl !== "string") {
      throw new Error("fresh WCSPR quote is missing its payment resource URL");
    }
    const parsedPaymentResource = new URL(paymentResourceUrl);
    if (parsedPaymentResource.protocol !== "https:" || parsedPaymentResource.origin !== origin) {
      throw new Error("fresh WCSPR quote does not use the public AgentPay HTTPS origin");
    }
    checks.push("fresh public WCSPR quote has no loopback URL");

    requireWcsprEvidence(quote);
    checks.push("fresh public WCSPR quote includes required token evidence");
  });

  await captureFailure(failures, async () => {
    const skill = await fetchText(fetchImpl, new URL("/api/skill.md", origin), "hosted AgentPay skill");
    rejectLoopbackUrl(skill, "hosted AgentPay skill");
    requireText(skill, "check_x402_payment", "hosted skill is missing the payment-auditor tool");
    if (skill.includes("$AGENT_PAY_BASE_URL")) {
      throw new Error("hosted skill still contains its unresolved public API placeholder");
    }
    checks.push("current hosted agent skill");
  });

  if (failures.length > 0) {
    throw new Error(`Production verification failed:\n- ${failures.join("\n- ")}`);
  }

  return { origin, checks, applicationAssets };
}

function normalizeProductionOrigin(candidate: string): string {
  const url = new URL(candidate);
  if (url.protocol !== "https:") {
    throw new TypeError("AGENTPAY_PRODUCTION_URL must use HTTPS");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("AGENTPAY_PRODUCTION_URL must be an origin without a path, query, or fragment");
  }
  return url.origin;
}

function firstPartyScriptUrls(html: string, origin: string): string[] {
  const urls = new Set<string>();
  const sourcePattern = /<script\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>/gi;
  for (const match of html.matchAll(sourcePattern)) {
    const url = new URL(match[2], origin);
    if (url.origin === origin) urls.add(url.toString());
  }
  return [...urls];
}

async function captureFailure<T>(
  failures: string[],
  operation: () => Promise<T>
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function fetchText(
  fetchImpl: typeof fetch,
  url: URL,
  label: string,
  init?: RequestInit
): Promise<string> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return await response.text();
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
  label: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const text = await fetchText(fetchImpl, url, label, init);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("response is not a JSON object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} returned invalid JSON: ${reason}`);
  }
}

function rejectLoopbackUrl(value: string, label: string): void {
  const matches = [...new Set(value.match(LOOPBACK_URL) ?? [])];
  if (matches.length > 0) {
    throw new Error(`${label} exposes loopback URL ${matches.join(", ")}`);
  }
}

function requireText(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) throw new Error(message);
}

function requireWcsprEvidence(quote: Record<string, unknown>): void {
  const sourceSummary = Array.isArray(quote.sourceSummary) ? quote.sourceSummary : [];
  const factsFor = (subject: string): Record<string, unknown> => {
    const source = sourceSummary
      .map(asRecord)
      .find((entry) => entry?.subject === subject);
    return asRecord(source?.facts) ?? {};
  };

  const authority = factsFor("token_authority");
  const holders = factsFor("token_holders");
  const age = factsFor("token_age");
  const missing: string[] = [];

  if (
    typeof authority.mintBurnEnabled !== "boolean" &&
    typeof authority.publicMintEntrypoint !== "boolean"
  ) {
    missing.push("supply control");
  }
  if (!isNonNegativeInteger(age.contractAgeBlocks)) missing.push("contract age");
  if (!isNonNegativeInteger(holders.holderCount)) missing.push("holder count");
  if (!isPercentage(holders.topHolderPct)) missing.push("top-holder concentration");

  if (missing.length > 0) {
    throw new Error(
      `fresh WCSPR quote is missing required token evidence: ${missing.join(", ")}`
    );
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function main(): Promise<void> {
  const result = await verifyProduction();
  console.log(`AgentPay production verified at ${result.origin}`);
  for (const check of result.checks) console.log(`- ${check}`);
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
