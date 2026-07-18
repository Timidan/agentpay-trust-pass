import { normalizePackageHash, scoreSubject, type SubjectSignals } from "@agent-pay/core";
import { fetchBoundedJson } from "./httpJson.js";
import {
  csprCloudEndpoints,
  defaultEvidenceNetwork,
  evidenceRpcUrl,
  type EvidenceNetwork
} from "./evidenceNetwork.js";

/**
 * Casper token discovery can use CSPR.cloud when a deployment configures its
 * access token. Subject checks do not depend on that credential: they read
 * indexed holder and contract history from CSPR.live and independently read
 * supply controls and total supply from Casper JSON-RPC.
 *
 * CSPR.cloud contracts (verified against docs.cspr.cloud, mid-2026 / Casper 2.0):
 *  - Auth: `Authorization: <access-token>` (RAW token, not Bearer) + `Accept: application/json`.
 *  - There is NO "list tokens" endpoint, so discovery = `GET /contract-packages`
 *    (newest first) filtered client-side to CEP-18 (latest_version_contract_type_id 2 or 3).
 *  - Holders: `GET /contract-packages/{hash}/ft-token-ownership` → `item_count` is the
 *    holder count; sort by balance DESC for the top holder.
 *  - Total supply is a uref only; resolve via node-RPC `query_global_state`.
 *
 * Discovery failures are reported as unavailable. Subject checks keep each
 * missing fact explicit and never substitute a static result.
 */

const REST_BASE = process.env.CSPR_CLOUD_BASE_URL ?? "https://api.cspr.cloud";
const NODE_RPC = process.env.CSPR_CLOUD_NODE_RPC_URL ?? "https://node.cspr.cloud/rpc";
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

type CsprCloudRequestOptions = {
  accessToken?: string;
  fetchImpl?: typeof fetch;
};

async function rest<T>(
  path: string,
  base: string = REST_BASE,
  options: CsprCloudRequestOptions = {}
): Promise<T> {
  const token = options.accessToken ?? accessToken();
  if (!token) {
    throw new Error("CSPR_CLOUD_ACCESS_TOKEN not set");
  }
  const { response, body } = await fetchBoundedJson<T>(`${base}${path}`, {
    headers: { authorization: token, accept: "application/json" }
  }, { fetchImpl: options.fetchImpl });
  if (!response.ok) {
    throw new Error(`CSPR.cloud ${path} -> ${response.status}`);
  }
  return body;
}

async function publicRest<T>(
  path: string,
  base: string,
  fetchImpl?: typeof fetch
): Promise<T> {
  const { response, body } = await fetchBoundedJson<T>(`${base}${path}`, {
    headers: { accept: "application/json" }
  }, { fetchImpl });
  if (!response.ok) {
    throw new Error(`CSPR.live ${path} -> ${response.status}`);
  }
  return body;
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
  base: string = REST_BASE,
  options: CsprCloudRequestOptions = {}
): Promise<{ holderCount: number | null; topBalance: bigint | null }> {
  const body = await rest<{ data: { balance?: string }[]; item_count?: number }>(
    `/contract-packages/${hash}/ft-token-ownership?order_by=balance&order_direction=DESC&limit=5`,
    base,
    options
  );
  return parseHolderInfo(body);
}

function parseHolderInfo(body: {
  data?: Array<{ balance?: string }>;
  item_count?: number;
}): { holderCount: number | null; topBalance: bigint | null } {
  const holderCount =
    Number.isSafeInteger(body.item_count) && Number(body.item_count) >= 0
      ? Number(body.item_count)
      : null;
  const top = body.data?.[0]?.balance;
  const topBalance = typeof top === "string" && /^(?:0|[1-9][0-9]*)$/.test(top)
    ? BigInt(top)
    : null;
  return { holderCount, topBalance };
}

