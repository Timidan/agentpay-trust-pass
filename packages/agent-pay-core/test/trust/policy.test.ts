import { describe, it, expect } from "vitest";
import { policyHash, POLICY_VERSION, buildVerdictReport } from "../../src/trust/policy.js";
import { scoreSubject } from "../../src/trust/rules.js";
import type { SubjectSignals } from "../../src/trust/signals.js";

const signals: SubjectSignals = { mintBurnEnabled: true, publicMintEntrypoint: true, holderCount: 1,
  topHolderPct: 100, contractAgeBlocks: 3, lpHolderCount: 1, liquidityDepth: null };

describe("policy", () => {
  it("policyHash is stable for a given POLICY_VERSION", () => {
    expect(policyHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(POLICY_VERSION).toBe("agentpay-token-check/v3");
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
