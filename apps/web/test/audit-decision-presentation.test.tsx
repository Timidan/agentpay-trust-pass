import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionPanel } from "../src/audit/sections/DecisionPanel";
import { ChargeTerms } from "../src/audit/sections/ChargeTerms";
import { OperatorAction } from "../src/audit/sections/OperatorAction";
import { PolicyAction } from "../src/audit/sections/PolicyAction";
import { SigningHandoff } from "../src/audit/sections/SigningHandoff";
import type { AuditFlow } from "../src/audit/useAuditFlow";
import { DecisionCard } from "../src/audit/variants/modern/DecisionCard";

const reason = {
  code: "provider_unapproved",
  result: "review" as const,
  message: "Provider has not been approved by the operator",
  field: "provider",
  expected: "active pin",
  received: null
};

function reviewFlow(): AuditFlow {
  const recheck = vi.fn();
  return {
    decision: "review",
    idempotencyKey: "check-request-1",
    probe: { data: { terms: {} } },
    check: {
      status: "success",
      error: null,
      data: {
        check: {
          id: "check-1",
          request: {
            origin: "https://svc.example",
            path: "/pay"
          },
          terms: {
            payTo: `00${"8".repeat(64)}`,
            asset: "9".repeat(64),
            amount: "10000",
            network: "casper:casper-test",
            maxTimeoutSeconds: 300,
            extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "X402" },
            resource: { url: "https://svc.example/pay" },
            requirementHash: "c".repeat(64)
          },
          decision: {
            verdict: "review",
            basis: null,
            reasons: [reason],
            advisories: [],
            policyHash: null,
            authorizationDigest: null,
            reservation: null
          }
        }
      }
    },
    runCheck: vi.fn(),
    recheck
  } as unknown as AuditFlow;
}

afterEach(cleanup);