async function publicHolderInfo(
  hash: string,
  base: string,
  fetchImpl?: typeof fetch
): Promise<{ holderCount: number | null; topBalance: bigint | null }> {
  const body = await publicRest<{ data?: Array<{ balance?: string }>; item_count?: number }>(
    `/contract-packages/${hash}/ft-token-ownership?order_by=balance&order_direction=DESC&page_size=1`,
    base,
    fetchImpl
  );
  return parseHolderInfo(body);
}

async function totalSupply(
  uref: string | undefined,
  nodeRpc: string = NODE_RPC,
  options: CsprCloudRequestOptions = {}
): Promise<bigint | null> {
  const token = options.accessToken ?? accessToken();
  if (!token || !uref) {
    return null;
  }
  try {
    const { response, body } = await fetchBoundedJson<{
      result?: { stored_value?: { CLValue?: { parsed?: unknown } } };
      error?: { message?: string };
    }>(nodeRpc, {
      method: "POST",
      headers: { authorization: token, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query_global_state",
        params: { state_identifier: null, key: uref, path: [] }
      })
    }, { fetchImpl: options.fetchImpl });
    if (!response.ok || body.error) {
      return null;
    }
    const parsed = body.result?.stored_value?.CLValue?.parsed;
    return parsed != null ? BigInt(String(parsed)) : null;
  } catch {
    return null;
  }
}

async function publicTotalSupply(
  uref: string | undefined,
  rpcUrl: string,
  fetchImpl?: typeof fetch
): Promise<bigint | null> {
  if (!uref) return null;
  try {
    const storedValue = await queryPublicGlobalState(uref, rpcUrl, fetchImpl);
    const parsed = asRecord(storedValue.CLValue)?.parsed;
    if (typeof parsed !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(parsed)) {
      return null;
    }
    return BigInt(parsed);
  } catch {
    return null;
  }
}

async function getPackageMeta(
  hash: string,
  base: string = REST_BASE,
  options: CsprCloudRequestOptions = {}
): Promise<ContractPackage | null> {
  try {
    return await rest<ContractPackage>(`/contract-packages/${hash}`, base, options);
  } catch {
    return null;
  }
}

async function getPublicPackageMeta(
  hash: string,
  base: string,
  fetchImpl?: typeof fetch
): Promise<ContractPackage | null> {
  const body = await publicRest<{ data?: ContractPackage }>(
    `/contract-packages/${hash}`,
    base,
    fetchImpl
  );
  return body.data ?? null;
}

/**
 * Live holders + top-holder % for a single subject token, for the real
 * "check a token" flow. The caller selects Mainnet or Testnet; source failures
 * return null facts, which the policy reports as not checked.
 */
export type SubjectTokenState = {
  mintBurnEnabled: boolean | null;
  publicMintEntrypoint: boolean | null;
  holderCount: number | null;
  topHolderPct: number | null;
  installBlock: number | null;
  /** Indexed contract-package creation timestamp (ISO), when known. */
  packageCreatedAt: string | null;
  authoritySourceUrl: string;
  holdersSourceUrl: string;
  ageSourceUrl: string;
};

