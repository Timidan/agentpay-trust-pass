import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import AskPage from "../src/trust/AskPage";

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    assessSubject: vi.fn()
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

describe("Trust ASK page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows DANGER verdict, flag message, explorer link, and honest footer", async () => {
    const { assessSubject } = await import("../src/api");
    vi.mocked(assessSubject).mockResolvedValueOnce(dangerVerdict);

    render(<AskPage />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "b".repeat(64) } });

    const askButton = screen.getByRole("button", { name: /ask/i });
    fireEvent.click(askButton);

    await waitFor(() => {
      expect(screen.getByText("DANGER")).toBeTruthy();
    });

    expect(screen.getByText("Mint authority is not renounced — unlimited supply risk")).toBeTruthy();
    expect(screen.getByRole("link", { name: /proven on casper/i }).getAttribute("href")).toBe(
      dangerVerdict.explorerUrl
    );
    expect(screen.getByText("automated evidence flags, not financial advice")).toBeTruthy();
  });

  it("does not call assessSubject when input is empty", async () => {
    const { assessSubject } = await import("../src/api");

    render(<AskPage />);

    const askButton = screen.getByRole("button", { name: /ask/i });
    fireEvent.click(askButton);

    expect(vi.mocked(assessSubject)).not.toHaveBeenCalled();
  });
});
