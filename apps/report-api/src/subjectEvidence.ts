import { randomUUID } from "node:crypto";
import {
  buildDataset,
  hashJson,
  type EvidenceFactValue,
  type EvidenceRecord
} from "@agent-pay/core";
import type { SubjectRef } from "@agent-pay/core";
import {
  fetchCsprTradeMarketState,
  type CsprTradeMarketState,
  type LiveEvidenceDataset
} from "./liveEvidence.js";
import { fetchBoundedJson } from "./httpJson.js";
import { fetchSubjectTokenState } from "./csprCloud.js";
import {
  csprCloudEndpoints,
  defaultEvidenceNetwork,
  evidenceRpcUrl,
  type EvidenceNetwork
} from "./evidenceNetwork.js";

export type TokenState = {
  mintBurnEnabled: boolean | null;
  publicMintEntrypoint?: boolean | null;
  holderCount: number | null;
  topHolderPct: number | null;
  installBlock: number | null;
  latestBlock: number | null;
  /** Verbatim package creation timestamp (ISO) when the indexer exposes it. */
  packageCreatedAt?: string | null;
  authoritySourceUrl?: string;
  holdersSourceUrl?: string;
  ageSourceUrl?: string;
};

export type EvidenceDeps = {
  fetchTokenState?: (subject: SubjectRef) => Promise<TokenState>;
  fetchTradeMarket?: (packageHash: string) => Promise<CsprTradeMarketState>;
  network?: EvidenceNetwork;
  rpcUrl?: string;
};

async function defaultFetchTokenState(
  subject: SubjectRef,
  network: EvidenceNetwork,
  rpcUrl: string
): Promise<TokenState> {
  let latestBlock: number | null = null;

  try {
    const result = await casperRpc<Record<string, unknown>>(rpcUrl, "chain_get_block", []);
    const blockWithSignatures = asRecord(result.block_with_signatures);
    const block = asVersionedRecord(asRecord(blockWithSignatures?.block));
    const header = asRecord(block?.header);
    latestBlock = asNumber(header?.height);
  } catch {
    // best-effort — null means "not checked"
  }

  let mintBurnEnabled: boolean | null = null;
  let publicMintEntrypoint: boolean | null = null;
  let holderCount: number | null = null;
  let topHolderPct: number | null = null;
  let installBlock: number | null = null;
  let packageCreatedAt: string | null = null;
  let authoritySourceUrl = rpcUrl;
  let holdersSourceUrl = rpcUrl;
  let ageSourceUrl = rpcUrl;
  try {
    const endpoints = csprCloudEndpoints(network);
    const live = await fetchSubjectTokenState(subject.packageHash, {
      network,
      restBase: endpoints.restBase,
      nodeRpcUrl: endpoints.nodeRpcUrl,
      casperRpcUrl: rpcUrl
    });
    mintBurnEnabled = live.mintBurnEnabled;
    publicMintEntrypoint = live.publicMintEntrypoint;
    holderCount = live.holderCount;
    topHolderPct = live.topHolderPct;
    installBlock = live.installBlock;
    packageCreatedAt = live.packageCreatedAt;
    authoritySourceUrl = live.authoritySourceUrl;
    holdersSourceUrl = live.holdersSourceUrl;
    ageSourceUrl = live.ageSourceUrl;
  } catch {
    // leave as "not checked"
  }

  return {
    mintBurnEnabled,
    publicMintEntrypoint,
    holderCount,
    topHolderPct,
    installBlock,
    latestBlock,
    packageCreatedAt,
    authoritySourceUrl,
    holdersSourceUrl,
    ageSourceUrl
  };
}