export type FetchSubjectTokenStateOptions = {
  network?: EvidenceNetwork;
  accessToken?: string;
  restBase?: string;
  publicIndexerBase?: string;
  nodeRpcUrl?: string;
  casperRpcUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function fetchSubjectTokenState(
  packageHash: string,
  options: FetchSubjectTokenStateOptions = {}
): Promise<SubjectTokenState> {
  const hash = normalizePackageHash(packageHash);
  const network = options.network ?? defaultEvidenceNetwork();
  const endpoints = csprCloudEndpoints(network);
  const restBase = normalizeBaseUrl(options.restBase ?? endpoints.restBase);
  const publicIndexerBase = normalizeBaseUrl(
    options.publicIndexerBase ?? csprLiveApiBase(network)
  );
  const nodeRpcUrl = options.nodeRpcUrl ?? endpoints.nodeRpcUrl;
  const subjectAccessToken =
    options.accessToken ?? process.env.CSPR_CLOUD_SUBJECT_ACCESS_TOKEN?.trim() ?? "";
  const state = emptySubjectTokenState(hash, restBase, nodeRpcUrl);
  const requestOptions = {
    accessToken: subjectAccessToken || undefined,
    fetchImpl: options.fetchImpl
  };
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return state;
  }
  if (!subjectAccessToken) {
    const casperRpcUrl = options.casperRpcUrl ?? evidenceRpcUrl(network);
    state.holdersSourceUrl = `${publicIndexerBase}/contract-packages/${hash}/ft-token-ownership`;
    state.ageSourceUrl = `${publicIndexerBase}/contract-packages/${hash}/contracts`;
    state.authoritySourceUrl = casperRpcUrl;
    const [metaResult, holderResult, contractsResult, supplyControlResult] = await Promise.allSettled([
      getPublicPackageMeta(hash, publicIndexerBase, options.fetchImpl),
      publicHolderInfo(hash, publicIndexerBase, options.fetchImpl),
      getPublicPackageContracts(hash, publicIndexerBase, options.fetchImpl),
      readNativeSupplyControl(hash, casperRpcUrl, options.fetchImpl)
    ]);
    const supplyControl = supplyControlResult.status === "fulfilled"
      ? supplyControlResult.value
      : emptySupplyControl();
    state.mintBurnEnabled = supplyControl.mintBurnFlag === null
      ? null
      : supplyControl.mintBurnFlag !== 0;
    state.publicMintEntrypoint = supplyControl.publicMintEntrypoint;

    const meta = metaResult.status === "fulfilled" ? metaResult.value : null;
    if (
      meta?.latest_version_contract_type_id !== undefined &&
      !CEP18_TYPE_IDS.has(Number(meta.latest_version_contract_type_id))
    ) {
      return state;
    }
    state.packageCreatedAt = validTimestamp(meta?.timestamp) ? meta.timestamp! : null;

    const holderState = holderResult.status === "fulfilled" ? holderResult.value : null;
    state.holderCount =
      holderState?.holderCount !== null && holderState?.holderCount !== undefined && holderState.holderCount > 0
        ? holderState.holderCount
        : null;
    const contracts = contractsResult.status === "fulfilled" ? contractsResult.value : [];
    state.installBlock = selectContracts(contracts).installBlock;
    const supply = await publicTotalSupply(
      meta?.metadata?.total_supply_uref,
      casperRpcUrl,
      options.fetchImpl
    );
    state.topHolderPct = holderPercentage(holderState?.topBalance ?? null, supply);
    return state;
  }

  const [metaResult, holderResult, contractsResult] = await Promise.allSettled([
    getPackageMeta(hash, restBase, requestOptions),
    holderInfo(hash, restBase, requestOptions),
    getPackageContracts(hash, restBase, requestOptions)
  ]);

  const meta = metaResult.status === "fulfilled" ? metaResult.value : null;
  if (
    meta?.latest_version_contract_type_id !== undefined &&
    !CEP18_TYPE_IDS.has(Number(meta.latest_version_contract_type_id))
  ) {
    return state;
  }
  state.packageCreatedAt = validTimestamp(meta?.timestamp) ? meta.timestamp! : null;

  const holderState = holderResult.status === "fulfilled" ? holderResult.value : null;
  state.holderCount =
    holderState?.holderCount !== null && holderState?.holderCount !== undefined && holderState.holderCount > 0
      ? holderState.holderCount
      : null;

  const contracts = contractsResult.status === "fulfilled" ? contractsResult.value : [];
  const contractSelection = selectContracts(contracts);
  state.installBlock = contractSelection.installBlock;

  const [supplyResult, supplyControlResult] = await Promise.allSettled([
    totalSupply(meta?.metadata?.total_supply_uref, nodeRpcUrl, requestOptions),
    contractSelection.activeContractHash
      ? readSupplyControl(contractSelection.activeContractHash, nodeRpcUrl, requestOptions)
      : Promise.resolve(emptySupplyControl())
  ]);
  const supply = supplyResult.status === "fulfilled" ? supplyResult.value : null;
  state.topHolderPct = holderPercentage(holderState?.topBalance ?? null, supply);
  const supplyControl = supplyControlResult.status === "fulfilled"
    ? supplyControlResult.value
    : emptySupplyControl();
  state.mintBurnEnabled = supplyControl.mintBurnFlag === null
    ? null
    : supplyControl.mintBurnFlag !== 0;
  state.publicMintEntrypoint = supplyControl.publicMintEntrypoint;
  return state;
}

