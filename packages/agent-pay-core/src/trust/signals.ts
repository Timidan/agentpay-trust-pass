import type { EvidenceRecord } from "../types.js";

export type Tri = boolean | null;
export type SubjectSignals = {
  mintAuthorityOpen: Tri;
  supplyRenounced: Tri;
  holderCount: number | null;
  topHolderPct: number | null;
  contractAgeBlocks: number | null;
  lpHolderCount: number | null;
  liquidityDepth: number | null;
};

const EMPTY: SubjectSignals = {
  mintAuthorityOpen: null, supplyRenounced: null, holderCount: null,
  topHolderPct: null, contractAgeBlocks: null, lpHolderCount: null, liquidityDepth: null,
};

function bool(v: unknown): Tri { return typeof v === "boolean" ? v : null; }
function num(v: unknown): number | null { return typeof v === "number" ? v : null; }

export function extractSignals(records: EvidenceRecord[]): SubjectSignals {
  const facts: Record<string, unknown> = {};
  for (const r of records) Object.assign(facts, r.facts);
  return {
    ...EMPTY,
    mintAuthorityOpen: bool(facts.mintAuthorityOpen),
    supplyRenounced: bool(facts.supplyRenounced),
    holderCount: num(facts.holderCount),
    topHolderPct: num(facts.topHolderPct),
    contractAgeBlocks: num(facts.contractAgeBlocks),
    lpHolderCount: num(facts.lpHolderCount),
    liquidityDepth: num(facts.liquidityDepth),
  };
}
