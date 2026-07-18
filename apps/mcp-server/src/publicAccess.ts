import { normalizePackageHash, parseBaseUnitAmount } from "@agent-pay/core";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_REQUESTS_PER_WINDOW = 3;
const DEFAULT_DAILY_LIMIT = 100;
const DEFAULT_MAX_TRACKED_CLIENTS = 10_000;

export type PublicAssessmentAccess = {
  windowMs: number;
  requestsPerWindow: number;
  dailyLimit: number;
  maxTrackedClients: number;
  now?: () => Date;
};

export type BridgeAccessOptions = {
  authToken?: string;
  allowUnauthenticatedPrivilegedTools?: boolean;
  allowedOrigins?: string[];
  publicAssessments?: PublicAssessmentAccess;
};

export type PublicAssessmentLimitResult =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      reason: "client_rate" | "daily_limit";
      retryAfterSeconds: number;
    };

export function bridgeAccessOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): BridgeAccessOptions {
  const authToken = env.MCP_SERVER_AUTH_TOKEN?.trim();
  const allowedOrigins = parseAllowedOrigins(env.MCP_ALLOWED_ORIGINS);
  const allowUnauthenticatedPrivilegedTools =
    env.MCP_ALLOW_UNAUTHENTICATED_PRIVILEGED_TOOLS === "1";

  const publicEnabled = env.MCP_PUBLIC_TESTNET_ASSESSMENTS === "1";
  let publicAssessments: PublicAssessmentAccess | undefined;
  if (publicEnabled) {
    if (allowedOrigins.length === 0) {
      throw new TypeError("MCP_ALLOWED_ORIGINS is required for public testnet assessments");
    }
    requireTestnetConfiguration(env);
    publicAssessments = {
      windowMs: envPositiveInteger(
        env.MCP_PUBLIC_ASSESSMENT_WINDOW_MS,
        DEFAULT_WINDOW_MS,
        3_600_000,
        "MCP_PUBLIC_ASSESSMENT_WINDOW_MS"
      ),
      requestsPerWindow: envPositiveInteger(
        env.MCP_PUBLIC_ASSESSMENT_RATE_LIMIT,
        DEFAULT_REQUESTS_PER_WINDOW,
        10_000,
        "MCP_PUBLIC_ASSESSMENT_RATE_LIMIT"
      ),
      dailyLimit: envPositiveInteger(
        env.MCP_PUBLIC_ASSESSMENT_DAILY_LIMIT,
        DEFAULT_DAILY_LIMIT,
        100_000,
        "MCP_PUBLIC_ASSESSMENT_DAILY_LIMIT"
      ),
      maxTrackedClients: envPositiveInteger(
        env.MCP_RATE_LIMIT_MAX_CLIENTS,
        DEFAULT_MAX_TRACKED_CLIENTS,
        1_000_000,
        "MCP_RATE_LIMIT_MAX_CLIENTS"
      )
    };
  }

  return {
    ...(authToken ? { authToken } : {}),
    ...(allowUnauthenticatedPrivilegedTools
      ? { allowUnauthenticatedPrivilegedTools: true }
      : {}),
    ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    ...(publicAssessments ? { publicAssessments } : {})
  };
}

export function validateBridgeAccessOptions(options: BridgeAccessOptions): void {
  if (
    options.authToken !== undefined &&
    (options.authToken.length < 32 || options.authToken.length > 512)
  ) {
    throw new TypeError("MCP_SERVER_AUTH_TOKEN must contain 32 to 512 characters");
  }
  const origins = options.allowedOrigins ?? [];
  for (const origin of origins) normalizeOrigin(origin);
  if (new Set(origins).size !== origins.length) {
    throw new TypeError("MCP allowed origins must not contain duplicates");
  }
  if (options.publicAssessments) {
    if (origins.length === 0) {
      throw new TypeError("At least one allowed origin is required for public assessments");
    }
    positiveInteger(options.publicAssessments.windowMs, "public assessment windowMs");
    positiveInteger(
      options.publicAssessments.requestsPerWindow,
      "public assessment requestsPerWindow"
    );
    positiveInteger(options.publicAssessments.dailyLimit, "public assessment dailyLimit");
    positiveInteger(
      options.publicAssessments.maxTrackedClients,
      "public assessment maxTrackedClients"
    );
  }
}

export class PublicAssessmentLimiter {
  private readonly options: PublicAssessmentAccess;
  private readonly now: () => Date;
  private readonly clients = new Map<string, { startedAt: number; count: number }>();
  private dailyKey = "";
  private dailyCount = 0;

