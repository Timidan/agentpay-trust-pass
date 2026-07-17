import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import { buildShareLink } from "../src/api";
import { VerdictCard } from "../src/trust/VerdictCard";
import { buildCheckReceipt, serializeCheckReceipt } from "../src/trust/check-receipt";

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    storeVerdictCard: vi.fn().mockResolvedValue({ id: "card-test-id-abc123" }),
    shareVerdict: vi.fn().mockResolvedValue({ ok: true })
  };
});

const dangerVerdict: Verdict = {
  aspect: "DANGER",
  decision: "rejected",
  flags: [
    {
      code: "cep18_mint_burn_enabled",
      severity: "danger",
      message: "Mint authority is not renounced, so supply is unlimited"
    }
  ],
  notChecked: ["liquidity_lock", "team_vesting"],
  passed: [],
  rationale: "Token failed automated checks: mint authority remains open.",
  notCheckedNote: "Liquidity lock and team vesting were not evaluated in this run.",
  subject: {
    kind: "cep18_token",
    packageHash: "a".repeat(64),
    raw: "b".repeat(64)
  },
  evidenceNetwork: "casper-testnet",
  payment: {
    amount: "10000",
    amountDisplay: "0.00001",
    asset: "9".repeat(64),
    assetSymbol: "X402",
    assetDecimals: 9,
    network: "casper:casper-test"
  },
  paymentReceiptHash: "c".repeat(64),
  settlementTxHash: "d".repeat(64),
  decisionTxHash: "e".repeat(64),
  datasetRoot: "f".repeat(64),
  policyHash: "0".repeat(64),
  publicationProof: {
    hashKind: "deploy",
    datasetId: "trust-casper-testnet-token-1",
    datasetRoot: "f".repeat(64),
    reportHash: "1".repeat(64),
    paymentReceiptHash: "c".repeat(64),
    verdictReport: { aspect: "DANGER", decision: "rejected" }
  },
  settlementExplorerUrl: `https://testnet.cspr.live/transaction/${"d".repeat(64)}`,
  explorerUrl: `https://testnet.cspr.live/transaction/${"d".repeat(64)}`
};

describe("VerdictCard SHARE button", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the SHARE button on a VerdictCard", () => {
    render(<VerdictCard verdict={dangerVerdict} />);
    const shareBtn = screen.getByRole("button", { name: /share/i });
    expect(shareBtn).toBeTruthy();
  });

  it("focuses the result without scrolling it under the sticky navigation", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    render(<VerdictCard verdict={dangerVerdict} />);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it("SHARE button is initially labelled SHARE (not sharing or shared)", () => {
    render(<VerdictCard verdict={dangerVerdict} />);
    const shareBtn = screen.getByRole("button", { name: /share/i });
    expect(shareBtn.textContent).toBe("Share");
  });

  it("calls storeVerdictCard and shareVerdict when SHARE is clicked", async () => {
    const { storeVerdictCard, shareVerdict } = await import("../src/api");

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true
    });

    render(<VerdictCard verdict={dangerVerdict} />);
    const shareBtn = screen.getByRole("button", { name: /share/i });
    fireEvent.click(shareBtn);

    await waitFor(() => {
      expect(vi.mocked(storeVerdictCard)).toHaveBeenCalledWith(
        expect.objectContaining({
          card: expect.objectContaining({
            aspect: "DANGER",
            flags: expect.arrayContaining([
              expect.objectContaining({ code: "cep18_mint_burn_enabled" })
            ])
          }),
          proof: dangerVerdict.publicationProof
        })
      );
    });

    await waitFor(() => {
      expect(vi.mocked(shareVerdict)).toHaveBeenCalledWith("card-test-id-abc123", true);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /shared/i })).toBeTruthy();
    });
  });

  it("renders and copies the AgentPay check receipt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true
    });

    render(<VerdictCard verdict={dangerVerdict} />);

    expect(screen.getByRole("region", { name: "AgentPay check proof" })).toBeTruthy();
    expect(screen.getByText("Checked data ID")).toBeTruthy();
    expect(screen.getByText("Payment proof ID")).toBeTruthy();
    expect(screen.getByText("Testnet payment")).toBeTruthy();
    expect(screen.getByText("Casper result record")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /copy agentpay check receipt/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"product": "AgentPay Check Receipt"'));
    });
    expect(writeText.mock.calls[0][0]).toContain(dangerVerdict.datasetRoot);
    expect(writeText.mock.calls[0][0]).toContain(dangerVerdict.paymentReceiptHash);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy agentpay check receipt/i }).textContent).toBe("Copied");
    });
  });
});

describe("buildShareLink deep-link helper", () => {
  it("returns the public AgentPay card image URL", () => {
    const link = buildShareLink("card-abc123");
    expect(link).toBe("http://localhost:3000/api/card/card-abc123.png");
  });

  it("encodes an unexpected card id before placing it in the path", () => {
    expect(buildShareLink("card/xyz")).toBe(
      "http://localhost:3000/api/card/card%2Fxyz.png"
    );
  });
});

describe("check receipt builder", () => {
  it("keeps the receipt schema in one pure module", () => {
    const receipt = buildCheckReceipt(dangerVerdict);

    expect(receipt).toMatchObject({
      product: "AgentPay Check Receipt",
      aspect: "DANGER",
      decision: "rejected",
      subject: {
        kind: "cep18_token",
        id: dangerVerdict.subject.raw,
        fingerprint: dangerVerdict.subject.packageHash
      },
      evidence: {
        datasetRoot: dangerVerdict.datasetRoot,
        policyHash: dangerVerdict.policyHash
      },
      payment: {
        scheme: "x402",
        receiptHash: dangerVerdict.paymentReceiptHash,
        settlementTxHash: dangerVerdict.settlementTxHash
      },
      casperRecord: {
        decisionTxHash: dangerVerdict.decisionTxHash,
        explorerUrl: dangerVerdict.explorerUrl
      }
    });
    expect(serializeCheckReceipt(receipt)).toContain('"product": "AgentPay Check Receipt"');
  });
});