describe("payment decision presentation", () => {
  it("uses the visible Connect step name before a charge can be read", () => {
    const flow = {
      tokenPresent: false,
      probe: { status: "idle", data: null, error: null },
      liveService: { status: "idle", data: null, error: null },
      probeInput: { url: "", method: "GET" },
      authorizationText: "",
      loadAgentPayService: vi.fn(),
      runProbe: vi.fn(),
      setProbeInput: vi.fn(),
      setAuthorizationText: vi.fn()
    } as unknown as AuditFlow;

    render(<ChargeTerms flow={flow} />);

    expect(screen.getByText("charge not read")).toBeTruthy();
    expect(screen.getByText(/Connect Casper Wallet or enter an AgentPay token/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Authenticate step");
  });

  it("shows plain-language reasons in the decision hero without raw reason codes", () => {
    render(<DecisionCard flow={reviewFlow()} />);

    expect(screen.getByText(reason.message)).toBeTruthy();
    expect(screen.queryByText(/provider_unapproved/i)).toBeNull();
    expect(screen.getByText(/Pause here\. Approve the provider/i)).toBeTruthy();
  });

  it("keeps request IDs and raw decision fields in a closed technical disclosure", () => {
    const flow = reviewFlow();
    render(<DecisionPanel flow={flow} />);

    fireEvent.click(screen.getByRole("button", { name: "Run check again" }));
    expect(flow.recheck).toHaveBeenCalledOnce();
    expect(flow.runCheck).not.toHaveBeenCalled();
    const disclosure = screen.getByText("View technical details").closest("details");
    expect(disclosure).toBeTruthy();
    expect(disclosure?.open).toBe(false);
  });

  it("lets a connected wallet approve the exact checked provider without a CLI handoff", () => {
    const saveProviderRule = vi.fn();
    const flow = {
      ...reviewFlow(),
      tokenPresent: true,
      walletSession: {
        status: "success",
        data: { publicKey: `01${"a".repeat(64)}`, expiresAt: "2026-07-18T00:00:00.000Z" },
        error: null
      },
      providerAction: { status: "idle", data: null, error: null },
      providerDecisions: { status: "idle", data: null, error: null },
      saveProviderRule,
      loadProviderDecisions: vi.fn(),
      recheck: vi.fn()
    } as unknown as AuditFlow;

    render(<OperatorAction flow={flow} />);
    expect(screen.getByRole("button", { name: "Approve this provider" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Block this provider" })).toBeTruthy();
    expect(screen.queryByText(/operator-key\.pem/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve this provider" }));
    expect(saveProviderRule).toHaveBeenCalledWith("pin", 30);
  });

  it("keeps the signed CLI command available for token sessions", () => {
    const flow = {
      ...reviewFlow(),
      tokenPresent: true,
      walletSession: { status: "idle", data: null, error: null },
      providerAction: { status: "idle", data: null, error: null },
      providerDecisions: { status: "idle", data: null, error: null },
      saveProviderRule: vi.fn(),
      loadProviderDecisions: vi.fn(),
      recheck: vi.fn()
    } as unknown as AuditFlow;

    render(<OperatorAction flow={flow} />);
    expect(screen.getByText("Use the AgentPay CLI")).toBeTruthy();
    expect(screen.getByText(/operator-key\.pem/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve this provider" })).toBeNull();
  });

  it("lets a wallet user set an exact human-readable daily token limit", () => {
    const saveAssetPolicy = vi.fn();
    const flow = {
      ...reviewFlow(),
      walletSession: {
        status: "success",
        data: { publicKey: `01${"a".repeat(64)}`, expiresAt: "2026-07-18T00:00:00.000Z" },
        error: null
      },
      policy: { status: "idle", data: null, error: null },
      policyAction: { status: "idle", data: null, error: null },
      saveAssetPolicy,
      loadPolicy: vi.fn(),
      recheck: vi.fn()
    } as unknown as AuditFlow;

    render(<PolicyAction flow={flow} />);
    const limit = screen.getByRole("textbox", { name: "Daily limit in X402" });
    expect(limit.getAttribute("value")).toBe("0.00001");
    fireEvent.change(limit, { target: { value: "0.00005" } });
    fireEvent.click(screen.getByRole("button", { name: "Save daily limit" }));

    expect(saveAssetPolicy).toHaveBeenCalledWith("50000");
    expect(screen.getByText(/current charge is 0\.00001 X402/i)).toBeTruthy();
  });

  it("prepares exact payment details without implying that a payment was signed", () => {
    const preparePaymentDetails = vi.fn();
    const base = reviewFlow();
    const flow = {
      ...base,
      tokenPresent: true,
      walletSession: {
        status: "success",
        data: { publicKey: `01${"a".repeat(64)}`, expiresAt: "2026-07-18T00:00:00.000Z" },
        error: null
      },
      probe: {
        status: "success",
        error: null,
        data: {
          request: { method: "POST", url: "https://svc.example/pay", requestHash: "a".repeat(64) },
          terms: base.check.data?.check.terms,
          advisories: []
        }
      },
      liveService: { status: "idle", data: null, error: null },
      probeInput: { url: "https://svc.example/pay", method: "POST" },
      authorizationText: "",
      authorization: { status: "idle", data: null, error: null },
      preparePaymentDetails,
      loadAgentPayService: vi.fn(),
      runProbe: vi.fn(),
      setProbeInput: vi.fn(),
      setAuthorizationText: vi.fn()
    } as unknown as AuditFlow;

    render(<ChargeTerms flow={flow} />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare payment details" }));

    expect(preparePaymentDetails).toHaveBeenCalledOnce();
    expect(screen.getByText(/does not sign or send the payment/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("locally-signed authorization");
  });

  it("lets a PAY decision continue in Casper Wallet while keeping CLI as a fallback", () => {
    const payWithWallet = vi.fn();
    const flow = {
      ...reviewFlow(),
      decision: "pay",
      probe: {
        status: "success",
        error: null,
        data: {
          request: { method: "POST", url: "https://svc.example/pay" },
          paymentRequired: { x402Version: 2, accepts: [{}], resource: { url: "https://svc.example/pay" } },
          terms: reviewFlow().check.data?.check.terms,
          advisories: [],
          redirects: []
        }
      },
      walletPayment: { status: "idle", data: null, error: null },
      settlement: { status: "idle", data: null, error: null },
      payWithWallet,
      verifySettlement: vi.fn()
    } as unknown as AuditFlow;

    render(<SigningHandoff flow={flow} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay with Casper Wallet" }));

    expect(payWithWallet).toHaveBeenCalledOnce();
    expect(screen.getByText("Use the AgentPay CLI")).toBeTruthy();
    expect(screen.getByText(/agentpay call/)).toBeTruthy();
  });
});
