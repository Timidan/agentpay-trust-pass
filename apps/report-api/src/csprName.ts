import { publicKeyToAccountAddress } from "@agent-pay/core";
import { fetchBoundedJson } from "./httpJson.js";

const DEFAULT_API_BASE_URL = "https://api.cspr.name";
const MAX_RESPONSE_BYTES = 128 * 1024;
const PUBLIC_KEY = /^(01[0-9a-f]{64}|02[0-9a-f]{66})$/i;
const ACCOUNT_HASH = /^[0-9a-f]{64}$/i;
const NAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type ResolvedCsprName = {
  name: string;
  accountHash: string;
  publicKey: string | null;
  expiresAt: string;
  isPrimary: boolean;
  network: "casper-mainnet";
  source: "CSPR.name";
  sourceUrl: string;
};

export type ResolveCsprNameOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: number;
};

export function normalizeCsprName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  if (!name || name.length > 253) return null;
  const labels = name.split(".");
  if (labels.length < 2 || labels.at(-1) !== "cspr") return null;
  return labels.every((label) => NAME_LABEL.test(label)) ? name : null;
}

export async function resolveCsprName(
  rawName: string,
  options: ResolveCsprNameOptions = {}
): Promise<ResolvedCsprName | null> {
  const name = normalizeCsprName(rawName);
  if (!name) throw new TypeError("Invalid CSPR.name");

  const baseUrl = normalizeApiBaseUrl(options.apiBaseUrl ?? process.env.CSPR_NAME_API_BASE_URL);
  const endpoint = new URL(`resolutions/${encodeURIComponent(name)}`, `${baseUrl}/`).toString();
  const { response, body } = await fetchBoundedJson<{ data?: unknown }>(endpoint, {
    headers: { accept: "application/json" }
  }, {
    fetchImpl: options.fetchImpl,
    maxResponseBytes: MAX_RESPONSE_BYTES
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`CSPR.name resolution failed with ${response.status}`);
  }

  const data = asRecord(body.data);
  const resolvedName = typeof data?.name === "string" ? data.name.toLowerCase() : null;
  const resolvedHash = typeof data?.resolved_hash === "string"
    ? data.resolved_hash.toLowerCase()
    : null;
  const publicKey = data?.resolved_public_key == null
    ? null
    : typeof data.resolved_public_key === "string"
      ? data.resolved_public_key.toLowerCase()
      : "";
  const expiresAt = typeof data?.expires_at === "string" ? data.expires_at : null;
  const expiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;

  if (
    resolvedName !== name ||
    !resolvedHash ||
    !ACCOUNT_HASH.test(resolvedHash) ||
    (publicKey !== null && !PUBLIC_KEY.test(publicKey)) ||
    !expiresAt ||
    !Number.isFinite(expiry)
  ) {
    throw new Error("CSPR.name returned an invalid resolution");
  }
  if (expiry <= (options.now ?? Date.now())) return null;
  if (publicKey && publicKeyToAccountAddress(publicKey).slice(2) !== resolvedHash) {
    throw new Error("CSPR.name public key does not match its resolved account hash");
  }

  return {
    name,
    accountHash: `account-hash-${resolvedHash}`,
    publicKey,
    expiresAt,
    isPrimary: data?.is_primary === true,
    network: "casper-mainnet",
    source: "CSPR.name",
    sourceUrl: endpoint
  };
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("CSPR_NAME_API_BASE_URL must be an absolute URL");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("CSPR_NAME_API_BASE_URL must use HTTPS outside localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("CSPR_NAME_API_BASE_URL must not contain credentials, query parameters, or a fragment");
  }
  return url.toString().replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
