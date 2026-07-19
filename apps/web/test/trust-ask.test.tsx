import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import AskPage from "../src/trust/AskPage";

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    assessSubject: vi.fn(),
    getReportHealth: vi.fn().mockResolvedValue(null),
    resolveToken: vi.fn()
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
  settlementExplorerUrl: `https://testnet.cspr.live/transaction/${"d".repeat(64)}`,
  explorerUrl: `https://testnet.cspr.live/transaction/${"d".repeat(64)}`
};

describe("Trust ASK page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("explains the hosted token check in plain language", () => {
    render(<AskPage />);

    expect(screen.getByText(/checks live Casper data, covers a small Testnet service fee/i)).toBeTruthy();
    const vocabulary = screen.getByLabelText("Verdict vocabulary");
    expect(vocabulary.textContent).toContain(
      "Charge decisions: PAY / REVIEW / BLOCK tell you whether this exact x402 charge may be signed."
    );
    expect(vocabulary.textContent).toContain(
      "Evidence verdicts: CLEAR / CAUTION / DANGER tell you what the paid Casper evidence says about this subject."
    );
    expect(document.body.textContent).not.toContain("paid rail");
    expect(document.body.textContent).not.toContain("Merkle");
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
    expect(screen.getByText(/Unavailable facts are never treated as passes\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: /receipt on casper/i }).getAttribute("href")).toBe(
      dangerVerdict.explorerUrl
    );
    expect(screen.getByText("Based on automated checks of Casper data. This is not financial advice.")).toBeTruthy();
  });

  it("does not call assessSubject when input is empty", async () => {
    const { assessSubject } = await import("../src/api");

    render(<AskPage />);

    const askButton = screen.getByRole("button", { name: /check this token/i });
    fireEvent.click(askButton);

    expect(vi.mocked(assessSubject)).not.toHaveBeenCalled();
  });

  it("does not expose server configuration names in a consumer error", async () => {
    const { assessSubject } = await import("../src/api");
    vi.mocked(assessSubject).mockRejectedValueOnce(
      new Error("CASPER_SECRET_KEY_PATH is required for assess_subject")
    );

    render(<AskPage />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "b".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: /check this token/i }));

    await waitFor(() => {
      expect(screen.getByText(/isn't set up to run live checks/i)).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain("CASPER_SECRET_KEY_PATH");
  });

  it("warns before a paid check when holder and age data are not connected", async () => {
    const { getReportHealth } = await import("../src/api");
    vi.mocked(getReportHealth).mockResolvedValueOnce({
      ok: true,
      service: "report-api",
      checkedAt: "2026-07-17T12:00:00.000Z",
      tokenEvidence: {
        status: "limited",
        source: "Casper RPC",
        available: ["supplyControl"],
        unavailable: ["contractAge", "holderCount", "topHolderShare"]
      }
    });

    render(<AskPage />);

    expect(await screen.findByText(/Current coverage is limited/)).toBeTruthy();
    expect(screen.getByText(/contract age and holder data are not connected yet/)).toBeTruthy();
  });

  it("checks a pasted package hash on the network the user selected", async () => {
    const { assessSubject } = await import("../src/api");
    vi.mocked(assessSubject).mockResolvedValueOnce(dangerVerdict);

    render(<AskPage />);

    fireEvent.click(screen.getByRole("button", { name: "Testnet" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "b".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: /check this token/i }));

    await waitFor(() => expect(screen.getByText("DANGER")).toBeTruthy());
    expect(vi.mocked(assessSubject)).toHaveBeenCalledWith("b".repeat(64), "casper-testnet");
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

    fireEvent.click(screen.getByRole("button", { name: "Testnet" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wcspr" } });
    expect(screen.getByRole("button", { name: "Testnet" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /check this token/i }));

    await waitFor(() => {
      expect(screen.getByText("DANGER")).toBeTruthy();
    });
    expect(vi.mocked(resolveToken)).toHaveBeenCalledWith("wcspr");
    expect(vi.mocked(assessSubject)).toHaveBeenCalledWith(
      `hash-${"8".repeat(64)}`,
      "casper-mainnet"
    );
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