export async function buildSubjectEvidence(
  subject: SubjectRef,
  deps: EvidenceDeps = {}
): Promise<LiveEvidenceDataset> {
  const network = deps.network ?? defaultEvidenceNetwork();
  const rpcUrl = deps.rpcUrl ?? evidenceRpcUrl(network);
  const observedAt = new Date().toISOString();
  const state = deps.fetchTokenState
    ? await deps.fetchTokenState(subject)
    : await defaultFetchTokenState(subject, network, rpcUrl);

  const contractAgeBlocks =
    state.latestBlock != null &&
    state.installBlock != null &&
    state.latestBlock >= state.installBlock
      ? state.latestBlock - state.installBlock
      : null;

  const datasetId =
    `trust-${network}-${subject.packageHash.slice(0, 16)}-${state.latestBlock ?? "na"}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;

  // Keep the install flag and the active contract's public mint surface as
  // separate facts. One must never be inferred from the other.
  const authorityFacts: Record<string, EvidenceFactValue> = {};
  if (state.mintBurnEnabled != null) authorityFacts.mintBurnEnabled = state.mintBurnEnabled;
  if (state.publicMintEntrypoint != null) {
    authorityFacts.publicMintEntrypoint = state.publicMintEntrypoint;
  }

  const authorityRecord: EvidenceRecord = {
    id: `token-authority-${subject.packageHash.slice(0, 16)}`,
    product: "Casper Token Authority",
    network,
    subject: "token_authority",
    observedAt,
    sourceUrl: state.authoritySourceUrl ?? rpcUrl,
    facts: authorityFacts,
    rawHash: hashJson({ subject: subject.packageHash, ...authorityFacts })
  };

  // token_holders record: holderCount + topHolderPct
  const holderFacts: Record<string, EvidenceFactValue> = {};
  if (state.holderCount != null) holderFacts.holderCount = state.holderCount;
  if (state.topHolderPct != null) holderFacts.topHolderPct = state.topHolderPct;

  const holdersRecord: EvidenceRecord = {
    id: `token-holders-${subject.packageHash.slice(0, 16)}`,
    product: "Casper Token Holders",
    network,
    subject: "token_holders",
    observedAt,
    sourceUrl: state.holdersSourceUrl ?? rpcUrl,
    facts: holderFacts,
    rawHash: hashJson({ subject: subject.packageHash, ...holderFacts })
  };

  // token_age record: contractAgeBlocks plus the verbatim creation timestamp.
  // The timestamp is shown as evidence even while block-height age (the
  // scoreable signal) still needs a deploys-height source.
  const ageFacts: Record<string, EvidenceFactValue> = {};
  if (contractAgeBlocks != null) ageFacts.contractAgeBlocks = contractAgeBlocks;
  if (state.packageCreatedAt) ageFacts.packageCreatedAt = state.packageCreatedAt;

  const ageRecord: EvidenceRecord = {
    id: `token-age-${subject.packageHash.slice(0, 16)}`,
    product: "Casper Token Age",
    network,
    subject: "token_age",
    observedAt,
    sourceUrl: state.ageSourceUrl ?? rpcUrl,
    facts: ageFacts,
    rawHash: hashJson({ subject: subject.packageHash, ...ageFacts })
  };

  const records = [authorityRecord, holdersRecord, ageRecord];
  if (network === "casper-mainnet") {
    const marketSourceUrl = process.env.CSPR_TRADE_MCP_URL ?? "https://mcp.cspr.trade/mcp";
    try {
      const market = await (deps.fetchTradeMarket ?? fetchCsprTradeMarketState)(subject.packageHash);
      const marketFacts: Record<string, EvidenceFactValue> = {
        listedOnCsprTrade: market.listedOnCsprTrade,
        pairCount: market.pairCount,
        pricedPairCount: market.pricedPairCount,
        pricedLiquidityUsd: market.pricedLiquidityUsd
      };
      if (market.pricedPairCount > 0) marketFacts.liquidityDepth = market.pricedLiquidityUsd;
      records.push({
        id: `cspr-trade-market-${subject.packageHash.slice(0, 16)}`,
        product: "CSPR.trade Market",
        network,
        subject: "token_market",
        observedAt,
        sourceUrl: market.sourceUrl,
        facts: marketFacts,
        rawHash: market.rawHash
      });
    } catch {
      records.push({
        id: `cspr-trade-market-${subject.packageHash.slice(0, 16)}-unavailable`,
        product: "CSPR.trade Market",
        network,
        subject: "token_market",
        observedAt,
        sourceUrl: marketSourceUrl,
        facts: { status: "unavailable" },
        rawHash: hashJson({ packageHash: subject.packageHash, status: "unavailable" })
      });
    }
  }
  const dataset = buildDataset(datasetId, records);

  return {
    ...dataset,
    sourceSummary: dataset.reports.map((report) => ({
      product: report.record.product,
      network: report.record.network,
      subject: report.record.subject,
      observedAt: report.record.observedAt,
      sourceUrl: report.record.sourceUrl,
      recordHash: report.reportHash,
      facts: report.record.facts
    }))
  };
}

async function casperRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const { response, body } = await fetchBoundedJson<{ result?: T; error?: { message?: string } }>(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params })
  });
  if (!response.ok || body.error || !body.result) {
    throw new Error(body.error?.message ?? `Casper RPC ${method} failed with ${response.status}`);
  }
  return body.result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asVersionedRecord(value: Record<string, unknown> | null) {
  return asRecord(value?.Version2) ?? asRecord(value?.Version1) ?? value;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
