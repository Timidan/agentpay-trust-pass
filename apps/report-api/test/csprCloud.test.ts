import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSubjectTokenState, getHeroTokenList } from "../src/csprCloud.js";

const PACKAGE_HASH = "a".repeat(64);
const ACTIVE_CONTRACT_HASH = "c".repeat(64);
const MINT_FLAG_UREF = `uref-${"d".repeat(64)}-007`;
const SUPPLY_UREF = `uref-${"e".repeat(64)}-007`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getHeroTokenList", () => {
  it("surfaces an unconfigured discovery source instead of a healthy empty list", async () => {
    vi.stubEnv("CSPR_CLOUD_ACCESS_TOKEN", "");

    await expect(getHeroTokenList()).rejects.toThrow(/CSPR\.cloud token discovery is not configured/);
  });

  it("treats an empty package scan as unavailable instead of a healthy empty list", async () => {
    vi.stubEnv("CSPR_CLOUD_ACCESS_TOKEN", "test-access-token");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ data: [] })));

    await expect(getHeroTokenList()).rejects.toThrow(/returned no CEP-18 packages/);
  });

  it("rejects a partial discovery result when any token assessment fails", async () => {
    vi.stubEnv("CSPR_CLOUD_ACCESS_TOKEN", "test-access-token");
    const secondPackageHash = "b".repeat(64);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (rawUrl) => {
      const url = String(rawUrl);
      if (url.includes("/contract-packages?")) {
        return Response.json({
          data: [
            {
              contract_package_hash: PACKAGE_HASH,
              latest_version_contract_type_id: 2,
              metadata: { symbol: "ONE" }
            },
            {
              contract_package_hash: secondPackageHash,
              latest_version_contract_type_id: 2,
              metadata: { symbol: "TWO" }
            }
          ]
        });
      }
      if (url.includes(`/contract-packages/${PACKAGE_HASH}/ft-token-ownership`)) {
        return Response.json({ data: [{ balance: "10" }], item_count: 1 });
      }
      if (url.includes(`/contract-packages/${secondPackageHash}/ft-token-ownership`)) {
        return Response.json({ error: "upstream unavailable" }, { status: 503 });
      }
      return Response.json({ error: "unexpected request" }, { status: 500 });
    }));

    await expect(getHeroTokenList()).rejects.toThrow(/assessments are unavailable/);
  });
});

