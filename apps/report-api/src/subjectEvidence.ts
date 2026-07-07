import { randomUUID } from "node:crypto";
import {
  buildDataset,
  hashJson,
  type EvidenceFactValue,
  type EvidenceRecord
} from "@agent-pay/core";
import type { SubjectRef } from "@agent-pay/core";
import type { LiveEvidenceDataset } from "./liveEvidence.js";
import { fetchSubjectTokenState } from "./csprCloud.js";

const DEFAULT_CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";

export type TokenState = {
  mintAuthorityOpen: boolean | null;
  supplyRenounced: boolean | null;
  holderCount: number | null;
  topHolderPct: number | null;
  installBlock: number | null;
  latestBlock: number | null;
  /** Verbatim package creation timestamp (ISO) when the indexer exposes it. */
  packageCreatedAt?: string | null;
};

export type EvidenceDeps = {
  fetchTokenState?: (subject: SubjectRef) => Promise<TokenState>;
  network?: string;
};

async function defaultFetchTokenState(subject: SubjectRef): Promise<TokenState> {
  const rpcUrl = process.env.CASPER_RPC_URL ?? DEFAULT_CASPER_RPC_URL;
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

  // Real holders + concentration from CSPR.cloud (best-effort; nulls stay "not checked").
  let holderCount: number | null = null;
  let topHolderPct: number | null = null;
  let packageCreatedAt: string | null = null;
  try {
    const live = await fetchSubjectTokenState(subject.packageHash);
    holderCount = live.holderCount;
    topHolderPct = live.topHolderPct;
    packageCreatedAt = live.packageCreatedAt;
  } catch {
    // leave as "not checked"
  }

  return {
    // mint authority + supply renouncement aren't cleanly exposed by CSPR.cloud,
    // so they stay "not checked" — which the rules correctly surface as CAUTION.
    mintAuthorityOpen: null,
    supplyRenounced: null,
    holderCount,
    topHolderPct,
    installBlock: null,
    latestBlock,
    packageCreatedAt
  };
}

export async function buildSubjectEvidence(
  subject: SubjectRef,
  deps: EvidenceDeps = {}
): Promise<LiveEvidenceDataset> {
  const rpcUrl = process.env.CASPER_RPC_URL ?? DEFAULT_CASPER_RPC_URL;
  const network = deps.network ?? "casper-testnet";
  const fetchTokenState = deps.fetchTokenState ?? defaultFetchTokenState;
  const observedAt = new Date().toISOString();
  const state = await fetchTokenState(subject);

  const contractAgeBlocks =
    state.latestBlock != null && state.installBlock != null
      ? state.latestBlock - state.installBlock
      : null;

  const datasetId = `trust-${subject.packageHash.slice(0, 16)}-${state.latestBlock ?? "na"}`;

  // token_authority record: mintAuthorityOpen + supplyRenounced
  const authorityFacts: Record<string, EvidenceFactValue> = {};
  if (state.mintAuthorityOpen != null) authorityFacts.mintAuthorityOpen = state.mintAuthorityOpen;
  if (state.supplyRenounced != null) authorityFacts.supplyRenounced = state.supplyRenounced;

  const authorityRecord: EvidenceRecord = {
    id: `token-authority-${subject.packageHash.slice(0, 16)}`,
    product: "Casper Token Authority",
    network,
    subject: "token_authority",
    observedAt,
    sourceUrl: rpcUrl,
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
    sourceUrl: rpcUrl,
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
    sourceUrl: rpcUrl,
    facts: ageFacts,
    rawHash: hashJson({ subject: subject.packageHash, ...ageFacts })
  };

  const records = [authorityRecord, holdersRecord, ageRecord];
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
