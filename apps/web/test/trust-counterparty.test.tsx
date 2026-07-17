import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import CounterpartyPage from "../src/trust/CounterpartyPage";

const ACCOUNT_HASH = `account-hash-${"7".repeat(64)}`;

const clearVerdict: Verdict = {
  aspect: "CLEAR",
  decision: "approved",
  flags: [],
  notChecked: [],
  passed: ["Account exists on-chain.", "Account is funded.", "Key control looks sane."],
  rationale: "All checked signals are clear. No issues detected.",
  notCheckedNote: "",
  subject: {
    kind: "casper_account",
    packageHash: "7".repeat(64),
    raw: ACCOUNT_HASH
  },
  evidenceNetwork: "casper-mainnet",
  payment: {
    amount: "10000",
    amountDisplay: "0.00001",
    asset: "9".repeat(64),
    assetSymbol: "X402",
    assetDecimals: 9,
    network: "casper:casper-test"
  },
  paymentReceiptHash: "a".repeat(64),
  settlementTxHash: "b".repeat(64),
  decisionTxHash: "c".repeat(64),
  datasetRoot: "d".repeat(64),
  policyHash: "e".repeat(64),
  settlementExplorerUrl: `https://testnet.cspr.live/transaction/${"b".repeat(64)}`,
  explorerUrl: `https://testnet.cspr.live/deploy/${"c".repeat(64)}`
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Counterparty check", () => {
  it("explains the hosted account check without backend jargon", () => {
    render(<CounterpartyPage />);

    expect(screen.getByText(/reads the account directly from Casper, covers the Testnet service fee/i)).toBeTruthy();
    expect(screen.getAllByText("Wallet check").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Counterparty");
    expect(document.body.textContent).not.toContain("paid rail");
    expect(document.body.textContent).not.toContain("Merkle");
  });

  it("submits the account to assess_account and renders the returned verdict", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(clearVerdict), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(<CounterpartyPage />);
    fireEvent.change(screen.getByLabelText("CSPR.name, account hash, or public key"), {
      target: { value: ACCOUNT_HASH }
    });
    fireEvent.click(screen.getByRole("button", { name: "Check this account" }));

    await waitFor(() => expect(screen.getByText("CLEAR")).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/bridge/tools/assess_account");
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      account: ACCOUNT_HASH,
      evidenceNetwork: "casper-mainnet"
    });
    expect(screen.getByText("Account exists on-chain.")).toBeTruthy();
    expect(screen.getByText("Account is funded.")).toBeTruthy();
    expect(screen.getByText("Key control looks sane.")).toBeTruthy();
  });

  it("lets the user check a Testnet account explicitly", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...clearVerdict, evidenceNetwork: "casper-testnet" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(<CounterpartyPage />);
    fireEvent.click(screen.getByRole("button", { name: "Testnet" }));
    fireEvent.change(screen.getByLabelText("CSPR.name, account hash, or public key"), {
      target: { value: ACCOUNT_HASH }
    });
    fireEvent.click(screen.getByRole("button", { name: "Check this account" }));

    await waitFor(() => expect(screen.getByText("CLEAR")).toBeTruthy());
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      account: ACCOUNT_HASH,
      evidenceNetwork: "casper-testnet"
    });
  });

  it("does not expose server configuration names in a consumer error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: "configuration_required",
        message: "CASPER_SECRET_KEY_PATH is required for assess_account"
      }), {
        status: 503,
        headers: { "content-type": "application/json" }
      })
    ));

    render(<CounterpartyPage />);
    fireEvent.change(screen.getByLabelText("CSPR.name, account hash, or public key"), {
      target: { value: ACCOUNT_HASH }
    });
    fireEvent.click(screen.getByRole("button", { name: "Check this account" }));

    await waitFor(() => {
      expect(screen.getByText(/isn't set up to run live checks/i)).toBeTruthy();
    });
    expect(document.body.textContent).not.toContain("CASPER_SECRET_KEY_PATH");
  });

  it("accepts CSPR.name and shows the account that was actually checked", async () => {
    const accountHash = `account-hash-${"5".repeat(64)}`;
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ...clearVerdict,
        subject: { ...clearVerdict.subject, packageHash: "5".repeat(64), raw: accountHash },
        resolvedAccount: {
          name: "alice.cspr",
          accountHash,
          publicKey: `01${"4".repeat(64)}`,
          expiresAt: "2027-11-25T09:00:00Z",
          isPrimary: true,
          network: "casper-mainnet",
          source: "CSPR.name",
          sourceUrl: "https://api.cspr.name/resolutions/alice.cspr"
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(<CounterpartyPage />);
    fireEvent.click(screen.getByRole("button", { name: "Testnet" }));
    fireEvent.change(screen.getByLabelText("CSPR.name, account hash, or public key"), {
      target: { value: "Alice.CSPR" }
    });

    expect(screen.getByRole("button", { name: "Mainnet" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Testnet" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check this account" }));

    await waitFor(() => expect(screen.getByText("CLEAR")).toBeTruthy());
    expect(screen.getAllByText(/alice\.cspr/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/5555555555…55555555/)).toBeTruthy();
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      account: "Alice.CSPR",
      evidenceNetwork: "casper-mainnet"
    });
  });
});