describe("fetchSubjectTokenState", () => {
  it("fills every required token fact from public CSPR.live and Casper RPC without an indexer token", async () => {
    vi.stubEnv("CSPR_CLOUD_ACCESS_TOKEN", "discovery-only-token");
    const publicIndexerBase = "https://api.testnet.cspr.live.example";
    const publicRpc = "https://public-casper.test/rpc";
    const fetchImpl = vi.fn<typeof fetch>(async (rawUrl, init) => {
      const url = String(rawUrl);
      if (url === `${publicIndexerBase}/contract-packages/${PACKAGE_HASH}`) {
        return Response.json({
          data: {
            contract_package_hash: PACKAGE_HASH,
            latest_version_contract_type_id: 2,
            timestamp: "2026-06-01T00:00:00.000Z",
            metadata: { total_supply_uref: SUPPLY_UREF }
          }
        });
      }
      if (url.includes(`${publicIndexerBase}/contract-packages/${PACKAGE_HASH}/ft-token-ownership`)) {
        return Response.json({ data: [{ balance: "250" }], item_count: 10 });
      }
      if (url.includes(`${publicIndexerBase}/contract-packages/${PACKAGE_HASH}/contracts`)) {
        return Response.json({
          data: [{
            contract_hash: ACTIVE_CONTRACT_HASH,
            block_height: 100,
            contract_version: 1,
            is_disabled: false
          }]
        });
      }
      if (url === publicRpc) {
        const request = JSON.parse(String(init?.body)) as { id: number; params: { key: string } };
        if (request.params.key === `hash-${PACKAGE_HASH}`) {
          return rpcResponse(request.id, {
            ContractPackage: {
              versions: [{
                protocol_version_major: 2,
                contract_version: 1,
                contract_hash: `contract-${ACTIVE_CONTRACT_HASH}`
              }],
              disabled_versions: []
            }
          });
        }
        if (request.params.key === `hash-${ACTIVE_CONTRACT_HASH}`) {
          return rpcResponse(request.id, {
            Contract: { named_keys: [], entry_points: [] }
          });
        }
        if (request.params.key === SUPPLY_UREF) {
          return rpcResponse(request.id, { CLValue: { parsed: "1000" } });
        }
      }
      return Response.json({ error: "unexpected request", url }, { status: 500 });
    }) as typeof fetch;

    await expect(fetchSubjectTokenState(PACKAGE_HASH, {
      network: "casper-testnet",
      publicIndexerBase,
      casperRpcUrl: publicRpc,
      fetchImpl
    })).resolves.toEqual({
      mintBurnEnabled: null,
      publicMintEntrypoint: false,
      holderCount: 10,
      topHolderPct: 25,
      installBlock: 100,
      packageCreatedAt: "2026-06-01T00:00:00.000Z",
      authoritySourceUrl: publicRpc,
      holdersSourceUrl: `${publicIndexerBase}/contract-packages/${PACKAGE_HASH}/ft-token-ownership`,
      ageSourceUrl: `${publicIndexerBase}/contract-packages/${PACKAGE_HASH}/contracts`
    });

    for (const [rawUrl, init] of fetchImpl.mock.calls) {
      if (!String(rawUrl).startsWith(publicIndexerBase)) continue;
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
  });

  it("derives holder concentration, install height, and locked mint authority from live source shapes", async () => {
    const fetchImpl = sourceFetch({ mintBurnFlag: 0 });

    await expect(fetchSubjectTokenState(PACKAGE_HASH, sourceOptions(fetchImpl))).resolves.toEqual({
      mintBurnEnabled: false,
      publicMintEntrypoint: false,
      holderCount: 10,
      topHolderPct: 25,
      installBlock: 100,
      packageCreatedAt: "2026-06-01T00:00:00.000Z",
      authoritySourceUrl: "https://node.testnet.example/rpc",
      holdersSourceUrl: `https://api.testnet.example/contract-packages/${PACKAGE_HASH}/ft-token-ownership`,
      ageSourceUrl: `https://api.testnet.example/contract-packages/${PACKAGE_HASH}/contracts`
    });

    expect(fetchImpl).toHaveBeenCalled();
  });

  it("uses only the subject-specific credential for authenticated subject evidence", async () => {
    vi.stubEnv("CSPR_CLOUD_ACCESS_TOKEN", "discovery-only-token");
    vi.stubEnv("CSPR_CLOUD_SUBJECT_ACCESS_TOKEN", "subject-only-token");
    const fetchImpl = sourceFetch({ mintBurnFlag: 0 });

    const state = await fetchSubjectTokenState(PACKAGE_HASH, {
      restBase: "https://api.testnet.example",
      nodeRpcUrl: "https://node.testnet.example/rpc",
      fetchImpl
    });

    expect(state.holderCount).toBe(10);
    for (const [, init] of vi.mocked(fetchImpl).mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe("subject-only-token");
    }
  });

  it("reports enabled CEP-18 minting as mutable supply", async () => {
    const state = await fetchSubjectTokenState(
      PACKAGE_HASH,
      sourceOptions(sourceFetch({ mintBurnFlag: 1 }))
    );

    expect(state).toMatchObject({
      mintBurnEnabled: true,
      installBlock: 100
    });
  });

  it("keeps holder and age evidence when the on-chain authority lookup is unavailable", async () => {
    const state = await fetchSubjectTokenState(
      PACKAGE_HASH,
      sourceOptions(sourceFetch({ mintBurnFlag: null }))
    );

    expect(state).toMatchObject({
      mintBurnEnabled: null,
      holderCount: 10,
      topHolderPct: 25,
      installBlock: 100
    });
  });

  it("does not infer the total holder count from one ownership page", async () => {
    const state = await fetchSubjectTokenState(
      PACKAGE_HASH,
      sourceOptions(sourceFetch({
        mintBurnFlag: 0,
        holderBody: { data: [{ balance: "250" }] }
      }))
    );

    expect(state.holderCount).toBeNull();
    expect(state.topHolderPct).toBe(25);
  });

  it("rejects malformed holder totals and negative balances", async () => {
    const state = await fetchSubjectTokenState(
      PACKAGE_HASH,
      sourceOptions(sourceFetch({
        mintBurnFlag: 0,
        holderBody: { data: [{ balance: "-1" }], item_count: 1.5 }
      }))
    );

    expect(state.holderCount).toBeNull();
    expect(state.topHolderPct).toBeNull();
  });

  it("does not report a concentration above 100 percent", async () => {
    const state = await fetchSubjectTokenState(
      PACKAGE_HASH,
      sourceOptions(sourceFetch({
        mintBurnFlag: 0,
        holderBody: { data: [{ balance: "1001" }], item_count: 10 }
      }))
    );

    expect(state.holderCount).toBe(10);
    expect(state.topHolderPct).toBeNull();
  });

  it("reads CEP-18 mint authority from the public Casper RPC without an indexer token", async () => {
    const publicRpc = "https://public-casper.test/rpc";
    const fetchImpl = vi.fn<typeof fetch>(async (_rawUrl, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; params: { key: string } };
      if (request.params.key === `hash-${PACKAGE_HASH}`) {
        return rpcResponse(request.id, {
          ContractPackage: {
            versions: [
              {
                protocol_version_major: 1,
                contract_version: 1,
                contract_hash: `contract-${ACTIVE_CONTRACT_HASH}`
              }
            ],
            disabled_versions: []
          }
        });
      }
      if (request.params.key === `hash-${ACTIVE_CONTRACT_HASH}`) {
        return rpcResponse(request.id, {
          Contract: {
            named_keys: [{ name: "enable_mint_burn", key: MINT_FLAG_UREF }],
            entry_points: []
          }
        });
      }
      if (request.params.key === MINT_FLAG_UREF) {
        return rpcResponse(request.id, { CLValue: { parsed: 0 } });
      }
      return Response.json({ error: "unexpected request" }, { status: 500 });
    }) as typeof fetch;

    await expect(fetchSubjectTokenState(PACKAGE_HASH, {
      accessToken: "",
      restBase: "https://api.testnet.example",
      nodeRpcUrl: "https://node.testnet.example/rpc",
      casperRpcUrl: publicRpc,
      fetchImpl
    })).resolves.toMatchObject({
      mintBurnEnabled: false,
      publicMintEntrypoint: false,
      holderCount: null,
      topHolderPct: null,
      installBlock: null,
      authoritySourceUrl: publicRpc
    });

    expect(fetchImpl.mock.calls.filter(([rawUrl]) => String(rawUrl) === publicRpc)).toHaveLength(3);
  });

  it("uses a public mint entry point when the CEP-18 install flag is absent", async () => {
    const publicRpc = "https://public-casper.test/rpc";
    const fetchImpl = vi.fn<typeof fetch>(async (_rawUrl, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; params: { key: string } };
      if (request.params.key === `hash-${PACKAGE_HASH}`) {
        return rpcResponse(request.id, {
          ContractPackage: {
            versions: [{ protocol_version_major: 2, contract_version: 1, contract_hash: `contract-${ACTIVE_CONTRACT_HASH}` }],
            disabled_versions: []
          }
        });
      }
      if (request.params.key === `hash-${ACTIVE_CONTRACT_HASH}`) {
        return rpcResponse(request.id, {
          Contract: {
            named_keys: [],
            entry_points: [{ name: "mint", access: "Public" }, { name: "burn", access: "Public" }]
          }
        });
      }
      return Response.json({ error: "unexpected request" }, { status: 500 });
    }) as typeof fetch;

    await expect(fetchSubjectTokenState(PACKAGE_HASH, {
      accessToken: "",
      casperRpcUrl: publicRpc,
      fetchImpl
    })).resolves.toMatchObject({
      mintBurnEnabled: null,
      publicMintEntrypoint: true
    });
  });

  it("honors tuple-form disabled package versions returned by Casper RPC", async () => {
    const olderContractHash = "b".repeat(64);
    const publicRpc = "https://public-casper.test/rpc";
    const fetchImpl = vi.fn<typeof fetch>(async (_rawUrl, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; params: { key: string } };
      if (request.params.key === `hash-${PACKAGE_HASH}`) {
        return rpcResponse(request.id, {
          ContractPackage: {
            versions: [
              { protocol_version_major: 2, contract_version: 1, contract_hash: `contract-${olderContractHash}` },
              { protocol_version_major: 2, contract_version: 2, contract_hash: `contract-${ACTIVE_CONTRACT_HASH}` }
            ],
            disabled_versions: [[2, 2]]
          }
        });
      }
      if (request.params.key === `hash-${olderContractHash}`) {
        return rpcResponse(request.id, { Contract: { named_keys: [], entry_points: [] } });
      }
      return Response.json({ error: "disabled contract queried" }, { status: 500 });
    }) as typeof fetch;

    const state = await fetchSubjectTokenState(PACKAGE_HASH, {
      accessToken: "",
      casperRpcUrl: publicRpc,
      fetchImpl
    });

    expect(state.publicMintEntrypoint).toBe(false);
    expect(fetchImpl.mock.calls.filter(([rawUrl]) => String(rawUrl) === publicRpc)).toHaveLength(2);
  });
});

