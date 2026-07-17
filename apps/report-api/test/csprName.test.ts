import { describe, expect, it, vi } from "vitest";
import { normalizeCsprName, resolveCsprName } from "../src/csprName.js";

const ALICE_PUBLIC_KEY = "0188ed5156681e57c66d2f3f5baa38126607774a6cba86369fa89970426242413a";
const ALICE_ACCOUNT_HASH = "1856e4a0b23c70b64e4509987680de0d99145fa0cdc71ad9b78760e18ff0deec";

describe("CSPR.name resolution", () => {
  it("normalizes root names and subnames without accepting arbitrary paths", () => {
    expect(normalizeCsprName(" Alice.CSPR ")).toBe("alice.cspr");
    expect(normalizeCsprName("pay.alice.cspr")).toBe("pay.alice.cspr");
    expect(normalizeCsprName("alice")) .toBeNull();
    expect(normalizeCsprName("../alice.cspr")).toBeNull();
    expect(normalizeCsprName("-alice.cspr")).toBeNull();
  });

  it("validates and returns an active Mainnet account resolution", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({
      data: {
        name: "alice.cspr",
        resolved_hash: ALICE_ACCOUNT_HASH,
        resolved_public_key: ALICE_PUBLIC_KEY,
        expires_at: "2027-11-25T09:00:00Z",
        is_primary: true
      }
    }));

    await expect(resolveCsprName("Alice.CSPR", {
      apiBaseUrl: "https://api.cspr.name",
      fetchImpl,
      now: Date.parse("2026-07-17T00:00:00Z")
    })).resolves.toEqual({
      name: "alice.cspr",
      accountHash: `account-hash-${ALICE_ACCOUNT_HASH}`,
      publicKey: ALICE_PUBLIC_KEY,
      expiresAt: "2027-11-25T09:00:00Z",
      isPrimary: true,
      network: "casper-mainnet",
      source: "CSPR.name",
      sourceUrl: "https://api.cspr.name/resolutions/alice.cspr"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cspr.name/resolutions/alice.cspr",
      expect.objectContaining({ headers: { accept: "application/json" }, redirect: "error" })
    );
  });

  it("returns no resolution for missing or expired names", async () => {
    await expect(resolveCsprName("missing.cspr", {
      fetchImpl: async () => Response.json({ error: { code: "not_found" } }, { status: 404 })
    })).resolves.toBeNull();

    await expect(resolveCsprName("alice.cspr", {
      now: Date.parse("2028-01-01T00:00:00Z"),
      fetchImpl: async () => Response.json({
        data: {
          name: "alice.cspr",
          resolved_hash: ALICE_ACCOUNT_HASH,
          resolved_public_key: ALICE_PUBLIC_KEY,
          expires_at: "2027-11-25T09:00:00Z"
        }
      })
    })).resolves.toBeNull();
  });

  it("rejects a public key that does not derive the returned account hash", async () => {
    await expect(resolveCsprName("alice.cspr", {
      fetchImpl: async () => Response.json({
        data: {
          name: "alice.cspr",
          resolved_hash: "f".repeat(64),
          resolved_public_key: ALICE_PUBLIC_KEY,
          expires_at: "2027-11-25T09:00:00Z"
        }
      })
    })).rejects.toThrow(/does not match/);
  });
});
