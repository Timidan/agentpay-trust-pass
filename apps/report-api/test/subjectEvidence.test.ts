import { describe, it, expect } from "vitest";
import { buildSubjectEvidence } from "../src/subjectEvidence.js";
import { extractSignals } from "@agent-pay/core";

const subject = { kind: "token" as const, packageHash: "a".repeat(64), raw: "a".repeat(64) };

describe("buildSubjectEvidence", () => {
  it("builds a Merkle dataset of the mandatory signal records", async () => {
    const ds = await buildSubjectEvidence(subject, {
      fetchTokenState: async () => ({ mintAuthorityOpen: true, supplyRenounced: false,
        holderCount: 1, topHolderPct: 100, installBlock: 100, latestBlock: 130 }),
    });
    expect(ds.root).toMatch(/^[0-9a-f]+$/);
    const signals = extractSignals(ds.reports.map((r) => r.record));
    expect(signals.mintAuthorityOpen).toBe(true);
    expect(signals.contractAgeBlocks).toBe(30);
    expect(signals.lpHolderCount).toBeNull(); // not checked on Testnet
    expect(signals.supplyRenounced).toBe(false);
    expect(signals.holderCount).toBe(1);
    expect(signals.topHolderPct).toBe(100);
    expect(signals.liquidityDepth).toBeNull(); // not checked on Testnet
  });
});
