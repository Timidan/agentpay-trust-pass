import {
  buildDataset,
  hashJson,
  type Dataset,
  type EvidenceFactValue,
  type EvidenceRecord
} from "@agent-pay/core";
import { randomUUID } from "node:crypto";

type SourceSummary = {
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  recordHash: string;
  facts: Record<string, EvidenceFactValue>;
};

export type LiveEvidenceDataset = Dataset & {
  sourceSummary: SourceSummary[];
};

const DEFAULT_CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";
const DEFAULT_CSPR_TRADE_MCP_URL = "https://mcp.cspr.trade/mcp";

export async function buildLiveEvidenceDataset(): Promise<LiveEvidenceDataset> {
  const casperRpcUrl = process.env.CASPER_RPC_URL ?? DEFAULT_CASPER_RPC_URL;
  const csprTradeMcpUrl = process.env.CSPR_TRADE_MCP_URL ?? DEFAULT_CSPR_TRADE_MCP_URL;
  const observedAt = new Date().toISOString();

  const [status, block, csprTrade] = await Promise.all([
    getCasperStatus(casperRpcUrl),
    getLatestCasperBlock(casperRpcUrl),
    getCsprTradePairs(csprTradeMcpUrl).catch((error: unknown) =>
      unavailableRecord({
        product: "CSPR.trade MCP",
        network: "casper-mainnet",
        subject: "dex_pair_surface",
        sourceUrl: csprTradeMcpUrl,
        observedAt,
        error
      })
    )
  ]);

  const records = [status.record, block.record, csprTrade.record];
  const datasetId = `agent-pay-live-${block.height}-${block.hash.slice(0, 16)}`;
  const dataset = buildDataset(datasetId, records);

  return {
    ...dataset,
    sourceSummary: dataset.reports.map((report) => ({
      product: report.record.product,
      network: report.record.network,
      subject: report.record.subject,
      observedAt: report.record.observedAt,
      recordHash: report.reportHash,
      facts: report.record.facts
    }))
  };
}

type CasperStatusResult = {
  record: EvidenceRecord;
};

async function getCasperStatus(rpcUrl: string): Promise<CasperStatusResult> {
  const result = await casperRpc<Record<string, unknown>>(rpcUrl, "info_get_status", []);
  const peers = Array.isArray(result.peers) ? result.peers : [];
  const lastBlock = asRecord(result.last_added_block_info);
  const observedAt = asString(lastBlock?.timestamp) ?? new Date().toISOString();
  const facts = {
    apiVersion: asString(result.api_version),
    protocolVersion: asString(result.protocol_version),
    peerCount: peers.length,
    lastBlockHash: asString(lastBlock?.hash),
    lastBlockHeight: asNumber(lastBlock?.height)
  };

  return {
    record: evidenceRecord({
      id: `casper-rpc-status-${facts.lastBlockHeight ?? Date.now()}`,
      product: "Casper Node RPC",
      network: "casper-testnet",
      subject: "network_status",
      observedAt,
      sourceUrl: rpcUrl,
      facts,
      raw: result
    })
  };
}

type CasperBlockResult = {
  record: EvidenceRecord;
  height: number;
  hash: string;
};

async function getLatestCasperBlock(rpcUrl: string): Promise<CasperBlockResult> {
  const result = await casperRpc<Record<string, unknown>>(rpcUrl, "chain_get_block", []);
  const blockWithSignatures = asRecord(result.block_with_signatures);
  const block = asVersionedRecord(asRecord(blockWithSignatures?.block));
  const header = asRecord(block?.header);
  const body = asRecord(block?.body);
  const hash = asString(block?.hash) ?? asString(header?.hash) ?? hashJson(result);
  const height = asNumber(header?.height) ?? 0;
  const observedAt = asString(header?.timestamp) ?? new Date().toISOString();
  const transactions = countTransactions(body?.transactions);
  const facts = {
    blockHash: hash,
    height,
    eraId: asNumber(header?.era_id),
    protocolVersion: asString(header?.protocol_version),
    stateRootHash: asString(header?.state_root_hash),
    transactionCount: transactions,
    proposer: asString(header?.proposer)
  };

  return {
    height,
    hash,
    record: evidenceRecord({
      id: `casper-rpc-block-${height}`,
      product: "Casper Node RPC",
      network: "casper-testnet",
      subject: "latest_finalized_block",
      observedAt,
      sourceUrl: rpcUrl,
      facts,
      raw: result
    })
  };
}

