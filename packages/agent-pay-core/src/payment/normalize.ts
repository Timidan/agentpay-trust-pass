import { artifactHash } from "./canonical.js";
import type {
  NormalizeResult,
  OriginalRequest,
  OriginalRequestInput,
  PaymentRequirement,
  PaymentResource,
  Reason,
  ReasonCode
} from "./types.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const ACCOUNT_ADDRESS = /^00[0-9a-f]{64}$/;
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const HTTP_METHOD = /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]*$/;

export function normalizeOriginalRequest(input: OriginalRequestInput): OriginalRequest {
  const method = input.method.trim().toUpperCase();
  if (!HTTP_METHOD.test(method)) throw new TypeError("Original request method is invalid");

  const url = parseHttpUrl(input.url, "Original request URL");
  if (url.username || url.password) throw new TypeError("Original request URL must not include credentials");
  url.hash = "";

  const bodyHash = input.bodyHash.trim().toLowerCase();
  if (!HEX_64.test(bodyHash)) throw new TypeError("Original request bodyHash must be 64 hexadecimal characters");
  if (!Number.isSafeInteger(input.bodyBytes) || input.bodyBytes < 0) {
    throw new TypeError("Original request bodyBytes must be a non-negative safe integer");
  }

  const capturedAt = normalizeTimestamp(input.capturedAt, "Original request capturedAt");
  const adapterVersion = input.adapterVersion.trim();
  if (!adapterVersion || adapterVersion.length > 64) {
    throw new TypeError("Original request adapterVersion must contain 1 to 64 characters");
  }

  const normalizedWithoutHash = {
    method,
    url: url.toString(),
    scheme: url.protocol.slice(0, -1) as "http" | "https",
    origin: url.origin,
    path: `${url.pathname}${url.search}`,
    bodyHash,
    bodyBytes: input.bodyBytes,
    capturedAt,
    adapterVersion
  };

  return {
    ...normalizedWithoutHash,
    requestHash: artifactHash(normalizedWithoutHash)
  };
}

export function decodePaymentRequiredHeader(header: string): unknown {
  const encoded = header.trim();
  if (!encoded || encoded.length > 256 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new TypeError("PAYMENT-REQUIRED must be a Base64-encoded JSON object");
  }

  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
  } catch {
    throw new TypeError("PAYMENT-REQUIRED must be a Base64-encoded JSON object");
  }
}

export function normalizePaymentRequired(input: unknown, request: OriginalRequest): NormalizeResult {
  const root = asRecord(input);
  if (!root) return invalid("PAYMENT-REQUIRED must be a JSON object", "paymentRequired", "object", input);
  if (root.x402Version !== 2) {
    return failure(
      reason("unsupported_x402_version", "block", "Only x402 version 2 is supported", "x402Version", 2, root.x402Version)
    );
  }

  const resourceResult = parseResource(root.resource);
  if (!resourceResult.ok) return resourceResult.failure;
  const accepts = Array.isArray(root.accepts) ? root.accepts : null;
  if (!accepts || accepts.length === 0 || accepts.length > 16) {
    return invalid("accepts must contain between 1 and 16 payment requirements", "accepts", "1..16 items", root.accepts);
  }

  const compatible = accepts
    .map((candidate, index) => ({ candidate: asRecord(candidate), index }))
    .filter(({ candidate }) => candidate?.scheme === "exact" && candidate.network === "casper:casper-test");

  if (compatible.length === 0) {
    const exact = accepts.some((candidate) => asRecord(candidate)?.scheme === "exact");
    return failure(
      reason(
        exact ? "unsupported_network" : "unsupported_scheme",
        "block",
        exact ? "No supported Casper Testnet acceptance was offered" : "No supported exact payment acceptance was offered",
        exact ? "accepts.network" : "accepts.scheme",
        exact ? "casper:casper-test" : "exact",
        accepts
      )
    );
  }
  if (compatible.length !== 1) {
    return invalid("PAYMENT-REQUIRED contains ambiguous compatible acceptances", "accepts", 1, compatible.length);
  }

  const selected = compatible[0];
  const requirementResult = parseRequirement(selected.candidate);
  if (!requirementResult.ok) return requirementResult.failure;
  const requirement = requirementResult.requirement;
  const observedUrl = new URL(request.url);
  const declaredUrl = new URL(resourceResult.resource.url);
  const resourceComparison = {
    sameHost: observedUrl.host === declaredUrl.host,
    sameScheme: observedUrl.protocol === declaredUrl.protocol,
    samePath: `${observedUrl.pathname}${observedUrl.search}` === `${declaredUrl.pathname}${declaredUrl.search}`
  };
  const advisories: Reason[] = [];
  if (!resourceComparison.sameScheme) {
    advisories.push(
      reason(
        "resource_scheme_mismatch",
        "review",
        "The observed request and declared x402 resource use different URL schemes",
        "resource.url.scheme",
        observedUrl.protocol.slice(0, -1),
        declaredUrl.protocol.slice(0, -1)
      )
    );
  }

  const requirementHash = artifactHash({
    x402Version: 2,
    acceptanceIndex: selected.index,
    requirement,
    resource: resourceResult.resource
  });

  return {
    ok: true,
    request,
    terms: {
      x402Version: 2,
      acceptanceIndex: selected.index,
      ...requirement,
      resource: resourceResult.resource,
      resourceComparison,
      requirementHash
    },
    advisories
  };
}

