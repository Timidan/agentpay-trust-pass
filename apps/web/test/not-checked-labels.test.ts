import { describe, expect, it } from "vitest";
import { labelForNotChecked } from "../src/lib/not-checked-labels";

describe("not-checked labels", () => {
  it("names each token fact in plain language", () => {
    expect(labelForNotChecked("contractAgeBlocks")).toBe("Contract age");
    expect(labelForNotChecked("holderCount")).toBe("Number of token holders");
    expect(labelForNotChecked("topHolderPct")).toBe("Top-holder concentration");
  });

  it("humanizes an unknown camel-case signal", () => {
    expect(labelForNotChecked("futureSignal")).toBe("Future signal");
  });
});