function sourceOptions(fetchImpl: typeof fetch) {
  return {
    accessToken: "test-access-token",
    restBase: "https://api.testnet.example",
    nodeRpcUrl: "https://node.testnet.example/rpc",
    fetchImpl
  };
}

function sourceFetch(input: {
  mintBurnFlag: 0 | 1 | null;
  holderBody?: { data: Array<{ balance?: string }>; item_count?: number };
  supply?: string;
}): typeof fetch {
  return vi.fn<typeof fetch>(async (rawUrl, init) => {
    const url = String(rawUrl);
    if (url.endsWith(`/contract-packages/${PACKAGE_HASH}`)) {
      return Response.json({
        contract_package_hash: PACKAGE_HASH,
        latest_version_contract_type_id: 2,
        timestamp: "2026-06-01T00:00:00.000Z",
        metadata: { total_supply_uref: SUPPLY_UREF }
      });
    }
    if (url.includes("/ft-token-ownership")) {
      return Response.json(input.holderBody ?? { data: [{ balance: "250" }], item_count: 10 });
    }
    if (url.includes("/contracts")) {
      return Response.json({
        data: [
          {
            contract_hash: "b".repeat(64),
            block_height: 100,
            contract_version: 1,
            is_disabled: true
          },
          {
            contract_hash: ACTIVE_CONTRACT_HASH,
            block_height: 150,
            contract_version: 2,
            is_disabled: false
          }
        ]
      });
    }
    if (url === "https://node.testnet.example/rpc") {
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        params: { key: string };
      };
      if (request.params.key === SUPPLY_UREF) {
        return rpcResponse(request.id, { CLValue: { parsed: input.supply ?? "1000" } });
      }
      if (request.params.key === `hash-${ACTIVE_CONTRACT_HASH}`) {
        if (input.mintBurnFlag === null) {
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32000, message: "source unavailable" }
          });
        }
        return rpcResponse(request.id, {
          Contract: {
            named_keys: [{ name: "enable_mint_burn", key: MINT_FLAG_UREF }],
            entry_points: []
          }
        });
      }
      if (request.params.key === MINT_FLAG_UREF) {
        return rpcResponse(request.id, { CLValue: { parsed: input.mintBurnFlag } });
      }
    }
    return Response.json({ error: "unexpected request", url }, { status: 500 });
  }) as typeof fetch;
}

function rpcResponse(id: number, storedValue: Record<string, unknown>): Response {
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: { stored_value: storedValue }
  });
}