function parseResource(value: unknown):
  | { ok: true; resource: PaymentResource }
  | { ok: false; failure: NormalizeResult } {
  const resource = asRecord(value);
  if (!resource) return { ok: false, failure: invalid("resource must be an object", "resource", "object", value) };

  if (typeof resource.url !== "string") {
    return { ok: false, failure: invalid("resource.url must be a URL", "resource.url", "absolute HTTP(S) URL", resource.url) };
  }

  let url: URL;
  try {
    url = parseHttpUrl(resource.url, "resource.url");
  } catch {
    return { ok: false, failure: invalid("resource.url must be a URL", "resource.url", "absolute HTTP(S) URL", resource.url) };
  }
  if (url.username || url.password) {
    return { ok: false, failure: invalid("resource.url must not contain credentials", "resource.url", "URL without credentials", resource.url) };
  }
  url.hash = "";

  if (typeof resource.description !== "string" || resource.description.length > 1024) {
    return { ok: false, failure: invalid("resource.description is invalid", "resource.description", "string <= 1024 chars", resource.description) };
  }
  if (typeof resource.mimeType !== "string" || !resource.mimeType || resource.mimeType.length > 128) {
    return { ok: false, failure: invalid("resource.mimeType is invalid", "resource.mimeType", "string <= 128 chars", resource.mimeType) };
  }

  return {
    ok: true,
    resource: {
      url: url.toString(),
      description: resource.description,
      mimeType: resource.mimeType
    }
  };
}

function parseRequirement(value: Record<string, unknown> | null):
  | { ok: true; requirement: PaymentRequirement }
  | { ok: false; failure: NormalizeResult } {
  if (!value) return { ok: false, failure: invalid("acceptance must be an object", "accepts", "object", value) };

  if (typeof value.amount !== "string" || !DECIMAL_INTEGER.test(value.amount) || BigInt(value.amount) <= 0n) {
    return { ok: false, failure: invalid("amount must be a positive atomic integer string", "accepts.amount", "positive integer string", value.amount) };
  }

  const asset = normalizeHash(value.asset, "hash-");
  if (!asset) return { ok: false, failure: invalid("asset must be a Casper package hash", "accepts.asset", "64 hex characters", value.asset) };
  const payTo = normalizeAccountAddress(value.payTo);
  if (!payTo) return { ok: false, failure: invalid("payTo must be a Casper account address", "accepts.payTo", "00 + 64 hex characters", value.payTo) };

  if (!Number.isInteger(value.maxTimeoutSeconds) || (value.maxTimeoutSeconds as number) < 1 || (value.maxTimeoutSeconds as number) > 900) {
    return { ok: false, failure: invalid("maxTimeoutSeconds is outside the supported range", "accepts.maxTimeoutSeconds", "1..900", value.maxTimeoutSeconds) };
  }

  const extra = asRecord(value.extra);
  if (!extra || typeof extra.name !== "string" || !extra.name || extra.name.length > 128) {
    return { ok: false, failure: invalid("extra.name is invalid", "accepts.extra.name", "string <= 128 chars", extra?.name) };
  }
  if (typeof extra.version !== "string" || !extra.version || extra.version.length > 32) {
    return { ok: false, failure: invalid("extra.version is invalid", "accepts.extra.version", "string <= 32 chars", extra.version) };
  }

  let decimals: string | null = null;
  if (extra.decimals !== undefined) {
    if (typeof extra.decimals !== "string" || !DECIMAL_INTEGER.test(extra.decimals) || BigInt(extra.decimals) > 255n) {
      return { ok: false, failure: invalid("extra.decimals is invalid", "accepts.extra.decimals", "integer string 0..255", extra.decimals) };
    }
    decimals = extra.decimals;
  }
  if (extra.symbol !== undefined && (typeof extra.symbol !== "string" || !extra.symbol || extra.symbol.length > 32)) {
    return { ok: false, failure: invalid("extra.symbol is invalid", "accepts.extra.symbol", "string <= 32 chars", extra.symbol) };
  }

  return {
    ok: true,
    requirement: {
      scheme: "exact",
      network: "casper:casper-test",
      asset,
      amount: value.amount,
      payTo,
      maxTimeoutSeconds: value.maxTimeoutSeconds as number,
      extra: {
        name: extra.name,
        version: extra.version,
        decimals,
        symbol: typeof extra.symbol === "string" ? extra.symbol : null
      }
    }
  };
}

function parseHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL`);
  }
  return url;
}

function normalizeTimestamp(value: string, label: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

function normalizeHash(value: unknown, prefix: string): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(new RegExp(`^${prefix}`), "");
  return HEX_64.test(normalized) ? normalized : null;
}

function normalizeAccountAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^account-hash-/, "00");
  return ACCOUNT_ADDRESS.test(normalized) ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalid(message: string, field: string, expected: unknown, received: unknown): NormalizeResult {
  return failure(reason("invalid_payment_required", "block", message, field, expected, received));
}

function failure(...reasons: Reason[]): NormalizeResult {
  return { ok: false, reasons };
}

function reason(
  code: ReasonCode,
  result: Reason["result"],
  message: string,
  field: string,
  expected: unknown,
  received: unknown
): Reason {
  return { code, result, message, field, expected, received };
}