type ContractVersion = {
  contract_hash?: string;
  block_height?: number;
  contract_version?: number;
  is_disabled?: boolean;
};

async function getPackageContracts(
  hash: string,
  base: string,
  options: CsprCloudRequestOptions
): Promise<ContractVersion[]> {
  const body = await rest<{ data?: ContractVersion[] }>(
    `/contract-packages/${hash}/contracts?order_by=timestamp&order_direction=ASC&limit=100`,
    base,
    options
  );
  return Array.isArray(body.data) ? body.data : [];
}

async function getPublicPackageContracts(
  hash: string,
  base: string,
  fetchImpl?: typeof fetch
): Promise<ContractVersion[]> {
  const body = await publicRest<{ data?: ContractVersion[] }>(
    `/contract-packages/${hash}/contracts?order_by=timestamp&order_direction=ASC&page_size=100`,
    base,
    fetchImpl
  );
  return Array.isArray(body.data) ? body.data : [];
}

function selectContracts(contracts: ContractVersion[]): {
  activeContractHash: string | null;
  installBlock: number | null;
} {
  const valid = contracts.filter(
    (contract) =>
      typeof contract.contract_hash === "string" &&
      /^[0-9a-f]{64}$/i.test(contract.contract_hash) &&
      Number.isSafeInteger(contract.block_height) &&
      (contract.block_height ?? -1) >= 0
  );
  const installBlock = valid.length > 0
    ? Math.min(...valid.map((contract) => contract.block_height!))
    : null;
  const active = valid
    .filter((contract) => contract.is_disabled !== true)
    .sort(
      (left, right) =>
        (right.contract_version ?? 0) - (left.contract_version ?? 0) ||
        (right.block_height ?? 0) - (left.block_height ?? 0)
    )[0];
  return {
    activeContractHash: active?.contract_hash?.toLowerCase() ?? null,
    installBlock
  };
}

type SupplyControl = {
  mintBurnFlag: 0 | 1 | null;
  publicMintEntrypoint: boolean | null;
};

function emptySupplyControl(): SupplyControl {
  return { mintBurnFlag: null, publicMintEntrypoint: null };
}

async function readSupplyControl(
  contractHash: string,
  nodeRpcUrl: string,
  options: CsprCloudRequestOptions
): Promise<SupplyControl> {
  const contractStoredValue = await queryGlobalState(
    `hash-${contractHash}`,
    nodeRpcUrl,
    options
  );
  const contract = asRecord(contractStoredValue.Contract);
  const addressable = asRecord(contractStoredValue.AddressableEntity);
  const namedKeys = contract?.named_keys ?? addressable?.named_keys;
  const entryPoints = contract?.entry_points ?? addressable?.entry_points;
  const publicMintEntrypoint = readPublicMintEntrypoint(entryPoints);
  if (!Array.isArray(namedKeys)) {
    return { mintBurnFlag: null, publicMintEntrypoint };
  }
  const mintKey = namedKeys
    .map((value) => asRecord(value))
    .find((value) => value?.name === "enable_mint_burn");
  const key = typeof mintKey?.key === "string" ? mintKey.key : null;
  if (!key) return { mintBurnFlag: null, publicMintEntrypoint };
  try {
    const flagStoredValue = await queryGlobalState(key, nodeRpcUrl, options);
    return { mintBurnFlag: parseMintBurnFlag(flagStoredValue), publicMintEntrypoint };
  } catch {
    return { mintBurnFlag: null, publicMintEntrypoint };
  }
}

