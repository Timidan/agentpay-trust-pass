import type { EvidenceRecord } from "../types.js";

export type Tri = boolean | null;
export type SubjectSignals = {
  /** Value of the CEP-18 enable_mint_burn installation flag. */
  mintBurnEnabled: Tri;
  /** Whether the active contract exposes an entry point named `mint` with public access. */
  publicMintEntrypoint: Tri;
  holderCount: number | null;
  topHolderPct: number | null;
  contractAgeBlocks: number | null;
  lpHolderCount: number | null;
  liquidityDepth: number | null;
};

const EMPTY: SubjectSignals = {
  mintBurnEnabled: null, publicMintEntrypoint: null, holderCount: null,
  topHolderPct: null, contractAgeBlocks: null, lpHolderCount: null, liquidityDepth: null,
};

function bool(v: unknown): Tri { return typeof v === "boolean" ? v : null; }
function num(v: unknown): number | null { return typeof v === "number" ? v : null; }

export function extractSignals(records: EvidenceRecord[]): SubjectSignals {
  const facts: Record<string, unknown> = {};
  for (const r of records) Object.assign(facts, r.facts);
  return subjectSignalsFromFacts(facts);
}

export function subjectSignalsFromFacts(facts: Record<string, unknown>): SubjectSignals {
  return {
    ...EMPTY,
    mintBurnEnabled: bool(facts.mintBurnEnabled),
    publicMintEntrypoint: bool(facts.publicMintEntrypoint),
    holderCount: num(facts.holderCount),
    topHolderPct: num(facts.topHolderPct),
    contractAgeBlocks: num(facts.contractAgeBlocks),
    lpHolderCount: num(facts.lpHolderCount),
    liquidityDepth: num(facts.liquidityDepth),
  };
}
