import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSymbolMap,
  fetchCsprTradeMarketState,
  resolveTokenBySymbol
} from "../src/liveEvidence";

const WCSPR_HASH = "8df5d26790e18cf0404502c62ce5dc9025800ad6975c97466e20506c39c505b6";
const OTHER_HASH = "a".repeat(64);

function pair(token0: Record<string, unknown>, token1: Record<string, unknown>) {
  return { token0, token1 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSymbolMap", () => {
  it("maps both sides of each pair to lowercase package hashes", () => {
    const map = buildSymbolMap([
      pair(
        { symbol: "WCSPR", packageHash: WCSPR_HASH.toUpperCase(), name: "Wrapped CSPR" },
        { symbol: "GHTST1", packageHash: OTHER_HASH, name: null }
      )
    ]);
    expect(map.get("WCSPR")).toEqual({ symbol: "WCSPR", packageHash: WCSPR_HASH, name: "Wrapped CSPR", ambiguous: false });
    expect(map.get("GHTST1")?.packageHash).toBe(OTHER_HASH);
  });

  it("marks a symbol ambiguous when it appears with two different hashes", () => {
    const map = buildSymbolMap([
      pair({ symbol: "Wcspr", packageHash: WCSPR_HASH, name: "First" }, { symbol: "X", packageHash: OTHER_HASH, name: null }),
      pair({ symbol: "WCSPR", packageHash: OTHER_HASH, name: "Spoof" }, { symbol: "Y", packageHash: OTHER_HASH, name: null })
    ]);
    // A spoofed pair reusing a real ticker must not silently win or lose:
    // the symbol becomes unresolvable and the caller pastes the exact hash.
    expect(map.get("WCSPR")?.ambiguous).toBe(true);
  });

  it("keeps a symbol unambiguous when repeated with the same hash", () => {
    const map = buildSymbolMap([
      pair({ symbol: "WCSPR", packageHash: WCSPR_HASH, name: "A" }, { symbol: "X", packageHash: OTHER_HASH, name: null }),
      pair({ symbol: "wcspr", packageHash: WCSPR_HASH.toUpperCase(), name: "B" }, { symbol: "Y", packageHash: OTHER_HASH, name: null })
    ]);
    expect(map.get("WCSPR")?.ambiguous).toBe(false);
  });

  it("skips tokens without a symbol or with a malformed hash", () => {
    const map = buildSymbolMap([
      pair({ symbol: null, packageHash: WCSPR_HASH }, { symbol: "BAD", packageHash: "not-a-hash" })
    ]);
    expect(map.size).toBe(0);
  });

  it("treats an empty CSPR.trade pair response as unavailable, not authoritative", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id?: string; method: string };
      if (request.method === "initialize") {
        return mcpResponse({ id: request.id, result: {} }, { "mcp-session-id": "test-session" });
      }
      if (request.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      return mcpResponse({
        id: request.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ data: [], pageCount: 1 }) }]
        }
      });
    }));

    await expect(resolveTokenBySymbol("WCSPR")).rejects.toThrow(/pair set came back empty/);
  });

  it("treats a truncated CSPR.trade pair scan as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id?: string; method: string };
      if (request.method === "initialize") {
        return mcpResponse({ id: request.id, result: {} }, { "mcp-session-id": "truncated-session" });
      }
      if (request.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      return mcpResponse({
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              data: [pair(
                { symbol: "WCSPR", packageHash: WCSPR_HASH },
                { symbol: "OTHER", packageHash: OTHER_HASH }
              )],
              pageCount: 11
            })
          }]
        }
      });
    }));

    await expect(resolveTokenBySymbol("WCSPR")).rejects.toThrow(/10-page limit/);
  });
});

describe("fetchCsprTradeMarketState", () => {
  it("binds exact package matches to priced CSPR.trade pool liquidity", async () => {
    vi.stubGlobal("fetch", csprTradeFetch([
      {
        contractPackageHash: "c".repeat(64),
        token0: { symbol: "WCSPR", packageHash: WCSPR_HASH, decimals: 9 },
        token1: { symbol: "OTHER", packageHash: OTHER_HASH, decimals: 6 },
        reserve0: "1000000000",
        reserve1: "3000000",
        fiatPrice0: 2,
        fiatPrice1: 1
      }
    ]));

    await expect(fetchCsprTradeMarketState(WCSPR_HASH)).resolves.toMatchObject({
      listedOnCsprTrade: true,
      pairCount: 1,
      pricedPairCount: 1,
      pricedLiquidityUsd: 5,
      sourceUrl: "https://mcp.cspr.trade/mcp"
    });
  });

  it("reports an exact unlisted result after a successful pair scan", async () => {
    const state = await fetchCsprTradeMarketState("f".repeat(64));

    expect(state).toMatchObject({
      listedOnCsprTrade: false,
      pairCount: 0,
      pricedPairCount: 0,
      pricedLiquidityUsd: 0
    });
    expect(state.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("CSPR.trade availability", () => {
  it("retries one transient session failure inside the discovery deadline", async () => {
    vi.resetModules();
    const stableFetch = csprTradeFetch([
      pair(
        { symbol: "WCSPR", packageHash: WCSPR_HASH, name: "Wrapped CSPR" },
        { symbol: "OTHER", packageHash: OTHER_HASH, name: "Other" }
      )
    ]);
    let initializationAttempts = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      if (request.method === "initialize") {
        initializationAttempts += 1;
        if (initializationAttempts === 1) {
          throw new TypeError("temporary upstream connection failure");
        }
      }
      return stableFetch(url, init);
    }));

    const { resolveTokenBySymbol: resolveFreshToken } = await import("../src/liveEvidence");
    await expect(resolveFreshToken("WCSPR")).resolves.toMatchObject({
      symbol: "WCSPR",
      packageHash: `hash-${WCSPR_HASH}`
    });
    expect(initializationAttempts).toBe(2);
  });
});

function csprTradeFetch(pairs: Array<Record<string, unknown>>): typeof fetch {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { id?: string; method: string };
    if (request.method === "initialize") {
      return mcpResponse({ id: request.id, result: {} }, { "mcp-session-id": "market-session" });
    }
    if (request.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    return mcpResponse({
      id: request.id,
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({ data: pairs, itemCount: pairs.length, pageCount: 1 })
        }]
      }
    });
  }) as typeof fetch;
}

function mcpResponse(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers }
  });
}
