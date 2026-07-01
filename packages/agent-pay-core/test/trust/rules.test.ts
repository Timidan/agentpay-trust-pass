import { describe, it, expect } from "vitest";
import { scoreSubject } from "../../src/trust/rules.js";
import type { SubjectSignals } from "../../src/trust/signals.js";

const clean: SubjectSignals = { mintAuthorityOpen: false, supplyRenounced: true,
  holderCount: 40, topHolderPct: 12, contractAgeBlocks: 5000, lpHolderCount: 8, liquidityDepth: 100000 };

describe("scoreSubject", () => {
  it("DANGER when mint authority is open (hard-fail, LLM cannot override)", () => {
    const r = scoreSubject({ ...clean, mintAuthorityOpen: true });
    expect(r.aspect).toBe("DANGER");
    expect(r.decision).toBe("rejected");
    expect(r.flags.some(f => f.code === "mint_authority_open" && f.severity === "danger")).toBe(true);
  });
  it("DANGER on single-LP", () => {
    expect(scoreSubject({ ...clean, lpHolderCount: 1 }).aspect).toBe("DANGER");
  });
  it("DANGER when supply not renounced", () => {
    expect(scoreSubject({ ...clean, supplyRenounced: false }).aspect).toBe("DANGER");
  });
  it("CLEAR when every mandatory signal is present and clean", () => {
    const r = scoreSubject(clean);
    expect(r.aspect).toBe("CLEAR");
    expect(r.decision).toBe("approved");
    expect(r.flags).toHaveLength(0);
  });
  it("CAUTION + notChecked when a mandatory signal is missing", () => {
    const r = scoreSubject({ ...clean, mintAuthorityOpen: null });
    expect(r.aspect).toBe("CAUTION");
    expect(r.decision).toBe("needs_review");
    expect(r.notChecked).toContain("mintAuthorityOpen");
  });
  it("CAUTION on a very new contract that is otherwise clean", () => {
    expect(scoreSubject({ ...clean, contractAgeBlocks: 10 }).aspect).toBe("CAUTION");
  });
  it("DANGER exactly at the topHolderPct boundary (>= 95)", () => {
    expect(scoreSubject({ ...clean, topHolderPct: 95 }).aspect).toBe("DANGER");
  });
  it("CLEAR just below the topHolderPct boundary (94)", () => {
    expect(scoreSubject({ ...clean, topHolderPct: 94 }).aspect).toBe("CLEAR");
  });
  it("CLEAR exactly at the young-contract boundary (1000 blocks)", () => {
    expect(scoreSubject({ ...clean, contractAgeBlocks: 1000 }).aspect).toBe("CLEAR");
  });
  it("CAUTION just under the young-contract boundary (999 blocks)", () => {
    expect(scoreSubject({ ...clean, contractAgeBlocks: 999 }).aspect).toBe("CAUTION");
  });
  it("CLEAR when topHolderPct is null (it is a non-mandatory signal)", () => {
    expect(scoreSubject({ ...clean, topHolderPct: null }).aspect).toBe("CLEAR");
  });
});
