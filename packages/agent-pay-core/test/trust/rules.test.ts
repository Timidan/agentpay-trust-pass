import { describe, it, expect } from "vitest";
import { scoreSubject } from "../../src/trust/rules.js";
import type { SubjectSignals } from "../../src/trust/signals.js";

const clean: SubjectSignals = { mintBurnEnabled: false, publicMintEntrypoint: false,
  holderCount: 40, topHolderPct: 12, contractAgeBlocks: 5000, lpHolderCount: 8, liquidityDepth: 100000 };

describe("scoreSubject", () => {
  it("DANGER when CEP-18 mint and burn functions are enabled", () => {
    const r = scoreSubject({ ...clean, mintBurnEnabled: true });
    expect(r.aspect).toBe("DANGER");
    expect(r.decision).toBe("rejected");
    expect(r.flags.some(f => f.code === "cep18_mint_burn_enabled" && f.severity === "danger")).toBe(true);
  });
  it("CAUTION when the active contract exposes a public mint entry point", () => {
    const r = scoreSubject({ ...clean, mintBurnEnabled: null, publicMintEntrypoint: true });
    expect(r.aspect).toBe("CAUTION");
    expect(r.decision).toBe("needs_review");
    expect(r.flags).toContainEqual(expect.objectContaining({ code: "public_mint_entrypoint", severity: "caution" }));
  });
  it("DANGER on single-LP", () => {
    expect(scoreSubject({ ...clean, lpHolderCount: 1 }).aspect).toBe("DANGER");
  });
  it("CLEAR when every mandatory signal is present and clean", () => {
    const r = scoreSubject(clean);
    expect(r.aspect).toBe("CLEAR");
    expect(r.decision).toBe("approved");
    expect(r.flags).toHaveLength(0);
  });
  it("CAUTION + notChecked when a mandatory signal is missing", () => {
    const r = scoreSubject({ ...clean, mintBurnEnabled: null, publicMintEntrypoint: null });
    expect(r.aspect).toBe("CAUTION");
    expect(r.decision).toBe("needs_review");
    expect(r.notChecked).toContain("supplyControl");
  });
  it("accepts an exact entry-point scan when the CEP-18 setting is absent", () => {
    const r = scoreSubject({ ...clean, mintBurnEnabled: null, publicMintEntrypoint: false });
    expect(r.aspect).toBe("CLEAR");
    expect(r.notChecked).not.toContain("supplyControl");
    expect(r.passed).toContain("No public mint entry point was found in the active contract.");
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
  it("CAUTION when top-holder concentration was not measured", () => {
    const result = scoreSubject({ ...clean, topHolderPct: null });
    expect(result.aspect).toBe("CAUTION");
    expect(result.notChecked).toContain("topHolderPct");
  });
  it("uses exact, signal-backed pass labels", () => {
    expect(scoreSubject(clean).passed).toEqual([
      "The standard CEP-18 mint and burn setting is disabled.",
      "Contract has existed for at least 1,000 blocks.",
      "Top-holder concentration is below 95%."
    ]);
  });
});
