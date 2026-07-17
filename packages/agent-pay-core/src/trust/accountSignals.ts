import type { EvidenceRecord } from "../types.js";

/**
 * Casper account evidence signals. Everything here is retrievable from a
 * public Casper node (existence, balance, multisig config, named keys); age and
 * activity are optional enrichment from an indexer (CSPR.cloud) and stay null
 * when unavailable — but they are NOT mandatory, so a well-configured funded
 * account can still clear on public-RPC facts alone.
 */
export type AccountSignals = {
  /** Whether the account resolves on-chain at all. */
  exists: boolean | null;
  /** CSPR balance in motes, as a decimal string (bigint-safe). */
  balanceMotes: string | null;
  /** Number of associated keys (1 = single-key account, >1 = multisig-capable). */
  associatedKeyCount: number | null;
  /** Weight threshold required to send a deploy/transaction. */
  deploymentThreshold: number | null;
  /** Weight threshold required to rotate keys. */
  keyManagementThreshold: number | null;
  /** Named keys registered on the account (contracts, refs). */
  namedKeyCount: number | null;
  /** Account age in blocks, when an indexer supplies a first-seen block. */
  ageBlocks: number | null;
  /** Lifetime transaction/deploy count, when an indexer supplies it. */
  txCount: number | null;
};

const EMPTY: AccountSignals = {
  exists: null,
  balanceMotes: null,
  associatedKeyCount: null,
  deploymentThreshold: null,
  keyManagementThreshold: null,
  namedKeyCount: null,
  ageBlocks: null,
  txCount: null,
};

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function decimalMotes(v: unknown): string | null {
  return typeof v === "string" && /^\d{1,155}$/.test(v) ? v : null;
}

export function extractAccountSignals(records: EvidenceRecord[]): AccountSignals {
  const facts: Record<string, unknown> = {};
  for (const r of records) Object.assign(facts, r.facts);
  return accountSignalsFromFacts(facts);
}

export function accountSignalsFromFacts(facts: Record<string, unknown>): AccountSignals {
  return {
    ...EMPTY,
    exists: bool(facts.exists),
    balanceMotes: decimalMotes(facts.balanceMotes),
    associatedKeyCount: num(facts.associatedKeyCount),
    deploymentThreshold: num(facts.deploymentThreshold),
    keyManagementThreshold: num(facts.keyManagementThreshold),
    namedKeyCount: num(facts.namedKeyCount),
    ageBlocks: num(facts.ageBlocks),
    txCount: num(facts.txCount),
  };
}
