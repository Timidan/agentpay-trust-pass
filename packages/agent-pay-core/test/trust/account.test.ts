import { describe, expect, it } from "vitest";
import {
  extractAccountSignals,
  parseSubject,
  scoreAccount,
  type AccountSignals
} from "../../src/trust/index.js";

const HEX64 = "a".repeat(64);

function signals(over: Partial<AccountSignals>): AccountSignals {
  return {
    exists: true,
    balanceMotes: "5000000000",
    associatedKeyCount: 1,
    deploymentThreshold: 1,
    keyManagementThreshold: 1,
    namedKeyCount: 0,
    ageBlocks: null,
    txCount: null,
    ...over
  };
}

describe("parseSubject — accounts", () => {
  it("recognizes account-hash- identifiers as accounts", () => {
    const r = parseSubject(`account-hash-${HEX64}`);
    expect(r.ok && r.subject.kind).toBe("account");
    expect(r.ok && r.subject.accountId).toBe(HEX64);
  });

  it("recognizes ed25519 and secp256k1 public keys as accounts", () => {
    const ed = parseSubject(`01${HEX64}`);
    expect(ed.ok && ed.subject.kind).toBe("account");
    expect(ed.ok && ed.subject.publicKey).toBe(`01${HEX64}`);
    const secp = parseSubject(`02${"b".repeat(66)}`);
    expect(secp.ok && secp.subject.kind).toBe("account");
  });

  it("still treats a bare / hash- prefixed 64-hex as a token", () => {
    expect(parseSubject(HEX64).ok && parseSubject(HEX64).subject!.kind).toBe("token");
    expect(parseSubject(`hash-${HEX64}`).ok && parseSubject(`hash-${HEX64}`).subject!.kind).toBe("token");
  });
});

describe("scoreAccount", () => {
  it("CLEAR for a funded, sanely-configured account", () => {
    const r = scoreAccount(signals({}));
    expect(r.aspect).toBe("CLEAR");
    expect(r.decision).toBe("approved");
    expect(r.flags).toHaveLength(0);
  });

  it("DANGER when the account does not exist on-chain", () => {
    const r = scoreAccount(signals({ exists: false, balanceMotes: "0" }));
    expect(r.aspect).toBe("DANGER");
    expect(r.flags.map((f) => f.code)).toContain("account_not_found");
  });

  it("CAUTION for a dust-balance account", () => {
    const r = scoreAccount(signals({ balanceMotes: "10" }));
    expect(r.aspect).toBe("CAUTION");
    expect(r.flags.map((f) => f.code)).toContain("dust_balance");
  });

  it("CAUTION when one key can rotate a multisig's keys", () => {
    const r = scoreAccount(signals({ associatedKeyCount: 3, keyManagementThreshold: 1, deploymentThreshold: 2 }));
    expect(r.aspect).toBe("CAUTION");
    expect(r.flags.map((f) => f.code)).toContain("weak_key_management");
  });

  it("CLEAR for a healthy multisig (threshold > 1 both ways)", () => {
    const r = scoreAccount(signals({ associatedKeyCount: 3, keyManagementThreshold: 2, deploymentThreshold: 2 }));
    expect(r.aspect).toBe("CLEAR");
  });

  it("CAUTION (not CLEAR) when a mandatory signal could not be checked", () => {
    const r = scoreAccount(signals({ balanceMotes: null }));
    expect(r.aspect).toBe("CAUTION");
    expect(r.notChecked).toContain("balanceMotes");
  });

  it("extractAccountSignals reads facts off evidence records", () => {
    const s = extractAccountSignals([
      { id: "a", product: "p", network: "n", subject: "account_identity", observedAt: "t", sourceUrl: "u", facts: { exists: true, namedKeyCount: 2 }, rawHash: "h" },
      { id: "b", product: "p", network: "n", subject: "account_balance", observedAt: "t", sourceUrl: "u", facts: { balanceMotes: "9" }, rawHash: "h" }
    ]);
    expect(s.exists).toBe(true);
    expect(s.namedKeyCount).toBe(2);
    expect(s.balanceMotes).toBe("9");
  });
});