async function getCsprTradePairs(mcpUrl: string): Promise<{ record: EvidenceRecord }> {
  const observedAt = new Date().toISOString();
  const mcp = await createMcpSession(mcpUrl);
  await mcpNotify(mcpUrl, mcp.sessionId, "notifications/initialized", {});
  const pairResponse = await mcpCallTool(mcpUrl, mcp.sessionId, "get_pairs", {
    page: 1,
    page_size: 5,
    currency: "USD"
  });
  const data = asRecord(pairResponse) ?? {};
  const pairs = Array.isArray(data.data)
    ? data.data.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null)
    : [];
  const firstPair = pairs[0];
  const facts = {
    pairCount: asNumber(data.itemCount) ?? pairs.length,
    pageCount: asNumber(data.pageCount),
    firstPairHash: asString(firstPair?.contractPackageHash),
    firstPairTokens: firstPair ? tokenPairLabel(firstPair) : null,
    firstPairReserve0: asString(firstPair?.reserve0),
    firstPairReserve1: asString(firstPair?.reserve1)
  };

  return {
    record: evidenceRecord({
      id: `cspr-trade-pairs-${hashJson(facts).slice(0, 16)}`,
      product: "CSPR.trade MCP",
      network: "casper-mainnet",
      subject: "dex_pair_surface",
      observedAt,
      sourceUrl: mcpUrl,
      facts,
      raw: pairResponse
    })
  };
}

function unavailableRecord(input: {
  product: string;
  network: string;
  subject: string;
  sourceUrl: string;
  observedAt: string;
  error: unknown;
}): { record: EvidenceRecord } {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const raw = { status: "unavailable", message };
  return {
    record: evidenceRecord({
      id: `${input.product.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-unavailable`,
      product: input.product,
      network: input.network,
      subject: input.subject,
      observedAt: input.observedAt,
      sourceUrl: input.sourceUrl,
      facts: {
        status: "unavailable",
        messageHash: hashJson(message)
      },
      raw
    })
  };
}

function evidenceRecord(input: {
  id: string;
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  facts: Record<string, EvidenceFactValue | undefined>;
  raw: unknown;
}): EvidenceRecord {
  return {
    id: input.id,
    product: input.product,
    network: input.network,
    subject: input.subject,
    observedAt: input.observedAt,
    sourceUrl: input.sourceUrl,
    facts: compactFacts(input.facts),
    rawHash: hashJson(input.raw)
  };
}

function compactFacts(facts: Record<string, EvidenceFactValue | undefined>) {
  return Object.fromEntries(
    Object.entries(facts).filter((entry): entry is [string, EvidenceFactValue] => entry[1] !== undefined)
  );
}

async function casperRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params })
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (!response.ok || body.error || !body.result) {
    throw new Error(body.error?.message ?? `Casper RPC ${method} failed with ${response.status}`);
  }
  return body.result;
}

async function createMcpSession(mcpUrl: string) {
  const response = await fetch(mcpUrl, {
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
  parseMcpEvent(await response.text());
  return { sessionId };
}

async function mcpNotify(mcpUrl: string, sessionId: string, method: string, params: unknown) {
  await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params })
  });
}

async function mcpCallTool(
  mcpUrl: string,
  sessionId: string,
  name: string,
  toolArguments: Record<string, unknown>
) {
  const response = await fetch(mcpUrl, {
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
  const body = parseMcpEvent(await response.text());
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

function asVersionedRecord(value: Record<string, unknown> | null) {
  return asRecord(value?.Version2) ?? asRecord(value?.Version1) ?? value;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function countTransactions(value: unknown): number {
  const transactions = asRecord(value);
  if (!transactions) {
    return 0;
  }
  return Object.values(transactions).reduce<number>(
    (total, item) => (Array.isArray(item) ? total + item.length : total),
    0
  );
}

function tokenPairLabel(pair: Record<string, unknown>): string | null {
  const token0 = asRecord(pair.token0);
  const token1 = asRecord(pair.token1);
  const symbol0 = asString(token0?.symbol);
  const symbol1 = asString(token1?.symbol);
  return symbol0 && symbol1 ? `${symbol0}/${symbol1}` : null;
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

let symbolCache: { at: number; map: Map<string, SymbolMapEntry> } | null = null;
let symbolCacheFill: Promise<Map<string, SymbolMapEntry>> | null = null;

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
    if (page >= pageCount || pairs.length === 0) {
      break;
    }
  }
  return all;
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
      const mcpUrl = process.env.CSPR_TRADE_MCP_URL ?? DEFAULT_CSPR_TRADE_MCP_URL;
      symbolCacheFill = withDeadline(fetchAllTradePairs(mcpUrl), SYMBOL_FETCH_DEADLINE_MS)
        .then((pairs) => buildSymbolMap(pairs))
        .finally(() => {
          symbolCacheFill = null;
        });
    }
    const map = await symbolCacheFill;
    if (map.size === 0) {
      // An empty pair set means the upstream shape drifted or the DEX is
      // unreachable — that is an outage, not "every symbol is unlisted",
      // so it must not be cached as authoritative.
      throw new Error("cspr.trade pair set came back empty");
    }
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
