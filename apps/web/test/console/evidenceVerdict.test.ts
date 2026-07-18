import { describe, expect, it } from "vitest";
import { decisionForPaidReport, verdictForPaidReport } from "../../src/console/evidenceVerdict";
import type { PaidReport } from "../../src/api";

function paidWith(subject: string, facts: Record<string, unknown>): PaidReport {
  return { report: { subject, facts }, evidence: [] } as unknown as PaidReport;
}

describe("evidenceVerdict", () => {
  it("routes a token subject through the token rule engine (mint/burn enabled → DANGER)", () => {
    const verdict = verdictForPaidReport(paidWith("dex_pair_surface", { mintBurnEnabled: true }));
    expect(verdict.aspect).toBe("DANGER");
    expect(decisionForPaidReport(paidWith("dex_pair_surface", { mintBurnEnabled: true }))).toBe("rejected");
  });

  it("routes an account_ subject through the account rule engine (not the token one)", () => {
    // A token flag on an account subject must be ignored: account routing means
    // the cep18 mint/burn flag never fires, so this is not a token-style DANGER.
    const verdict = verdictForPaidReport(paidWith("account_0123", { mintBurnEnabled: true, exists: false }));
    expect(verdict.flags.some((f) => f.code === "cep18_mint_burn_enabled")).toBe(false);
  });

  it("prefers the evidence leaves over the single report when present", () => {
    const report = {
      report: { subject: "dex_pair_surface", facts: {} },
      evidence: [{ record: { subject: "dex_pair_surface", facts: { mintBurnEnabled: true } } }]
    } as unknown as PaidReport;
    expect(verdictForPaidReport(report).aspect).toBe("DANGER");
  });
});
