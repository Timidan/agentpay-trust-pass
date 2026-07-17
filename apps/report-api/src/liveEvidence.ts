import {
  hashJson,
  type Dataset,
  type EvidenceFactValue
} from "@agent-pay/core";
import { randomUUID } from "node:crypto";
import { fetchBoundedText } from "./httpJson.js";

type SourceSummary = {
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  recordHash: string;
  facts: Record<string, EvidenceFactValue>;
};

export type LiveEvidenceDataset = Dataset & {
  sourceSummary: SourceSummary[];
};

const DEFAULT_CSPR_TRADE_MCP_URL = "https://mcp.cspr.trade/mcp";

async function createMcpSession(mcpUrl: string) {
  const { response, body } = await fetchBoundedText(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-pay", version: "0.1.0" }
      }
    })
  });
  const sessionId = response.headers.get("mcp-session-id");
  if (!response.ok || !sessionId) {
    throw new Error(`CSPR.trade MCP initialize failed with ${response.status}`);
  }
  parseMcpEvent(body);
  return { sessionId };
}

async function mcpNotify(mcpUrl: string, sessionId: string, method: string, params: unknown) {
  const { response } = await fetchBoundedText(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params })
  });
  if (!response.ok) throw new Error(`CSPR.trade MCP notification failed with ${response.status}`);
}

async function mcpCallTool(
  mcpUrl: string,
  sessionId: string,
  name: string,
  toolArguments: Record<string, unknown>
) {
  const { response, body: payload } = await fetchBoundedText(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: toolArguments }
    })
  });
  const body = parseMcpEvent(payload);
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `CSPR.trade MCP tool ${name} failed with ${response.status}`);
  }
  const content = asRecord(body.result)?.content;
  const text = Array.isArray(content) ? asString(asRecord(content[0])?.text) : null;
  if (!text) {
    throw new Error(`CSPR.trade MCP tool ${name} returned no text payload`);
  }
  return JSON.parse(text) as unknown;
}

function parseMcpEvent(payload: string): { result?: unknown; error?: { message?: string } } {
  const data = payload
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!data) {
    throw new Error("MCP response did not include event data");
  }
  return JSON.parse(data) as { result?: unknown; error?: { message?: string } };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/* ----- Symbol resolution over the CSPR.trade pair set ----------------- */

export type ResolvedToken = {
  symbol: string;
  packageHash: string;
  name: string | null;
  network: "casper-mainnet";
};

type SymbolMapEntry = {
  packageHash: string;
  name: string | null;
  symbol: string;
  /** Same symbol seen with a different package hash — refuse to resolve it. */
  ambiguous: boolean;
};

const SYMBOL_CACHE_TTL_MS = 10 * 60 * 1000;
const SYMBOL_PAGE_SIZE = 50;
const SYMBOL_MAX_PAGES = 10;
const SYMBOL_FETCH_DEADLINE_MS = 12_000;
const SYMBOL_FETCH_ATTEMPTS = 2;

let symbolCache: { at: number; map: Map<string, SymbolMapEntry> } | null = null;
let symbolCacheFill: Promise<Map<string, SymbolMapEntry>> | null = null;
let pairCache: { at: number; pairs: Array<Record<string, unknown>> } | null = null;
let pairCacheFill: Promise<Array<Record<string, unknown>>> | null = null;

/**
 * Builds a symbol -> token map from cspr.trade pair objects. Scoping the
 * lookup to cspr.trade's own pair set sidesteps global symbol ambiguity.
 * A symbol that appears with two different package hashes (a spoofed pair
 * reusing a real ticker, or a genuine duplicate) is marked ambiguous and
 * never resolved — the caller is told to paste the exact hash instead.
 */
export function buildSymbolMap(pairs: Array<Record<string, unknown>>): Map<string, SymbolMapEntry> {
  const map = new Map<string, SymbolMapEntry>();
  for (const pair of pairs) {
    for (const side of ["token0", "token1"] as const) {
      const token = asRecord(pair[side]);
      const symbol = asString(token?.symbol);
      const packageHash = asString(token?.packageHash);
      if (!symbol || !packageHash || !/^[0-9a-f]{64}$/i.test(packageHash)) {
        continue;
      }
      const key = symbol.toUpperCase();
      const normalized = packageHash.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { symbol, packageHash: normalized, name: asString(token?.name), ambiguous: false });
      } else if (existing.packageHash !== normalized) {
        existing.ambiguous = true;
      }
    }
  }
  return map;
}

async function fetchAllTradePairs(mcpUrl: string): Promise<Array<Record<string, unknown>>> {
  const mcp = await createMcpSession(mcpUrl);
  await mcpNotify(mcpUrl, mcp.sessionId, "notifications/initialized", {});
  const all: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= SYMBOL_MAX_PAGES; page += 1) {
    const response = await mcpCallTool(mcpUrl, mcp.sessionId, "get_pairs", {
      page,
      page_size: SYMBOL_PAGE_SIZE,
      currency: "USD"
    });
    const data = asRecord(response) ?? {};
    const pairs = Array.isArray(data.data)
      ? data.data.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null)
      : [];
    all.push(...pairs);
    const pageCount = asNumber(data.pageCount) ?? 1;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw new Error("cspr.trade returned an invalid pair page count");
    }
    if (page === SYMBOL_MAX_PAGES && page < pageCount) {
      throw new Error(
        `cspr.trade pair scan exceeded the supported ${SYMBOL_MAX_PAGES}-page limit`
      );
    }
    if (page >= pageCount || pairs.length === 0) {
      break;
    }
  }
  return all;
}

