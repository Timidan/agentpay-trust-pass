import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveToken, toolTimeoutMs } from "../src/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toolTimeoutMs", () => {
  it.each(["assess_account", "assess_subject", "buy_report", "record_decision"])(
    "allows the Casper-writing %s tool to wait for confirmation",
    (tool) => {
      expect(toolTimeoutMs(tool)).toBe(180_000);
    }
  );

  it("keeps read-only calls bounded to the shorter timeout", () => {
    expect(toolTimeoutMs("payment_status")).toBe(45_000);
    expect(toolTimeoutMs("verify_report")).toBe(45_000);
  });

  it("preserves the report API's safe source-unavailable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "source_unavailable",
      message: "CSPR.trade token discovery is unavailable."
    }), {
      status: 503,
      headers: { "content-type": "application/json" }
    })));

    await expect(resolveToken("WCSPR")).rejects.toMatchObject({
      message: "CSPR.trade token discovery is unavailable.",
      status: 503
    });
  });
});
