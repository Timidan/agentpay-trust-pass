import { describe, it, expect } from "vitest";
import { policyHash, POLICY_VERSION, buildVerdictReport } from "../../src/trust/policy.js";
import { scoreSubject } from "../../src/trust/rules.js";
import type { SubjectSignals } from "../../src/trust/signals.js";

const signals: SubjectSignals = { mintAuthorityOpen: true, supplyRenounced: false, holderCount: 1,
  topHolderPct: 100, contractAgeBlocks: 3, lpHolderCount: 1, liquidityDepth: null };

describe("policy", () => {
  it("policyHash is stable for a given POLICY_VERSION", () => {
    expect(policyHash()).toBe("4abaafbb035f997e25789fcd55ff683d7fed96eb6993947eb9a44ef8fcdcbaf0");
    expect(POLICY_VERSION).toBe("trust-signal/v1");
  });
  it("buildVerdictReport carries the deterministic aspect + policy provenance", () => {
    const rule = scoreSubject(signals);
    const vr = buildVerdictReport({
      subject: { kind: "token", packageHash: "a".repeat(64), raw: "a".repeat(64) },
      signals, rule, rationale: "n/a", notCheckedNote: "n/a",
    });
    expect(vr.aspect).toBe("DANGER");
    expect(vr.policyVersion).toBe(POLICY_VERSION);
    expect(vr.policyHash).toBe(policyHash());
  });
});
