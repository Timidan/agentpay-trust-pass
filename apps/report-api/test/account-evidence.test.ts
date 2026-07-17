import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSubject } from "@agent-pay/core";
import { buildAccountEvidence, normalizeEntity } from "../src/accountEvidence";

const originalRpcUrl = process.env.CASPER_RPC_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalRpcUrl === undefined) delete process.env.CASPER_RPC_URL;
  else process.env.CASPER_RPC_URL = originalRpcUrl;
});

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

describe("buildAccountEvidence", () => {
  it("retries a transient RPC failure before degrading account facts", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("temporary transport failure"))
      .mockResolvedValueOnce(jsonResponse({
        result: { entity: LEGACY_ACCOUNT }
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: { balance: "123456" }
      }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.CASPER_RPC_URL = "https://rpc.example";
    const parsed = parseSubject(`account-hash-${"a".repeat(64)}`);
    if (!parsed.ok) throw new Error(parsed.error);

    const dataset = await buildAccountEvidence(parsed.subject);
    const facts = Object.assign({}, ...dataset.sourceSummary.map((source) => source.facts));

    expect(facts).toMatchObject({
      exists: true,
      associatedKeyCount: 1,
      balanceMotes: "123456"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the requested evidence network and its configured RPC", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (rawUrl) => {
      expect(String(rawUrl)).toBe("https://mainnet.example/rpc");
      return jsonResponse({ error: { code: -32000, message: "not found" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const parsed = parseSubject(`account-hash-${"b".repeat(64)}`);
    if (!parsed.ok) throw new Error(parsed.error);

    const dataset = await buildAccountEvidence(parsed.subject, {
      network: "casper-mainnet",
      rpcUrl: "https://mainnet.example/rpc"
    });

    expect(dataset.datasetId).toMatch(/^trust-account-casper-mainnet-/);
    expect(dataset.sourceSummary.every((source) => source.network === "casper-mainnet")).toBe(true);
    expect(dataset.sourceSummary.every((source) => source.sourceUrl === "https://mainnet.example/rpc")).toBe(true);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
