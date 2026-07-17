import { describe, expect, it } from "vitest";
import { normalizePackageHash } from "../src/hash.js";

describe("normalizePackageHash", () => {
  const bare = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

  it("strips a lower-case hash- prefix", () => {
    expect(normalizePackageHash(`hash-${bare}`)).toBe(bare);
  });

  it("lower-cases so an upper-case prefix and body canonicalize", () => {
    expect(normalizePackageHash(`HASH-${bare.toUpperCase()}`)).toBe(bare);
  });

  it("trims surrounding whitespace before stripping", () => {
    expect(normalizePackageHash(`  hash-${bare}\n`)).toBe(bare);
  });

  it("is idempotent on an already-normalized value", () => {
    expect(normalizePackageHash(bare)).toBe(bare);
  });

  it("leaves a bare hash untouched apart from case", () => {
    expect(normalizePackageHash(bare.toUpperCase())).toBe(bare);
  });
});
