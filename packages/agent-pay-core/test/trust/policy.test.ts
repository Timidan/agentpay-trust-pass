import { describe, it, expect } from "vitest";
import { accountPolicyHash, policyHash, POLICY_VERSION, buildVerdictReport } from "../../src/trust/policy.js";
import { ACCOUNT_MANDATORY_SIGNALS } from "../../src/trust/accountRules.js";
import { scoreSubject, SUBJECT_MANDATORY_SIGNALS } from "../../src/trust/rules.js";
import type { SubjectSignals } from "../../src/trust/signals.js";

const signals: SubjectSignals = { mintBurnEnabled: true, publicMintEntrypoint: true, holderCount: 1,
  topHolderPct: 100, contractAgeBlocks: 3, lpHolderCount: 1, liquidityDepth: null };

describe("policy", () => {
  it("policyHash is stable for a given POLICY_VERSION", () => {
    expect(policyHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(POLICY_VERSION).toBe("agentpay-token-check/v3");
  });

  // The policy definition is now derived from the rule-engine constants. These
  // pin the recorded on-chain hashes so that derivation cannot change them, and
  // so any future edit to the mandatory set or thresholds is a conscious break.
  it("derived policy hashes match the values recorded on Casper", () => {
    expect(policyHash()).toBe("da67de32572cb2081d00cdfd96f8627a0b42d4eb742741215317bf8cad1a26b2");
    expect(accountPolicyHash()).toBe("9f36e1f0c5660c552da42359b625b0eae94cc435eafc0c83b7cebd9c9bf272a3");
  });
  it("keeps mandatory signal sets immutable at runtime", () => {
    const tokenSignals = [...SUBJECT_MANDATORY_SIGNALS];
    const accountSignals = [...ACCOUNT_MANDATORY_SIGNALS];
    const tokenHash = policyHash();
    const accountHash = accountPolicyHash();

    try {
      expect(() => {
        (SUBJECT_MANDATORY_SIGNALS as unknown as string[]).length = 0;
      }).toThrow(TypeError);
      expect(() => {
        (ACCOUNT_MANDATORY_SIGNALS as unknown as string[]).length = 0;
      }).toThrow(TypeError);
    } finally {
      if (!Object.isFrozen(SUBJECT_MANDATORY_SIGNALS)) {
        (SUBJECT_MANDATORY_SIGNALS as unknown as string[]).splice(0, Infinity, ...tokenSignals);
      }
      if (!Object.isFrozen(ACCOUNT_MANDATORY_SIGNALS)) {
        (ACCOUNT_MANDATORY_SIGNALS as unknown as string[]).splice(0, Infinity, ...accountSignals);
      }
    }

    expect(SUBJECT_MANDATORY_SIGNALS).toEqual(tokenSignals);
    expect(ACCOUNT_MANDATORY_SIGNALS).toEqual(accountSignals);
    expect(policyHash()).toBe(tokenHash);
    expect(accountPolicyHash()).toBe(accountHash);
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