async function fetchTradePairsWithRetry(mcpUrl: string): Promise<Array<Record<string, unknown>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SYMBOL_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchAllTradePairs(mcpUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function currentTradePairs(): Promise<Array<Record<string, unknown>>> {
  const now = Date.now();
  if (pairCache && now - pairCache.at <= SYMBOL_CACHE_TTL_MS) {
    return pairCache.pairs;
  }
  if (!pairCacheFill) {
    const mcpUrl = process.env.CSPR_TRADE_MCP_URL ?? DEFAULT_CSPR_TRADE_MCP_URL;
    pairCacheFill = withDeadline(fetchTradePairsWithRetry(mcpUrl), SYMBOL_FETCH_DEADLINE_MS)
      .then((pairs) => {
        if (pairs.length === 0) {
          throw new Error("cspr.trade pair set came back empty");
        }
        pairCache = { at: Date.now(), pairs };
        return pairs;
      })
      .finally(() => {
        pairCacheFill = null;
      });
  }
  return pairCacheFill;
}

export type CsprTradeMarketState = {
  listedOnCsprTrade: boolean;
  pairCount: number;
  pricedPairCount: number;
  pricedLiquidityUsd: number;
  sourceUrl: string;
  rawHash: string;
};

/**
 * Returns exact package-scoped pool observations from CSPR.trade. Pricing is
 * descriptive evidence only; AgentPay's policy never delegates a verdict to it.
 */
export async function fetchCsprTradeMarketState(
  packageHash: string
): Promise<CsprTradeMarketState> {
  const normalized = packageHash.replace(/^hash-/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError("CSPR.trade market lookup requires a 64-character package hash");
  }
  const matches = (await currentTradePairs()).filter((pair) =>
    ["token0", "token1"].some((side) =>
      asString(asRecord(pair[side])?.packageHash)?.toLowerCase() === normalized
    )
  );
  let pricedPairCount = 0;
  let pricedLiquidityUsd = 0;
  for (const pair of matches) {
    const side0 = pricedReserveUsd(pair, "token0", "reserve0", "fiatPrice0");
    const side1 = pricedReserveUsd(pair, "token1", "reserve1", "fiatPrice1");
    if (side0 === null || side1 === null) continue;
    pricedPairCount += 1;
    pricedLiquidityUsd += side0 + side1;
  }
  return {
    listedOnCsprTrade: matches.length > 0,
    pairCount: matches.length,
    pricedPairCount,
    pricedLiquidityUsd: roundUsd(pricedLiquidityUsd),
    sourceUrl: process.env.CSPR_TRADE_MCP_URL ?? DEFAULT_CSPR_TRADE_MCP_URL,
    rawHash: hashJson(matches)
  };
}

function pricedReserveUsd(
  pair: Record<string, unknown>,
  tokenSide: "token0" | "token1",
  reserveKey: "reserve0" | "reserve1",
  priceKey: "fiatPrice0" | "fiatPrice1"
): number | null {
  const token = asRecord(pair[tokenSide]);
  const decimals = asNumber(token?.decimals);
  const reserve = asString(pair[reserveKey]);
  const price = asNumber(pair[priceKey]);
  if (
    decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 30 ||
    reserve === null || !/^[0-9]{1,100}$/.test(reserve) ||
    price === null || !Number.isFinite(price) || price < 0
  ) {
    return null;
  }
  const units = Number(reserve) / 10 ** decimals;
  const value = units * price;
  return Number.isFinite(value) ? value : null;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Resolves a token symbol to its package hash within cspr.trade's pair set. */
export async function resolveTokenBySymbol(symbol: string): Promise<ResolvedToken | null> {
  const key = symbol.trim().toUpperCase();
  if (!key) {
    return null;
  }
  const now = Date.now();
  if (!symbolCache || now - symbolCache.at > SYMBOL_CACHE_TTL_MS) {
    // Single-flight: concurrent cold-cache resolves share one pair scan.
    if (!symbolCacheFill) {
      symbolCacheFill = currentTradePairs()
        .then((pairs) => buildSymbolMap(pairs))
        .finally(() => {
          symbolCacheFill = null;
        });
    }
    const map = await symbolCacheFill;
    if (map.size === 0) throw new Error("cspr.trade pair set contained no valid token identifiers");
    symbolCache = { at: now, map };
  }
  const entry = symbolCache.map.get(key);
  if (!entry || entry.ambiguous) {
    return null;
  }
  return {
    symbol: entry.symbol,
    packageHash: `hash-${entry.packageHash}`,
    name: entry.name,
    network: "casper-mainnet"
  };
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`cspr.trade pair scan exceeded ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
