import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPayIconAction, AgentPayTooltipProvider } from "../src/components/AgentPayUi";
import App from "../src/App";

function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Landing integration", () => {
  it("renders the current landing by default and opens the console", () => {
    render(<App />);
    expect(screen.getByText("From the charge to a receipt on Casper.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /open the console/i })[0]);
    expect(screen.getByText("Evidence console")).toBeTruthy();
  });

  it("explains the pre-payment checks without showing an invented service result", () => {
    render(<App />);

    expect(screen.getByText("What AgentPay checks")).toBeTruthy();
    expect(document.body.textContent).not.toContain("service.example");
    expect(document.body.textContent).not.toMatch(/\b(?:hash-)?[a-f0-9]{64}\b/i);
  });

  it("shows current bridge, payment, and registry status from the public APIs", async () => {
    const registryPackageHash =
      "hash-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/health")) {
          return new Response(JSON.stringify({
            ok: true,
            service: "report-api",
            checkedAt: "2026-07-17T08:00:00.000Z",
            tokenEvidence: {
              status: "complete",
              source: "CSPR.live + Casper RPC",
              available: ["supplyControl", "contractAge", "holderCount", "topHolderShare"],
              unavailable: []
            }
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.endsWith("/tools/payment_status")) {
          return new Response(
            JSON.stringify({
              status: "ready",
              reason: null,
              checkedAt: "2026-07-17T08:00:00.000Z",
              checks: [],
              supportedKind: {
                x402Version: 2,
                scheme: "exact",
                network: "casper:casper-test",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.endsWith("/tools/registry_status")) {
          return new Response(
            JSON.stringify({
              status: "ready",
              reason: null,
              checkedAt: "2026-07-17T08:00:00.000Z",
              checks: [],
              registryPackageHash,
              recordScript: "scripts/record-decision.sh",
              rpc: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    render(<App />);

    expect(await screen.findByText("Agent bridge live")).toBeTruthy();
    expect(screen.getByText("x402 payments ready")).toBeTruthy();
    expect(screen.getByText("Registry ready")).toBeTruthy();
    expect(screen.getByText("Full token data ready")).toBeTruthy();
    expect(screen.getByText("hash-01234567…abcdef")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy current registry package hash" })).toBeTruthy();
  });
});

describe("AgentPayIconAction", () => {
  it("renders an icon button with the label and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <AgentPayTooltipProvider>
        <AgentPayIconAction label="Switch to dark mode" onClick={onClick}>
          <span aria-hidden="true">x</span>
        </AgentPayIconAction>
      </AgentPayTooltipProvider>
    );
    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Theme persistence", () => {
  it("initializes theme from localStorage", () => {
    window.localStorage.setItem("agentpay-theme", "dark");
    render(<App />);
    // The theme effect adds the `dark` class to <html> when theme is dark.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    window.localStorage.removeItem("agentpay-theme");
  });
});

describe("Ask/Feed entry points", () => {
  it("labels the two checks and shared results honestly and opens each route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    render(<App />);

    expect(screen.getByRole("heading", { name: "Two paid checks, and the results people share." })).toBeTruthy();
    expect(screen.getByText("CSPR.name")).toBeTruthy();
    expect(screen.getByText("CSPR.trade")).toBeTruthy();
    expect(screen.getByText("CSPR.live")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Wallet check" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Counterparty check");
    expect(screen.getAllByRole("button", { name: "Check a token" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Check a wallet" })).toBeTruthy();
    const sharedResultsButtons = screen.getAllByRole("button", { name: "See shared results" });
    expect(sharedResultsButtons.length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Check a token" })[0]);
    expect(screen.getByRole("heading", { name: "Check a token before you buy it." })).toBeTruthy();
    fireEvent.click(screen.getByText("Overview"));

    fireEvent.click(screen.getByRole("button", { name: "Check a wallet" }));
    expect(screen.getByRole("heading", { name: "Check a Casper account before you send funds." })).toBeTruthy();
    fireEvent.click(screen.getByText("Overview"));

    const currentSharedResultsButtons = screen.getAllByRole("button", { name: "See shared results" });
    fireEvent.click(currentSharedResultsButtons[currentSharedResultsButtons.length - 1]);
    expect(screen.getByRole("heading", { name: "Checks people chose to share" })).toBeTruthy();
  });
});

describe("Agent integration entry point", () => {
  it("opens the agent integration page from the landing nav", () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: "Agent docs" })[0]);

    expect(screen.getByRole("heading", { name: "How agents talk to AgentPay" })).toBeTruthy();
    expect(screen.getByText("curl http://localhost:3000/api/skill.md")).toBeTruthy();
    expect(screen.getByText("skill://agentpay")).toBeTruthy();
  });

  it("renders the agent integration page directly at /agents", () => {
    window.history.pushState({}, "", "/agents");

    render(<App />);

    expect(screen.getByRole("heading", { name: "How agents talk to AgentPay" })).toBeTruthy();
  });
});
