import { scoreSubject, type SubjectSignals } from "@agent-pay/core";

/**
 * Live Casper token discovery via CSPR.cloud (the one real indexer).
 *
 * Contracts (verified against docs.cspr.cloud, mid-2026 / Casper 2.0):
 *  - Auth: `Authorization: <access-token>` (RAW token, not Bearer) + `Accept: application/json`.
 *  - There is NO "list tokens" endpoint, so discovery = `GET /contract-packages`
 *    (newest first) filtered client-side to CEP-18 (latest_version_contract_type_id 2 or 3).
 *  - Holders: `GET /contract-packages/{hash}/ft-token-ownership` → `item_count` is the
 *    holder count; sort by balance DESC for the top holder.
 *  - Total supply is a uref only; resolve via node-RPC `query_global_state`.
 *
 * Everything is best-effort: any failure (incl. no key) yields an empty list so
 * the landing falls back to its seed and never breaks.
 */

const REST_BASE = process.env.CSPR_CLOUD_BASE_URL ?? "https://api.cspr.cloud";
const NODE_RPC = process.env.CSPR_CLOUD_NODE_RPC_URL ?? "https://node.cspr.cloud/rpc";
// Subject (token-check) data — defaults to testnet, where the demo tokens live.
const SUBJECT_REST_BASE = process.env.CSPR_CLOUD_SUBJECT_BASE_URL ?? "https://api.testnet.cspr.cloud";
const SUBJECT_NODE_RPC = process.env.CSPR_CLOUD_SUBJECT_NODE_RPC_URL ?? "https://node.testnet.cspr.cloud/rpc";
const CEP18_TYPE_IDS = new Set([2, 3]); // CEP18 + Modified CEP18
const LIST_SCAN = 60; // recent packages to scan
const CANDIDATES = 14; // how many CEP-18 packages to assess
const RESULT_LIMIT = 6; // tokens returned to the hero
const CACHE_TTL_MS = 10 * 60 * 1000;

export type HeroTokenDto = {
  symbol: string;
  shortHash: string;
  aspect: string;
  holders: number;
};

function accessToken(): string | undefined {
  return process.env.CSPR_CLOUD_ACCESS_TOKEN || undefined;
}

export function csprCloudConfigured(): boolean {
  return Boolean(accessToken());
}

