import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import { buildShareLink, voteUrl } from "../src/api";
import { VerdictCard } from "../src/trust/VerdictCard";
import { buildTrustPassReceipt, serializeTrustPassReceipt } from "../src/trust/trust-pass-receipt";

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
      code: "mint_authority_open",
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
  paymentReceiptHash: "c".repeat(64),
  settlementTxHash: "d".repeat(64),
  decisionTxHash: "e".repeat(64),
  datasetRoot: "f".repeat(64),
  policyHash: "0".repeat(64),
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
          aspect: "DANGER",
          flags: expect.arrayContaining([
            expect.objectContaining({ code: "mint_authority_open" })
          ])
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

  it("renders and copies the Trust Pass receipt packet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true
    });

    render(<VerdictCard verdict={dangerVerdict} />);

    expect(screen.getByRole("region", { name: "Trust Pass receipt" })).toBeTruthy();
    expect(screen.getByText("Evidence root")).toBeTruthy();
    expect(screen.getByText("x402 receipt")).toBeTruthy();
    expect(screen.getByText("Settlement tx")).toBeTruthy();
    expect(screen.getByText("Casper record")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /copy trust pass receipt/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"product": "AgentPay Trust Pass"'));
    });
    expect(writeText.mock.calls[0][0]).toContain(dangerVerdict.datasetRoot);
    expect(writeText.mock.calls[0][0]).toContain(dangerVerdict.paymentReceiptHash);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy trust pass receipt/i }).textContent).toBe("Copied");
    });
  });
});

describe("buildShareLink deep-link helper", () => {
  it("composes the vote URL with the card image URL", () => {
    const link = buildShareLink("card-abc123");
    expect(link).toContain(voteUrl);
    expect(link).toContain("card-abc123.png");
  });

  it("includes the card image as a query parameter", () => {
    const link = buildShareLink("card-xyz");
    const url = new URL(link, "http://test");
    expect(url.searchParams.get("card")).toContain("card-xyz.png");
  });
});

describe("Trust Pass receipt builder", () => {
  it("keeps the receipt schema in one pure module", () => {
    const receipt = buildTrustPassReceipt(dangerVerdict);

    expect(receipt).toMatchObject({
      product: "AgentPay Trust Pass",
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
    expect(serializeTrustPassReceipt(receipt)).toContain('"product": "AgentPay Trust Pass"');
  });
});
