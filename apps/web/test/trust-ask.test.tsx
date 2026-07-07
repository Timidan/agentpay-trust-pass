import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import AskPage from "../src/trust/AskPage";

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    assessSubject: vi.fn(),
    resolveToken: vi.fn()
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

    const askButton = screen.getByRole("button", { name: /check this token/i });
    fireEvent.click(askButton);

    await waitFor(() => {
      expect(screen.getByText("DANGER")).toBeTruthy();
    });

    expect(screen.getByText("Mint authority is not renounced, so supply is unlimited")).toBeTruthy();
    expect(screen.getByRole("link", { name: /proven on casper/i }).getAttribute("href")).toBe(
      dangerVerdict.explorerUrl
    );
    expect(screen.getByText("automated evidence flags, not financial advice")).toBeTruthy();
  });

  it("does not call assessSubject when input is empty", async () => {
    const { assessSubject } = await import("../src/api");

    render(<AskPage />);

    const askButton = screen.getByRole("button", { name: /check this token/i });
    fireEvent.click(askButton);

    expect(vi.mocked(assessSubject)).not.toHaveBeenCalled();
  });

  it("resolves a symbol through cspr.trade before assessing", async () => {
    const { assessSubject, resolveToken } = await import("../src/api");
    vi.mocked(resolveToken).mockResolvedValueOnce({
      symbol: "WCSPR",
      packageHash: `hash-${"8".repeat(64)}`,
      name: "Wrapped CSPR",
      network: "casper-mainnet"
    });
    vi.mocked(assessSubject).mockResolvedValueOnce(dangerVerdict);

    render(<AskPage />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wcspr" } });
    fireEvent.click(screen.getByRole("button", { name: /check this token/i }));

    await waitFor(() => {
      expect(screen.getByText("DANGER")).toBeTruthy();
    });
    expect(vi.mocked(resolveToken)).toHaveBeenCalledWith("wcspr");
    expect(vi.mocked(assessSubject)).toHaveBeenCalledWith(`hash-${"8".repeat(64)}`);
    // The resolved identity is shown with the verdict.
    expect(screen.getByText(/WCSPR · Wrapped CSPR/)).toBeTruthy();
  });

  it("explains when a symbol is not listed on cspr.trade", async () => {
    const { assessSubject, resolveToken } = await import("../src/api");
    vi.mocked(resolveToken).mockResolvedValueOnce(null);

    render(<AskPage />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "NOPE" } });
    fireEvent.click(screen.getByRole("button", { name: /check this token/i }));

    await waitFor(() => {
      expect(screen.getByText(/isn't listed on CSPR.trade yet/)).toBeTruthy();
    });
    expect(vi.mocked(assessSubject)).not.toHaveBeenCalled();
  });

  it("rejects input that is neither a symbol nor a package hash", async () => {
    const { assessSubject, resolveToken } = await import("../src/api");

    render(<AskPage />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not a token!!" } });
    fireEvent.click(screen.getByRole("button", { name: /check this token/i }));

    expect(screen.getByText(/token symbol \(like WCSPR\) or a 64-character package hash/)).toBeTruthy();
    expect(vi.mocked(resolveToken)).not.toHaveBeenCalled();
    expect(vi.mocked(assessSubject)).not.toHaveBeenCalled();
  });
});
