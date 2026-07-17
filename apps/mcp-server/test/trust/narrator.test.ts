import { describe, expect, it } from "vitest";
import { narrateVerdict } from "../../src/trust/narrator.js";

describe("narrateVerdict", () => {
  it("explains concrete flags without changing the decision", async () => {
    const result = await narrateVerdict({
      aspect: "DANGER",
      flags: [{
        code: "cep18_mint_burn_enabled",
        severity: "danger",
        message: "The CEP-18 mint and burn functions are enabled."
      }],
      notChecked: [],
      signals: {}
    });

    expect(result.rationale).toBe(
      "AgentPay found an issue: The CEP-18 mint and burn functions are enabled."
    );
    expect(result.notCheckedNote).toBe(
      "AgentPay completed every check required by this policy."
    );
  });

  it("uses plain labels for missing evidence", async () => {
    const result = await narrateVerdict({
      aspect: "CAUTION",
      flags: [],
      notChecked: ["mintBurnEnabled", "topHolderPct"],
      signals: {}
    });

    expect(result.rationale).toBe(
      "AgentPay could not finish every check required by this policy. Review what is missing before you proceed."
    );
    expect(result.notCheckedNote).toBe(
      "AgentPay could not check: the token's mint and burn setting, the share held by its largest holder."
    );
  });

  it("explains CLEAR without overstating what was checked", async () => {
    const result = await narrateVerdict({
      aspect: "CLEAR",
      flags: [],
      notChecked: [],
      signals: {}
    });

    expect(result.rationale).toBe(
      "Every check required by this policy ran and passed. Review the receipt before you proceed."
    );
  });
});
