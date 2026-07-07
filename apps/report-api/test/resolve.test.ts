import { describe, expect, it } from "vitest";
import { buildSymbolMap } from "../src/liveEvidence";

const WCSPR_HASH = "8df5d26790e18cf0404502c62ce5dc9025800ad6975c97466e20506c39c505b6";
const OTHER_HASH = "a".repeat(64);

function pair(token0: Record<string, unknown>, token1: Record<string, unknown>) {
  return { token0, token1 };
}

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
});