async function readNativeSupplyControl(
  packageHash: string,
  rpcUrl: string,
  fetchImpl?: typeof fetch
): Promise<SupplyControl> {
  try {
    const packageStoredValue = await queryPublicGlobalState(`hash-${packageHash}`, rpcUrl, fetchImpl);
    const contractKeys = activeLegacyContractKeys(packageStoredValue);
    for (const contractKey of contractKeys) {
      try {
        const contractStoredValue = await queryPublicGlobalState(contractKey, rpcUrl, fetchImpl);
        const contract = asRecord(contractStoredValue.Contract);
        const namedKeys = contract?.named_keys;
        const publicMintEntrypoint = readPublicMintEntrypoint(contract?.entry_points);
        if (!Array.isArray(namedKeys)) {
          return { mintBurnFlag: null, publicMintEntrypoint };
        }
        const mintKey = namedKeys
          .map((value) => asRecord(value))
          .find((value) => value?.name === "enable_mint_burn")?.key;
        if (typeof mintKey !== "string") {
          return { mintBurnFlag: null, publicMintEntrypoint };
        }
        try {
          return {
            mintBurnFlag: parseMintBurnFlag(
              await queryPublicGlobalState(mintKey, rpcUrl, fetchImpl)
            ),
            publicMintEntrypoint
          };
        } catch {
          return { mintBurnFlag: null, publicMintEntrypoint };
        }
      } catch {
        // Try the next enabled package version.
      }
    }
  } catch {
    // Non-CEP18, Casper 2.0 package, or temporarily unavailable RPC.
  }
  return emptySupplyControl();
}

function activeLegacyContractKeys(storedValue: Record<string, unknown>): string[] {
  const contractPackage = asRecord(storedValue.ContractPackage);
  const versions = Array.isArray(contractPackage?.versions) ? contractPackage.versions : [];
  const disabled = new Set(
    (Array.isArray(contractPackage?.disabled_versions) ? contractPackage.disabled_versions : [])
      .map((value) => legacyVersionKey(value))
      .filter((value): value is string => value !== null)
  );
  return versions
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => value !== null)
    .filter((value) => {
      const key = legacyVersionKey(value);
      return key === null || !disabled.has(key);
    })
    .sort((left, right) => Number(right.contract_version ?? 0) - Number(left.contract_version ?? 0))
    .flatMap((value) => {
      if (typeof value.contract_hash !== "string") return [];
      const hash = value.contract_hash.replace(/^(contract-|hash-)/, "");
      return /^[0-9a-f]{64}$/i.test(hash) ? [`hash-${hash}`] : [];
    });
}

function legacyVersionKey(value: unknown): string | null {
  if (Array.isArray(value) && value.length === 2) {
    const [major, contractVersion] = value;
    return Number.isSafeInteger(major) && Number.isSafeInteger(contractVersion)
      ? `${major}:${contractVersion}`
      : null;
  }
  const record = asRecord(value);
  if (
    !record ||
    !Number.isSafeInteger(record.protocol_version_major) ||
    !Number.isSafeInteger(record.contract_version)
  ) {
    return null;
  }
  return `${record.protocol_version_major}:${record.contract_version}`;
}

function readPublicMintEntrypoint(value: unknown): boolean | null {
  if (!Array.isArray(value)) return null;
  return value.some((candidate) => {
    const entryPoint = asRecord(candidate);
    return entryPoint?.name === "mint" && entryPoint.access === "Public";
  });
}

function parseMintBurnFlag(storedValue: Record<string, unknown>): 0 | 1 | null {
  const parsed = asRecord(storedValue.CLValue)?.parsed;
  if (parsed === 0 || parsed === "0") return 0;
  if (parsed === 1 || parsed === "1") return 1;
  return null;
}

