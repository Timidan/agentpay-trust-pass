import { describe, it, expect } from "vitest";
import { extractSignals, subjectSignalsFromFacts } from "../../src/trust/signals.js";
import type { EvidenceRecord } from "../../src/types.js";

function rec(subject: string, facts: Record<string, string | number | boolean | null>): EvidenceRecord {
  return { id: subject, product: "Casper Token", network: "casper-testnet", subject,
    observedAt: "2026-06-25T00:00:00Z", sourceUrl: "rpc", facts, rawHash: "x" };
}

describe("extractSignals", () => {
  it("maps token authority, holder, and age facts to signals", () => {
    const s = extractSignals([
      rec("token_authority", { mintBurnEnabled: true, publicMintEntrypoint: true }),
      rec("token_holders", { holderCount: 1, topHolderPct: 100 }),
      rec("token_age", { contractAgeBlocks: 12 }),
    ]);
    expect(s.mintBurnEnabled).toBe(true);
    expect(s.publicMintEntrypoint).toBe(true);
    expect(s.holderCount).toBe(1);
    expect(s.topHolderPct).toBe(100);
    expect(s.contractAgeBlocks).toBe(12);
  });
  it("defaults absent signals to null (not checked)", () => {
    const s = extractSignals([rec("token_age", { contractAgeBlocks: 5 })]);
    expect(s.mintBurnEnabled).toBeNull();
    expect(s.publicMintEntrypoint).toBeNull();
    expect(s.lpHolderCount).toBeNull();
    expect(s.liquidityDepth).toBeNull();
  });

  it("normalizes submitted token facts without creating an evidence record", () => {
    expect(subjectSignalsFromFacts({
      mintBurnEnabled: false,
      holderCount: 42,
      topHolderPct: "not-a-number"
    })).toMatchObject({
      mintBurnEnabled: false,
      holderCount: 42,
      topHolderPct: null,
      contractAgeBlocks: null
    });
  });
});
