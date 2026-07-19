import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReceiptView,
  receiptDownloadName,
  serializeReceiptForDownload
} from "../src/audit/sections/ReceiptView";
import type { PaymentReceiptRecord } from "../src/audit/api";
import type { AuditFlow } from "../src/audit/useAuditFlow";

const receipt = {
  receiptId: "receipt-demo/unsafe",
  schemaVersion: "agentpay-purchase/v1",
  checkId: "check-demo",
  decision: { verdict: "pay" },
  terms: { amount: "10000", extra: { symbol: "WCSPR" } },
  settlement: { verdict: "match", transactionHash: "a".repeat(64) },
  response: { status: 200, bodyBytes: 42 },
  receiptHash: "b".repeat(64),
  createdAt: "2026-07-19T18:00:00.000Z",
  anchor: { status: "anchored", transactionHash: "c".repeat(64) }
} as unknown as PaymentReceiptRecord["receipt"];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("payment receipt export", () => {
  it("serializes the immutable receipt without a UI wrapper", () => {
    expect(JSON.parse(serializeReceiptForDownload(receipt))).toEqual(receipt);
    expect(receiptDownloadName(receipt.receiptId)).toBe(
      "agentpay-receipt-demo-unsafe.json"
    );
  });

  it("downloads JSON that the CLI can verify offline", () => {
    const createObjectURL = vi.fn(() => "blob:agentpay-receipt");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const flow = {
      receipt: {
        status: "success",
        data: { receipt, anchorState: receipt.anchor },
        error: null,
        anchorPoll: "terminal"
      },
      anchorState: receipt.anchor,
      refreshReceipt: vi.fn()
    } as unknown as AuditFlow;

    render(<ReceiptView flow={flow} />);
    fireEvent.click(screen.getByRole("button", { name: "Download receipt" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:agentpay-receipt");
  });
});
