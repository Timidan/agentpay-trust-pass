import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/App";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

it("loads a fresh AgentPay Testnet charge into the payment checker", async () => {
  const packageHash = `hash-${"a".repeat(64)}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname === "/api/resolve") {
        return new Response(
          JSON.stringify({
            symbol: "WCSPR",
            packageHash,
            name: "Wrapped CSPR",
            network: "casper-mainnet"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      expect(requestUrl.pathname).toBe("/api/reports/quote");
      expect(requestUrl.searchParams.get("subject")).toBe(packageHash);
      expect(requestUrl.searchParams.get("network")).toBe("casper-mainnet");
      return new Response(
        JSON.stringify({
          quoteId: "quote-live-1",
          paymentResource: { url: "https://agentpay.example/api/reports/buy/quote-live-1" },
          paymentRequirements: [{ scheme: "exact" }],
          paymentReadiness: { status: "ready", reason: null }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
  window.history.pushState({}, "", "/audit");
  render(<App />);

  expect(screen.getByText(/connect Casper Wallet and sign a login message/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect Casper Wallet" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Read charge" })).toBeTruthy();
  expect(document.body.textContent).not.toContain("control surface");
  expect(document.body.textContent).not.toContain("Probe charge");

  fireEvent.click(screen.getByRole("button", { name: "Use AgentPay's own charge" }));

  await waitFor(() => {
    expect((screen.getByLabelText("Service URL") as HTMLInputElement).value).toBe(
      "https://agentpay.example/api/reports/buy/quote-live-1"
    );
  });
  expect((screen.getByLabelText("HTTP method") as HTMLSelectElement).value).toBe("POST");
});
