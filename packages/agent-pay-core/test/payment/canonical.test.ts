import { describe, expect, it } from "vitest";
import { artifactHash, canonicalJson } from "../../src/payment/index.js";

describe("payment artifact canonicalization", () => {
  it("sorts object keys recursively without changing array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [3, 2, 1] })).toBe(
      '{"a":{"x":3,"y":2},"list":[3,2,1],"z":1}'
    );
  });

  it("uses JSON number semantics for negative zero", () => {
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}');
  });

  it.each([
    ["BigInt", { amount: 1n }],
    ["undefined", { amount: undefined }],
    ["non-finite number", { amount: Number.POSITIVE_INFINITY }]
  ])("rejects %s because it is not a canonical JSON value", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(/canonical JSON/i);
  });

  it("hashes semantically identical object key orders identically", () => {
    expect(artifactHash({ b: 2, a: 1 })).toBe(artifactHash({ a: 1, b: 2 }));
  });
});