  constructor(options: PublicAssessmentAccess) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  consume(client: string): PublicAssessmentLimitResult {
    const now = this.now();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new Error("Public assessment clock returned an invalid date");
    const day = now.toISOString().slice(0, 10);
    if (day !== this.dailyKey) {
      this.dailyKey = day;
      this.dailyCount = 0;
    }
    if (this.dailyCount >= this.options.dailyLimit) {
      return {
        allowed: false,
        reason: "daily_limit",
        retryAfterSeconds: secondsUntilNextUtcDay(now)
      };
    }

    let state = this.clients.get(client);
    if (!state || nowMs - state.startedAt >= this.options.windowMs) {
      state = { startedAt: nowMs, count: 0 };
    }
    if (state.count >= this.options.requestsPerWindow) {
      return {
        allowed: false,
        reason: "client_rate",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((state.startedAt + this.options.windowMs - nowMs) / 1_000)
        )
      };
    }

    state.count += 1;
    this.dailyCount += 1;
    setBoundedClient(this.clients, client, state, this.options.maxTrackedClients);
    return {
      allowed: true,
      remaining: Math.min(
        this.options.requestsPerWindow - state.count,
        this.options.dailyLimit - this.dailyCount
      )
    };
  }
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(",").map((value) => normalizeOrigin(value.trim())))];
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("MCP allowed origins must be absolute HTTP(S) origins");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    throw new TypeError("MCP allowed origins must use HTTPS outside localhost");
  }
  if (url.origin !== value || url.username || url.password) {
    throw new TypeError("MCP allowed origins must not include paths, credentials, queries, or fragments");
  }
  return url.origin;
}

function requireTestnetConfiguration(env: NodeJS.ProcessEnv): void {
  const network = env.X402_NETWORK?.trim() || "casper:casper-test";
  const chainName = env.CASPER_CHAIN_NAME?.trim() || "casper-test";
  const casperNetwork = env.CASPER_NETWORK?.trim() || "casper-testnet";
  if (
    network !== "casper:casper-test" ||
    chainName !== "casper-test" ||
    casperNetwork !== "casper-testnet"
  ) {
    throw new TypeError("Public funded assessments can only be enabled on Casper testnet");
  }

  const payee = requiredEnv(env, "PAYEE_ADDRESS").toLowerCase();
  const expectedPayee = requiredEnv(env, "AGENT_PAY_EXPECTED_PAYEE_ADDRESS").toLowerCase();
  if (!/^00[0-9a-f]{64}$/.test(payee) || !/^00[0-9a-f]{64}$/.test(expectedPayee)) {
    throw new TypeError("Public assessment payee settings must be Casper account hashes");
  }
  if (payee !== expectedPayee) {
    throw new TypeError(
      "AGENT_PAY_EXPECTED_PAYEE_ADDRESS must match PAYEE_ADDRESS for public assessments"
    );
  }
  const asset = normalizeAsset(requiredEnv(env, "X402_ASSET_PACKAGE_HASH"));
  const expectedAsset = normalizeAsset(requiredEnv(env, "AGENT_PAY_EXPECTED_X402_ASSET"));
  if (!/^[0-9a-f]{64}$/.test(asset) || !/^[0-9a-f]{64}$/.test(expectedAsset)) {
    throw new TypeError("Public assessment asset settings must be Casper package hashes");
  }
  if (asset !== expectedAsset) {
    throw new TypeError(
      "AGENT_PAY_EXPECTED_X402_ASSET must match X402_ASSET_PACKAGE_HASH for public assessments"
    );
  }
  const expectedNetwork = requiredEnv(env, "AGENT_PAY_EXPECTED_NETWORK");
  if (expectedNetwork !== network) {
    throw new TypeError(
      "AGENT_PAY_EXPECTED_NETWORK must match X402_NETWORK for public assessments"
    );
  }
  const amount = positiveBaseUnits(requiredEnv(env, "AGENT_PAY_REPORT_AMOUNT"), "AGENT_PAY_REPORT_AMOUNT");
  const maximum = positiveBaseUnits(
    requiredEnv(env, "AGENT_PAY_MAX_REPORT_AMOUNT"),
    "AGENT_PAY_MAX_REPORT_AMOUNT"
  );
  if (amount > maximum) {
    throw new TypeError(
      "AGENT_PAY_REPORT_AMOUNT must not exceed AGENT_PAY_MAX_REPORT_AMOUNT for public assessments"
    );
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for public funded assessments`);
  return value;
}

function normalizeAsset(value: string): string {
  return normalizePackageHash(value);
}

function positiveBaseUnits(value: string, name: string): bigint {
  const parsed = parseBaseUnitAmount(value);
  if (!parsed.ok) {
    throw new TypeError(
      parsed.reason === "not_positive_integer"
        ? `${name} must be a positive integer in token base units`
        : `${name} exceeds the U256 token transfer limit`
    );
  }
  return parsed.amount;
}

function envPositiveInteger(
  raw: string | undefined,
  fallback: number,
  maximum: number,
  name: string
): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1_000));
}

function setBoundedClient<T>(map: Map<string, T>, key: string, value: T, maximum: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > maximum) {
    const oldest = map.keys().next().value as string | undefined;
    if (!oldest) break;
    map.delete(oldest);
  }
}
