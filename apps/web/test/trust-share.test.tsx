import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import { buildShareLink, voteUrl } from "../src/api";
import { VerdictCard } from "../src/trust/VerdictCard";

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
      severity: "high",
      message: "Mint authority is not renounced — unlimited supply risk"
    }
  ],
  notChecked: ["liquidity_lock", "team_vesting"],
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
    expect(shareBtn.textContent).toBe("SHARE");
  });

  it("calls storeVerdictCard and shareVerdict when SHARE is clicked", async () => {
    const { storeVerdictCard, shareVerdict } = await import("../src/api");

    // Provide clipboard mock
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
