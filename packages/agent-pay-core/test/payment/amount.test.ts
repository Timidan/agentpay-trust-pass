import { describe, expect, it } from "vitest";
import { parseBaseUnitAmount, U256_MAX } from "../../src/payment/amount.js";

describe("parseBaseUnitAmount", () => {
  it("accepts a positive whole number of base units", () => {
    expect(parseBaseUnitAmount("10000")).toEqual({ ok: true, amount: 10000n });
  });

  it("accepts the U256 maximum", () => {
    expect(parseBaseUnitAmount(U256_MAX.toString())).toEqual({ ok: true, amount: U256_MAX });
  });

  it.each(["0", "-1", "1.5", "010000", "", "abc"])("rejects %j as not a positive integer", (value) => {
    expect(parseBaseUnitAmount(value)).toEqual({ ok: false, reason: "not_positive_integer" });
  });

  it("rejects an amount above the U256 ceiling", () => {
    expect(parseBaseUnitAmount((U256_MAX + 1n).toString())).toEqual({ ok: false, reason: "exceeds_u256" });
  });
});
