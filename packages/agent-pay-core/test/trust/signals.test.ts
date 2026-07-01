import { describe, it, expect } from "vitest";
import { extractSignals } from "../../src/trust/signals.js";
import type { EvidenceRecord } from "../../src/types.js";

function rec(subject: string, facts: Record<string, string | number | boolean | null>): EvidenceRecord {
  return { id: subject, product: "Casper Token", network: "casper-testnet", subject,
    observedAt: "2026-06-25T00:00:00Z", sourceUrl: "rpc", facts, rawHash: "x" };
}

describe("extractSignals", () => {
  it("maps token-authority + supply + age facts to signals", () => {
    const s = extractSignals([
      rec("token_authority", { mintAuthorityOpen: true, supplyRenounced: false }),
      rec("token_holders", { holderCount: 1, topHolderPct: 100 }),
      rec("token_age", { contractAgeBlocks: 12 }),
    ]);
    expect(s.mintAuthorityOpen).toBe(true);
    expect(s.supplyRenounced).toBe(false);
    expect(s.holderCount).toBe(1);
    expect(s.topHolderPct).toBe(100);
    expect(s.contractAgeBlocks).toBe(12);
  });
  it("defaults absent signals to null (not checked)", () => {
    const s = extractSignals([rec("token_age", { contractAgeBlocks: 5 })]);
    expect(s.mintAuthorityOpen).toBeNull();
    expect(s.lpHolderCount).toBeNull();
    expect(s.liquidityDepth).toBeNull();
  });
});