async function queryPublicGlobalState(
  key: string,
  rpcUrl: string,
  fetchImpl?: typeof fetch
): Promise<Record<string, unknown>> {
  const { response, body } = await fetchBoundedJson<{
    result?: { stored_value?: unknown };
    error?: { message?: string };
  }>(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query_global_state",
      params: { state_identifier: null, key, path: [] }
    })
  }, { fetchImpl });
  const storedValue = asRecord(body.result?.stored_value);
  if (!response.ok || body.error || !storedValue) {
    throw new Error(body.error?.message ?? `Casper node query failed with ${response.status}`);
  }
  return storedValue;
}

async function queryGlobalState(
  key: string,
  nodeRpcUrl: string,
  options: CsprCloudRequestOptions
): Promise<Record<string, unknown>> {
  const token = options.accessToken ?? accessToken();
  if (!token) throw new Error("CSPR_CLOUD_ACCESS_TOKEN not set");
  const id = 1;
  const { response, body } = await fetchBoundedJson<{
    result?: { stored_value?: unknown };
    error?: { message?: string };
  }>(nodeRpcUrl, {
    method: "POST",
    headers: {
      authorization: token,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "query_global_state",
      params: { state_identifier: null, key, path: [] }
    })
  }, { fetchImpl: options.fetchImpl });
  const storedValue = asRecord(body.result?.stored_value);
  if (!response.ok || body.error || !storedValue) {
    throw new Error(body.error?.message ?? `CSPR.cloud node query failed with ${response.status}`);
  }
  return storedValue;
}

function emptySubjectTokenState(
  hash: string,
  restBase: string,
  nodeRpcUrl: string
): SubjectTokenState {
  return {
    mintBurnEnabled: null,
    publicMintEntrypoint: null,
    holderCount: null,
    topHolderPct: null,
    installBlock: null,
    packageCreatedAt: null,
    authoritySourceUrl: nodeRpcUrl,
    holdersSourceUrl: `${restBase}/contract-packages/${hash}/ft-token-ownership`,
    ageSourceUrl: `${restBase}/contract-packages/${hash}/contracts`
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function csprLiveApiBase(network: EvidenceNetwork): string {
  if (network === "casper-mainnet") {
    return process.env.CSPR_LIVE_MAINNET_API_URL?.trim() || "https://api.mainnet.cspr.live";
  }
  return process.env.CSPR_LIVE_TESTNET_API_URL?.trim() || "https://api.testnet.cspr.live";
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function emptySignals(): SubjectSignals {
  return {
    mintBurnEnabled: null,
    publicMintEntrypoint: null,
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
  if (holderCount === null || holderCount <= 0) {
    return null; // skip tokens with no holders — not useful in a discovery list
  }
  const supply = await totalSupply(pkg.metadata?.total_supply_uref);
  const topHolderPct = holderPercentage(topBalance, supply);
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
    throw new Error("CSPR.cloud token discovery is not configured");
  }
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.tokens;
  }
  const packages = (await listCep18Packages()).slice(0, CANDIDATES);
  if (packages.length === 0) {
    throw new Error("CSPR.cloud token discovery returned no CEP-18 packages");
  }
  const scored: HeroTokenDto[] = [];
  let failedAssessments = 0;
  for (const pkg of packages) {
    try {
      const token = await assessPackage(pkg);
      if (token) {
        scored.push(token);
      }
    } catch {
      failedAssessments += 1;
    }
  }
  if (failedAssessments > 0) {
    throw new Error("CSPR.cloud token discovery assessments are unavailable");
  }
  scored.sort((a, b) => b.holders - a.holders);
  const tokens = scored.slice(0, RESULT_LIMIT);
  cache = { at: Date.now(), tokens };
  return tokens;
}

function holderPercentage(topBalance: bigint | null, supply: bigint | null): number | null {
  if (topBalance === null || supply === null || supply <= 0n || topBalance > supply) {
    return null;
  }
  const basisPoints = (topBalance * 10_000n) / supply;
  if (basisPoints < 0n || basisPoints > 10_000n) return null;
  return Number(basisPoints) / 100;
}
