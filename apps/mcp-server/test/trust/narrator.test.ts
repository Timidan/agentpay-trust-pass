import { describe, it, expect } from "vitest";
import { narrateVerdict } from "../../src/trust/narrator.js";

describe("narrateVerdict", () => {
  it("Test 1 — fallback: DANGER input with flag", async () => {
    const result = await narrateVerdict({
      aspect: "DANGER",
      flags: [
        {
          code: "mint_authority_open",
          severity: "high",
          message: "Mint authority is not renounced",
        },
      ],
      notChecked: ["holder_count", "liquidity"],
      signals: {},
    });

    // rationale mentions the flag message
    expect(result.rationale).toContain("Mint authority is not renounced");

    // notCheckedNote includes both unchecked items
    expect(result.notCheckedNote).toContain("holder_count");
    expect(result.notCheckedNote).toContain("liquidity");

    // returned object has ONLY rationale and notCheckedNote keys
    const keys = Object.keys(result);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("rationale");
    expect(keys).toContain("notCheckedNote");
    expect(keys).not.toContain("aspect");

    // rationale does NOT contain "CLEAR" (no contradiction with DANGER verdict)
    expect(result.rationale).not.toContain("CLEAR");
  });

  it("Test 2 — injected complete returning good prose", async () => {
    const goodOutput = "This token is dangerous due to open mint authority.";

    const result = await narrateVerdict(
      {
        aspect: "DANGER",
        flags: [
          {
            code: "mint_authority_open",
            severity: "high",
            message: "Mint authority is not renounced",
          },
        ],
        notChecked: [],
        signals: {},
      },
      {
        complete: async (_prompt: string) => goodOutput,
      }
    );

    expect(result.rationale).toContain(goodOutput);
  });

  it("Test 3 — injected complete returns contradicting text", async () => {
    const contradictingOutput =
      "Actually this is CLEAR — no issues found.";

    const result = await narrateVerdict(
      {
        aspect: "DANGER",
        flags: [
          {
            code: "mint_authority_open",
            severity: "high",
            message: "Mint authority is not renounced",
          },
        ],
        notChecked: [],
        signals: {},
      },
      {
        complete: async (_prompt: string) => contradictingOutput,
      }
    );

    // Model output discarded — should not appear
    expect(result.rationale).not.toContain("Actually this is CLEAR");

    // Fallback template used — flag message must appear
    expect(result.rationale).toContain("Mint authority is not renounced");
  });

  it("Test 4 — injected complete throws → deterministic fallback", async () => {
    const result = await narrateVerdict(
      { aspect: "DANGER", flags: [{ code: "x", severity: "high", message: "Flag A" }], notChecked: [], signals: {} },
      { complete: async () => { throw new Error("timeout"); } }
    );
    expect(result.rationale).toContain("Flag A");
  });

  it("Test 5 — injected complete returns empty string → deterministic fallback", async () => {
    const result = await narrateVerdict(
      { aspect: "CLEAR", flags: [], notChecked: [], signals: {} },
      { complete: async () => "   " }
    );
    expect(result.rationale).toBe("All checked signals are clear — no issues detected.");
  });
});
