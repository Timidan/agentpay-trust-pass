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
    // Routes live in the real history now — reset it between tests.
    window.history.pushState({}, "", "/");
  });

  it("opens ungated and observes the live agent bridge", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).endsWith("/health")) return jsonResponse({ ok: true, service: "mcp-server" });
      if (String(url).endsWith("/activity")) {
        return jsonResponse({
          entries: [
            { tool: "quote_report", status: 200, ms: 1240, at: "2026-07-02T12:00:00.000Z" },
            { tool: "buy_report", status: 402, ms: 88, at: "2026-07-02T12:00:05.000Z" }
          ]
        });
      }
      if (String(url).endsWith("/feed")) return jsonResponse({ entries: [] });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);

    expect(screen.queryByRole("button", { name: /run it live/i })).toBeNull();
    expect(screen.getByText("One rail, four stops, always in order.")).toBeTruthy();

    await launchAgentPay();

    // No simulated in-browser connection: agents connect over MCP/HTTP and
    // the console observes that real traffic.
    expect(screen.queryByRole("heading", { name: "Connect agent" })).toBeNull();
    expect(screen.queryByText(/local session only/i)).toBeNull();
    expect(screen.getByRole("heading", { name: /agents connect over mcp or http/i })).toBeTruthy();
    // The run button is gated: disabled until a subject is entered, then enabled.
    const runButton = screen.getByRole("button", { name: /run it live/i });
    expect(runButton.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText(/token package hash or casper account/i), "a".repeat(64));
    expect(runButton.hasAttribute("disabled")).toBe(false);

    await waitFor(() => {
      expect(screen.getByText("bridge live")).toBeTruthy();
    });
    expect(screen.getByText("quote_report")).toBeTruthy();
    expect(screen.getByText("402")).toBeTruthy();
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
      if (isBridgePanelUrl(url)) return bridgePanelResponse(url);
      if (String(url).endsWith("/feed")) return jsonResponse({ entries: [] });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    // Hero manifesto: the three verdict words are the headline.
    expect(screen.getByText("CLEAR")).toBeTruthy();
    expect(screen.getByText("DANGER")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /open the console/i }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("AgentPay settlement animation")).toBeNull();

    await launchAgentPay();
    await runLive();

    await waitFor(() => {
      expect(screen.getByText(/paused at the x402 wall/i)).toBeTruthy();
    });

    expect(screen.getByText("Casper Node RPC")).toBeTruthy();
    expect(screen.getByText("CSPR.trade MCP")).toBeTruthy();
    expect(screen.getByText("WCSPR/sCSPR")).toBeTruthy();
    // Raw config codes map to consumer copy via friendly-errors.
    expect(screen.getByText(/registry contract isn't configured/)).toBeTruthy();
    // Count only the console's tool calls; the shell also polls /feed + bridge endpoints.
    expect(fetchSpy.mock.calls.filter(([u]) => isConsoleToolCall(u)).length).toBe(3);
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
      if (isBridgePanelUrl(url)) return bridgePanelResponse(url);
      if (String(url).endsWith("/feed")) return jsonResponse({ entries: [] });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);

    await launchAgentPay();
    await runLive();
    await waitFor(() => {
      expect(screen.getByText(/paused at the x402 wall/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/x402 payment payload/i), {
      target: { value: JSON.stringify({ scheme: "x402", proof: "runtime-payload" }) }
    });
    await userEvent.click(screen.getByRole("button", { name: /continue settlement/i }));

    await waitFor(() => {
      // The registry receipt shows the tx hash middle-truncated beside a copy control.
      expect(screen.getByText("4444444444…44444444")).toBeTruthy();
    });
    expect(screen.getByText("2".repeat(64))).toBeTruthy();
    expect(screen.getByText("info get transaction")).toBeTruthy();
    // Count only the console's tool calls; the shell also polls /feed + bridge endpoints.
    expect(fetchSpy.mock.calls.filter(([u]) => isConsoleToolCall(u)).length).toBe(6);
  });

  it("follows one theme across landing and console, with toggles in both", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const { container } = render(<App />);
    expect(container.querySelector(".agent-pay-app")?.getAttribute("data-theme")).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(container.querySelector(".agent-pay-app")?.getAttribute("data-theme")).toBe("dark");

    // The console inherits the same theme state and offers the same toggle.
    await launchAgentPay();
    expect(container.querySelector(".agent-pay-app")?.getAttribute("data-theme")).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: /switch to light mode/i }));
    expect(container.querySelector(".agent-pay-app")?.getAttribute("data-theme")).toBe("light");
  });
});

async function launchAgentPay() {
  await userEvent.click(screen.getAllByRole("button", { name: /open the console/i })[0]);
}

// The console's "Run it live" button is gated on a non-empty subject. Type a
// well-formed package hash (skips symbol resolution) before running the rail.
async function runLive(subject = "a".repeat(64)) {
  await userEvent.type(screen.getByLabelText(/token package hash or casper account/i), subject);
  await userEvent.click(screen.getByRole("button", { name: /run it live/i }));
}

function isBridgePanelUrl(url: string) {
  return /\/(health|activity)$/.test(String(url));
}

function bridgePanelResponse(url: string) {
  return String(url).endsWith("/health")
    ? jsonResponse({ ok: true, service: "mcp-server" })
    : jsonResponse({ entries: [] });
}

function isConsoleToolCall(url: unknown) {
  return !/\/(feed|health|activity)$/.test(String(url));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
