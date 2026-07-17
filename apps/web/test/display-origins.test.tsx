import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const REPORT_API_ORIGIN = "https://report.example";
const BRIDGE_ORIGIN = "https://bridge.example/mcp";

describe("agent integration display origins", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    window.history.pushState({}, "", "/");
  });

  it("shows the published MCP package and build-time hosted endpoints", async () => {
    vi.stubEnv("VITE_REPORT_API_URL", REPORT_API_ORIGIN);
    vi.stubEnv("VITE_MCP_SERVER_URL", BRIDGE_ORIGIN);
    vi.resetModules();

    const { default: IntegratePage } = await import("../src/agents/IntegratePage");

    render(<IntegratePage onBack={() => {}} onOpenAsk={() => {}} />);

    expect(screen.getByText(`curl ${REPORT_API_ORIGIN}/skill.md`)).toBeTruthy();
    expect(screen.getByText(`POST ${BRIDGE_ORIGIN}/tools/<name>`)).toBeTruthy();

    const codeBlocks = Array.from(document.querySelectorAll("pre code"), (node) => node.textContent ?? "");
    expect(codeBlocks).toContainEqual(expect.stringContaining(`"command": "npx"`));
    expect(codeBlocks).toContainEqual(expect.stringContaining(`"args": ["--yes", "@timidan/agentpay-mcp"]`));
    expect(codeBlocks).toContainEqual(expect.stringContaining(`"name": "payment_status", "arguments": {}`));
    expect(codeBlocks).toContainEqual(expect.stringContaining(`export AGENT_PAY_MCP_URL=${BRIDGE_ORIGIN}`));
    expect(codeBlocks).toContainEqual(expect.stringContaining("Authorization: Bearer $AGENT_PAY_MCP_TOKEN"));
    expect(document.body.textContent).not.toContain("@agent-pay/mcp-server");
    expect(document.body.textContent).not.toContain("CASPER_SECRET_KEY_PATH");
    expect(document.body.textContent).not.toContain("127.0.0.1");
  }, 15_000);

  it("uses the build-time report origin in the buyer CLI command", async () => {
    vi.stubEnv("VITE_REPORT_API_URL", REPORT_API_ORIGIN);
    vi.stubEnv("VITE_MCP_SERVER_URL", BRIDGE_ORIGIN);
    vi.resetModules();

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/health")) return jsonResponse({ ok: true });
      if (url.endsWith("/activity")) return jsonResponse({ entries: [] });
      if (url.endsWith("/quote_report")) return jsonResponse(readyQuote());
      if (url.endsWith("/registry_status")) return jsonResponse(registryStatus());
      if (url.endsWith("/buy_report")) {
        return jsonResponse({ error: "payment_required", reason: "PAYMENT-SIGNATURE header is required" }, 402);
      }
      throw new Error(`Unexpected URL ${url}`);
    }));

    window.history.pushState({}, "", "/app");
    const { default: App } = await import("../src/App");
    render(<App />);

    fireEvent.change(screen.getByLabelText(/token package hash or casper account/i), {
      target: { value: "a".repeat(64) }
    });
    fireEvent.click(screen.getByRole("button", { name: /run live check/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain(`REPORT_API_URL=${REPORT_API_ORIGIN}`);
    });
    expect(document.body.textContent).not.toContain("REPORT_API_URL=http://127.0.0.1:4021");
  }, 15_000);
});

function readyQuote() {
  return {
    quoteId: "quote-1",
    reportId: "report-1",
    reportHash: "b".repeat(64),
    datasetId: "dataset-1",
    datasetRoot: "c".repeat(64),
    amount: "10000",
    asset: "CSPR",
    network: "casper:casper-test",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    expiresInSeconds: 300,
    paymentResource: {
      url: `${REPORT_API_ORIGIN}/reports/buy/report-1`,
      description: "AgentPay report",
      mimeType: "application/json"
    },
    paymentRequirements: [{
      scheme: "exact",
      network: "casper:casper-test",
      asset: "d".repeat(64),
      amount: "10000",
      maxTimeoutSeconds: 300,
      payTo: `00${"e".repeat(64)}`,
      extra: { name: "Cep18x402", version: "1", symbol: "CSPR" }
    }],
    paymentConfigurationRequired: false,
    paymentConfigurationReason: null,
    paymentReadiness: {
      status: "ready",
      reason: null,
      checkedAt: new Date(0).toISOString(),
      checks: [],
      supportedKind: null
    },
    sourceSummary: []
  };
}

function registryStatus() {
  return {
    status: "configuration_required",
    reason: "agent_pay_registry_package_hash_required",
    checkedAt: new Date(0).toISOString(),
    checks: [],
    registryPackageHash: null,
    recordScript: "record-decision-testnet.sh",
    rpc: null
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