async function rest<T>(path: string, base: string = REST_BASE): Promise<T> {
  const token = accessToken();
  if (!token) {
    throw new Error("CSPR_CLOUD_ACCESS_TOKEN not set");
  }
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: token, accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`CSPR.cloud ${path} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

type ContractPackage = {
  contract_package_hash: string;
  latest_version_contract_type_id?: number;
  timestamp?: string;
  metadata?: { symbol?: string; decimals?: number; total_supply_uref?: string };
};

async function listCep18Packages(): Promise<ContractPackage[]> {
  const body = await rest<{ data: ContractPackage[] }>(
    `/contract-packages?limit=${LIST_SCAN}&order_by=timestamp&order_direction=DESC`
  );
  return (body.data ?? []).filter(
    (pkg) => CEP18_TYPE_IDS.has(Number(pkg.latest_version_contract_type_id)) && Boolean(pkg.metadata?.symbol)
  );
}

async function holderInfo(
  hash: string,
  base: string = REST_BASE
): Promise<{ holderCount: number; topBalance: bigint | null }> {
  const body = await rest<{ data: { balance?: string }[]; item_count?: number }>(
    `/contract-packages/${hash}/ft-token-ownership?order_by=balance&order_direction=DESC&limit=5`,
    base
  );
  const top = body.data?.[0]?.balance;
  let topBalance: bigint | null = null;
  try {
    topBalance = top != null ? BigInt(top) : null;
  } catch {
    topBalance = null;
  }
  return { holderCount: body.item_count ?? body.data?.length ?? 0, topBalance };
}

async function totalSupply(uref: string | undefined, nodeRpc: string = NODE_RPC): Promise<bigint | null> {
  const token = accessToken();
  if (!token || !uref) {
    return null;
  }
  try {
    const response = await fetch(nodeRpc, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query_global_state",
        params: { state_identifier: null, key: uref, path: [] }
      })
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      result?: { stored_value?: { CLValue?: { parsed?: unknown } } };
    };
    const parsed = body.result?.stored_value?.CLValue?.parsed;
    return parsed != null ? BigInt(String(parsed)) : null;
  } catch {
    return null;
  }
}

async function getPackageMeta(hash: string, base: string = REST_BASE): Promise<ContractPackage | null> {
  try {
    return await rest<ContractPackage>(`/contract-packages/${hash}`, base);
  } catch {
    return null;
  }
}

/**
 * Live holders + top-holder % for a single subject token, for the real
 * "check a token" flow. Defaults to the testnet CSPR.cloud (where the demo
 * tokens live); best-effort — returns nulls (→ "not checked") on any failure.
 */
export type SubjectTokenState = { holderCount: number | null; topHolderPct: number | null };

export async function fetchSubjectTokenState(packageHash: string): Promise<SubjectTokenState> {
  if (!csprCloudConfigured()) {
    return { holderCount: null, topHolderPct: null };
  }
  const hash = packageHash.replace(/^hash-/, "");
  try {
    const { holderCount, topBalance } = await holderInfo(hash, SUBJECT_REST_BASE);
    let topHolderPct: number | null = null;
    const meta = await getPackageMeta(hash, SUBJECT_REST_BASE);
    const supply = await totalSupply(meta?.metadata?.total_supply_uref, SUBJECT_NODE_RPC);
    if (supply && supply > 0n && topBalance != null) {
      topHolderPct = Number((topBalance * 10000n) / supply) / 100;
    }
    return { holderCount: holderCount > 0 ? holderCount : null, topHolderPct };
  } catch {
    return { holderCount: null, topHolderPct: null };
  }
}

function emptySignals(): SubjectSignals {
  return {
    mintAuthorityOpen: null,
    supplyRenounced: null,
    holderCount: null,
    topHolderPct: null,
    contractAgeBlocks: null,
    lpHolderCount: null,
    liquidityDepth: null
  };
}

async function assessPackage(pkg: ContractPackage): Promise<HeroTokenDto | null> {
  const hash = pkg.contract_package_hash;
  const { holderCount, topBalance } = await holderInfo(hash);
  if (holderCount <= 0) {
    return null; // skip tokens with no holders — not useful in a discovery list
  }
  let topHolderPct: number | null = null;
  const supply = await totalSupply(pkg.metadata?.total_supply_uref);
  if (supply && supply > 0n && topBalance != null) {
    topHolderPct = Number((topBalance * 10000n) / supply) / 100;
  }
  const signals: SubjectSignals = { ...emptySignals(), holderCount, topHolderPct };
  const { aspect } = scoreSubject(signals);
  return {
    symbol: String(pkg.metadata?.symbol),
    shortHash: hash.slice(0, 8),
    aspect,
    holders: holderCount
  };
}

let cache: { at: number; tokens: HeroTokenDto[] } | null = null;

export async function getHeroTokenList(): Promise<HeroTokenDto[]> {
  if (!csprCloudConfigured()) {
    return [];
  }
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.tokens;
  }
  const packages = (await listCep18Packages()).slice(0, CANDIDATES);
  const scored: HeroTokenDto[] = [];
  for (const pkg of packages) {
    try {
      const token = await assessPackage(pkg);
      if (token) {
        scored.push(token);
      }
    } catch {
      // best-effort per token
    }
  }
  scored.sort((a, b) => b.holders - a.holders);
  const tokens = scored.slice(0, RESULT_LIMIT);
  cache = { at: Date.now(), tokens };
  return tokens;
}
