import { describe, expect, it } from "vitest";
import {
  formatAtomicAmount,
  parseDisplayAmount
} from "../src/audit/paymentAmounts";

describe("payment amount display", () => {
  it("renders smallest units as the human token amount", () => {
    expect(formatAtomicAmount("10000", "9")).toBe("0.00001");
    expect(formatAtomicAmount("1234500000", "9")).toBe("1.2345");
    expect(formatAtomicAmount("42", "0")).toBe("42");
  });

  it("converts a human token amount back to exact smallest units", () => {
    expect(parseDisplayAmount("0.00005", "9")).toBe("50000");
    expect(parseDisplayAmount("1.2345", "9")).toBe("1234500000");
    expect(parseDisplayAmount("42", "0")).toBe("42");
  });

  it("rejects rounded, exponential, negative, and empty values", () => {
    expect(() => parseDisplayAmount("0.0000000001", "9")).toThrow(/decimal places/i);
    expect(() => parseDisplayAmount("1e3", "9")).toThrow(/plain positive number/i);
    expect(() => parseDisplayAmount("-1", "9")).toThrow(/plain positive number/i);
    expect(() => parseDisplayAmount("", "9")).toThrow(/plain positive number/i);
  });
});
