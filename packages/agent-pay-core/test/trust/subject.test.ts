import { describe, it, expect } from "vitest";
import { parseSubject } from "../../src/trust/subject.js";

const HASH = "a".repeat(64);

describe("parseSubject", () => {
  it("accepts a raw 64-hex package hash as a token", () => {
    const r = parseSubject(HASH);
    expect(r).toEqual({ ok: true, subject: { kind: "token", packageHash: HASH, raw: HASH } });
  });
  it("strips a hash- prefix and lowercases", () => {
    const r = parseSubject(`hash-${"A".repeat(64)}`);
    expect(r.ok && r.subject.packageHash).toBe("a".repeat(64));
  });
  it("rejects empty / malformed input", () => {
    expect(parseSubject("").ok).toBe(false);
    expect(parseSubject("not-a-hash").ok).toBe(false);
    expect(parseSubject("b".repeat(63)).ok).toBe(false);
  });
});
