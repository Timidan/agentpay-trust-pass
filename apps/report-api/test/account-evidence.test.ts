import { describe, expect, it } from "vitest";
import { normalizeEntity } from "../src/accountEvidence";

// Shapes taken from the live testnet node (Account) and the documented
// Casper 2.0 EntityOrAccount enum (LegacyAccount, AddressableEntity).
const LEGACY_ACCOUNT = {
  Account: {
    account_hash: "account-hash-aa",
    main_purse: "uref-11-007",
    named_keys: [{ name: "x", key: "hash-1" }],
    associated_keys: [{ account_hash: "account-hash-aa", weight: 1 }],
    action_thresholds: { deployment: 1, key_management: 1 }
  }
};

const ADDRESSABLE_ENTITY = {
  AddressableEntity: {
    entity: {
      main_purse: "uref-22-007",
      associated_keys: [
        { account_hash: "account-hash-bb", weight: 1 },
        { account_hash: "account-hash-cc", weight: 1 }
      ],
      action_thresholds: { deployment: 2, key_management: 2 }
    },
    named_keys: [{ name: "a", key: "hash-1" }, { name: "b", key: "hash-2" }],
    entry_points: []
  }
};

describe("normalizeEntity", () => {
  it("reads the flat legacy Account variant", () => {
    const n = normalizeEntity(LEGACY_ACCOUNT);
    expect(n).not.toBeNull();
    expect(n!.mainPurse).toBe("uref-11-007");
    expect(n!.associatedKeyCount).toBe(1);
    expect(n!.deploymentThreshold).toBe(1);
    expect(n!.namedKeyCount).toBe(1);
  });

  it("reads the nested AddressableEntity variant (control fields on inner entity)", () => {
    const n = normalizeEntity(ADDRESSABLE_ENTITY);
    expect(n).not.toBeNull();
    expect(n!.mainPurse).toBe("uref-22-007");
    expect(n!.associatedKeyCount).toBe(2);
    expect(n!.deploymentThreshold).toBe(2);
    expect(n!.keyManagementThreshold).toBe(2);
    expect(n!.namedKeyCount).toBe(2); // sibling of inner entity
  });

  it("treats a bare LegacyAccount key the same as Account", () => {
    const n = normalizeEntity({ LegacyAccount: LEGACY_ACCOUNT.Account });
    expect(n!.associatedKeyCount).toBe(1);
  });

  it("returns null for an unknown/contract entity shape", () => {
    expect(normalizeEntity({ Package: {} })).toBeNull();
    expect(normalizeEntity(null)).toBeNull();
  });
});
