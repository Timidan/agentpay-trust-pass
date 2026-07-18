import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEvidenceRun } from "../../src/console/useEvidenceRun";
import { ToolCallError, type PaidReport, type Quote } from "../../src/api";

// The rail is now a module with injectable callTool/resolveToken, so the
// quote → settle → verify → record sequence and its failure branches are unit
// assertions instead of full-DOM drives.

const quote = { quoteId: "q1", datasetId: "d1", datasetRoot: "a".repeat(64), reportHash: "b".repeat(64), asset: "CSPR", amount: "10000", paymentRequirements: [{}] } as unknown as Quote;

const paid = {
  datasetId: "d1",
  datasetRoot: "a".repeat(64),
  reportHash: "b".repeat(64),
  paymentReceiptHash: "1".repeat(64),
  report: { subject: "dex_pair_surface", facts: { reserveUsd: 100, holderCount: 50 } },
  proof: [{ position: "left", hash: "f".repeat(64) }],
  evidence: []
} as unknown as PaidReport;

const receipt = { decisionTxHash: "9".repeat(64) };

function happyCallTool(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (tool: string) => {
    if (tool in overrides) {
      const value = overrides[tool];
      if (value instanceof Error) throw value;
      return value;
    }
    switch (tool) {
      case "quote_report": return quote;
      case "registry_status": return { status: "ready" };
      case "buy_report": return paid;
      case "verify_report": return { verified: true };
      case "record_decision": return receipt;
      default: return {};
    }
  }) as never;
}

afterEach(() => vi.restoreAllMocks());

describe("useEvidenceRun", () => {
  it("drives quote → settle → verify → record to complete for a hash subject", async () => {
    const callTool = happyCallTool();
    const { result } = renderHook(() => useEvidenceRun({ callTool, resolveToken: vi.fn() }));

    await act(async () => {
      await result.current.runAgentPay(`hash-${"a".repeat(64)}`);
    });

    await waitFor(() => expect(result.current.state).toBe("complete"));
    expect(result.current.quote).toEqual(quote);
    expect(result.current.receipt).toEqual(receipt);
    // resolveToken is skipped for a hash subject.
    expect(result.current.error).toBeNull();
  });

  it("throws to error when verify_report reports the evidence did not match", async () => {
    const callTool = happyCallTool({ verify_report: { verified: false } });
    const { result } = renderHook(() => useEvidenceRun({ callTool, resolveToken: vi.fn() }));

    await act(async () => {
      await result.current.runAgentPay(`hash-${"a".repeat(64)}`);
    });

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.receipt).toBeNull();
    // record_decision must never run once verification fails.
    expect((callTool as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0])).not.toContain("record_decision");
  });

  it("enters payment_required when settlement hits the 402 wall", async () => {
    const callTool = happyCallTool({ buy_report: new ToolCallError("payment required", 402, {}) });
    const { result } = renderHook(() => useEvidenceRun({ callTool, resolveToken: vi.fn() }));

    await act(async () => {
      await result.current.runAgentPay(`hash-${"a".repeat(64)}`);
    });

    await waitFor(() => expect(result.current.state).toBe("payment_required"));
  });

  it("reports a validation error for an empty subject without any tool call", async () => {
    const callTool = happyCallTool();
    const { result } = renderHook(() => useEvidenceRun({ callTool, resolveToken: vi.fn() }));

    await act(async () => {
      await result.current.runAgentPay("   ");
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toMatch(/Enter a token package hash/);
    expect(callTool).not.toHaveBeenCalled();
  });
});
