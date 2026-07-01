import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { PaidReport, Quote } from "../src/api";

const quote: Quote = {
  quoteId: "agent-pay-live-1000-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb",
  reportId: "cspr-trade-pairs-1111111111111111",
  reportHash: "b".repeat(64),
  datasetId: "agent-pay-live-1000-aaaaaaaaaaaaaaaa",
  datasetRoot: "a".repeat(64),
  amount: "10000",
  asset: "CSPR",
  network: "casper:casper-test",
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  expiresInSeconds: 300,
  paymentResource: {
    url: "http://127.0.0.1:4021/reports/buy/agent-pay-live-1000-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb",
    description: "AgentPay live evidence report cspr-trade-pairs-1111111111111111",
    mimeType: "application/json"
  },
  paymentRequirements: [
    {
      scheme: "exact",
      network: "casper:casper-test",
      asset: "9".repeat(64),
      amount: "10000",
      payTo: `00${"8".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: {
        name: "Cep18x402",
        version: "1",
        symbol: "CSPR"
      }
    }
  ],
  paymentConfigurationRequired: false,
  paymentConfigurationReason: null,
  paymentReadiness: {
    status: "ready",
    reason: null,
    checkedAt: new Date(0).toISOString(),
    facilitatorUrl: "http://127.0.0.1:4021",
    checks: [
      {
        name: "payment_requirement",
        status: "pass",
        message: "10000 CSPR on casper:casper-test"
      },
      {
        name: "facilitator_supported",
        status: "pass",
        message: "facilitator supports exact payments for casper:casper-test"
      }
    ],
    supportedKind: {
      x402Version: 2,
      scheme: "exact",
      network: "casper:casper-test",
      feePayer: "7".repeat(64)
    }
  },
  sourceSummary: [
    {
      product: "Casper Node RPC",
      network: "casper-testnet",
      subject: "latest_finalized_block",
      observedAt: new Date(0).toISOString(),
      recordHash: "c".repeat(64),
      facts: {
        height: 1000,
        transactionCount: 2
      }
    },
    {
      product: "CSPR.trade MCP",
      network: "casper-mainnet",
      subject: "dex_pair_surface",
      observedAt: new Date(1000).toISOString(),
      recordHash: "d".repeat(64),
      facts: {
        pairCount: 6,
        firstPairTokens: "WCSPR/sCSPR"
      }
    }
  ]
};

const paid: PaidReport = {
  datasetId: quote.datasetId,
  datasetRoot: quote.datasetRoot,
  reportId: quote.reportId,
  report: {
    id: quote.reportId,
    product: "CSPR.trade MCP",
    network: "casper-mainnet",
    subject: "dex_pair_surface",
    observedAt: new Date(1000).toISOString(),
    sourceUrl: "https://mcp.cspr.trade/mcp",
    facts: {
      pairCount: 6,
      firstPairTokens: "WCSPR/sCSPR"
    },
    rawHash: "e".repeat(64)
  },
  reportHash: quote.reportHash,
  proof: [{ position: "left", hash: "f".repeat(64) }],
  paymentReceiptHash: "1".repeat(64),
  payment: {
    scheme: "x402",
    status: "settled",
    transactionHash: "2".repeat(64),
    confirmation: {
      rpcUrl: "https://node.testnet.casper.network/rpc",
      method: "info_get_transaction",
      apiVersion: "2.0.0",
      executionState: "executed",
      blockHash: "6".repeat(64),
      attempts: 1,
      observedAt: "2026-06-10T12:00:00.000Z"
    },
    facilitatorHash: "3".repeat(64)
  }
};

const registryStatus = {
  status: "configuration_required",
  reason: "agent_pay_registry_package_hash_required",
  checkedAt: new Date(0).toISOString(),
  checks: [
    {
      name: "registry_package",
      status: "missing",
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH is required"
    }
  ],
  registryPackageHash: null,
  recordScript: "/workspace/contracts/agent-pay-registry/scripts/record-decision-testnet.sh",
  rpc: null
};

describe("AgentPay console", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts locked until a local agent identifier is connected", async () => {
    vi.stubGlobal("fetch", vi.fn());

    render(<App />);

    expect(screen.queryByRole("heading", { name: "Connect agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: /quote live evidence/i })).toBeNull();
    expect(screen.getByText("One rail, four stops, always in order.")).toBeTruthy();

    await launchAgentPay();

    expect(screen.getByRole("heading", { name: "Connect agent" })).toBeTruthy();
    expect(screen.getAllByText("Local session only. Backend auth is not configured.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /quote live evidence/i }).hasAttribute("disabled")).toBe(true);

    await userEvent.type(screen.getByLabelText(/agent identifier/i), "desk-agent-alpha");
    await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));

    expect(screen.getByText("desk-agent-alpha")).toBeTruthy();
    expect(screen.getByRole("button", { name: /quote live evidence/i }).hasAttribute("disabled")).toBe(false);
  });

  it("rejects empty, oversized, and secret-looking agent identifiers", async () => {
    vi.stubGlobal("fetch", vi.fn());

    render(<App />);
    await launchAgentPay();

    await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));
    expect(screen.getByText("Enter a non-secret agent identifier.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /quote live evidence/i }).hasAttribute("disabled")).toBe(true);

    const input = screen.getByLabelText(/agent identifier/i);
    await userEvent.clear(input);
    await userEvent.type(input, "a".repeat(65));
    await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));
    expect(screen.getByText("Agent identifier must be 64 characters or less.")).toBeTruthy();

    fireEvent.change(input, {
      target: { value: '{"x402Version":2}' }
    });
    await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));
    expect(screen.getByText("Use the x402 payment payload field for payment data, not the agent identifier.")).toBeTruthy();
  });

  it("quotes live source evidence and stops at the x402 payment gate", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/quote_report")) return jsonResponse(quote);
      if (url.endsWith("/registry_status")) return jsonResponse(registryStatus);
      if (url.endsWith("/buy_report")) {
        return jsonResponse(
          {
            error: "payment_required",
            reason: "PAYMENT-SIGNATURE header is required",
            quote,
            accepts: quote.paymentRequirements
          },
          402
        );
      }
      if (String(url).endsWith("/feed")) return jsonResponse({ entries: [] });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    expect(screen.getByText("Only proven evidence clears onto Casper.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /launch agentpay/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Connect agent" })).toBeNull();
    expect(screen.queryByLabelText("AgentPay settlement animation")).toBeNull();

    await launchAgentPay();
    await connectAgent();
    await userEvent.click(screen.getByRole("button", { name: /quote live evidence/i }));

    await waitFor(() => {
      expect(screen.getAllByText("requires x402").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("Casper Node RPC")).toBeTruthy();
    expect(screen.getByText("CSPR.trade MCP")).toBeTruthy();
    expect(screen.getByText("WCSPR/sCSPR")).toBeTruthy();
    expect(screen.getByText("agent pay registry package hash required")).toBeTruthy();
    // Count only the console's tool calls; the hero also loads /feed (recent checks).
    expect(fetchSpy.mock.calls.filter(([u]) => !String(u).endsWith("/feed")).length).toBe(3);
  });

  it("continues a gated quote with a runtime x402 payment payload", async () => {
    let buyAttempts = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/quote_report")) return jsonResponse(quote);
      if (url.endsWith("/registry_status")) return jsonResponse({
        ...registryStatus,
        status: "ready",
        reason: null,
        checks: [
          {
            name: "registry_package",
            status: "pass",
            message: "registry package configured"
          }
        ],
        registryPackageHash: `hash-${"a".repeat(64)}`,
        rpc: {
          url: "https://node.testnet.casper.network/rpc",
          apiVersion: "2.0.0",
          chainspecName: "casper-test",
          latestBlockHeight: 8135000,
          latestBlockHash: "6".repeat(64)
        }
      });
      if (url.endsWith("/buy_report")) {
        buyAttempts += 1;
        if (buyAttempts === 1) {
          return jsonResponse(
            {
              error: "payment_required",
              reason: "PAYMENT-SIGNATURE header is required",
              quote,
              accepts: quote.paymentRequirements
            },
            402
          );
        }
        expect(JSON.parse(String(init?.body))).toMatchObject({
          quoteId: quote.quoteId,
          paymentPayload: { scheme: "x402", proof: "runtime-payload" }
        });
        return jsonResponse(paid);
      }
      if (url.endsWith("/verify_report")) return jsonResponse({ verified: true });
      if (url.endsWith("/record_decision")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          datasetId: paid.datasetId,
          datasetRoot: paid.datasetRoot,
          reportHash: paid.reportHash,
          paymentReceiptHash: paid.paymentReceiptHash,
          decision: "needs_review"
        });
        return jsonResponse({
          mode: "submitted",
          txHash: "4".repeat(64),
          hashKind: "transaction",
          confirmation: {
            rpcUrl: "https://node.testnet.casper.network/rpc",
            method: "info_get_transaction",
            apiVersion: "2.0.0",
            executionState: "executed",
            blockHash: "5".repeat(64),
            attempts: 1,
            observedAt: "2026-06-10T12:00:00.000Z"
          },
          input: {
            datasetId: paid.datasetId,
            datasetRoot: paid.datasetRoot,
            reportHash: paid.reportHash,
            paymentReceiptHash: paid.paymentReceiptHash,
            decision: "needs_review"
          }
        });
      }
      if (String(url).endsWith("/feed")) return jsonResponse({ entries: [] });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);

    await launchAgentPay();
    await connectAgent();
    await userEvent.click(screen.getByRole("button", { name: /quote live evidence/i }));
    await waitFor(() => {
      expect(screen.getAllByText("requires x402").length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByLabelText(/x402 payment payload/i), {
      target: { value: JSON.stringify({ scheme: "x402", proof: "runtime-payload" }) }
    });
    await userEvent.click(screen.getByRole("button", { name: /continue settlement/i }));

    await waitFor(() => {
      expect(screen.getByText("4".repeat(64))).toBeTruthy();
    });
    expect(screen.getByText("2".repeat(64))).toBeTruthy();
    expect(screen.getByText("info get transaction")).toBeTruthy();
    // Count only the console's tool calls; the hero also loads /feed (recent checks).
    expect(fetchSpy.mock.calls.filter(([u]) => !String(u).endsWith("/feed")).length).toBe(6);
  });

  it("locks settlement actions after disconnect and clears the payment payload text", async () => {
    let buyAttempts = 0;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/quote_report")) return jsonResponse(quote);
      if (url.endsWith("/registry_status")) return jsonResponse(registryStatus);
      if (url.endsWith("/buy_report")) {
        buyAttempts += 1;
        return jsonResponse(
          {
            error: "payment_required",
            reason: "PAYMENT-SIGNATURE header is required",
            quote,
            accepts: quote.paymentRequirements
          },
          402
        );
      }
      if (String(url).endsWith("/feed")) return jsonResponse({ entries: [] });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);

    await launchAgentPay();
    await connectAgent("desk-agent-alpha");
    await userEvent.click(screen.getByRole("button", { name: /quote live evidence/i }));
    await waitFor(() => {
      expect(screen.getAllByText("requires x402").length).toBeGreaterThan(0);
    });

    const payloadField = screen.getByLabelText(/x402 payment payload/i);
    fireEvent.change(payloadField, {
      target: { value: JSON.stringify({ scheme: "x402", proof: "runtime-payload" }) }
    });

    await userEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));

    expect(screen.getByRole("button", { name: /quote live evidence/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /continue settlement/i }).hasAttribute("disabled")).toBe(true);
    expect((screen.getByLabelText(/x402 payment payload/i) as HTMLTextAreaElement).value).toBe("");
    expect(buyAttempts).toBe(1);
  });

  it("clears prior flow state when a different agent connects", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/quote_report")) return jsonResponse(quote);
      if (url.endsWith("/registry_status")) return jsonResponse(registryStatus);
      if (url.endsWith("/buy_report")) {
        return jsonResponse(
          {
            error: "payment_required",
            reason: "PAYMENT-SIGNATURE header is required",
            quote,
            accepts: quote.paymentRequirements
          },
          402
        );
      }
      if (String(url).endsWith("/feed")) return jsonResponse({ entries: [] });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);

    await launchAgentPay();
    await connectAgent("desk-agent-alpha");
    await userEvent.click(screen.getByRole("button", { name: /quote live evidence/i }));
    await waitFor(() => {
      expect(screen.getAllByText("requires x402").length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    await connectAgent("desk-agent-beta");

    expect(screen.queryByText("Casper Node RPC")).toBeNull();
    expect(screen.queryByText("requires x402")).toBeNull();
    expect(screen.getByText("desk-agent-beta")).toBeTruthy();
  });

  it("switches AgentPay between light and dark modes", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const { container } = render(<App />);
    expect(container.querySelector(".agent-pay-app")?.getAttribute("data-theme")).toBe("light");

    // Theme toggle lives in the console header; open the console first.
    await launchAgentPay();

    await userEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));

    expect(container.querySelector(".agent-pay-app")?.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeTruthy();
  });
});

async function launchAgentPay() {
  await userEvent.click(screen.getAllByRole("button", { name: /launch agentpay/i })[0]);
}

async function connectAgent(label = "desk-agent-alpha") {
  await userEvent.type(screen.getByLabelText(/agent identifier/i), label);
  await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
