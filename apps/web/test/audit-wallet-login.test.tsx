import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/App";

const PUBLIC_KEY = `01${"a".repeat(64)}`;
const SIGNATURE = "b".repeat(128);
const SESSION_TOKEN = "wallet-session-token-that-must-not-be-rendered";

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
  Reflect.deleteProperty(window, "CasperWalletProvider");
  window.history.pushState({}, "", "/");
});

it("creates an in-memory AgentPay session with Casper Wallet", async () => {
  const provider = {
    requestConnection: vi.fn(async () => true),
    getActivePublicKey: vi.fn(async () => PUBLIC_KEY),
    signMessage: vi.fn(async () => ({ cancelled: false, signatureHex: SIGNATURE }))
  };
  Object.defineProperty(window, "CasperWalletProvider", {
    configurable: true,
    value: vi.fn(() => provider)
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (url.pathname === "/api/v1/auth/challenges") {
        expect(body).toEqual({ purpose: "session", operatorPublicKey: PUBLIC_KEY });
        return jsonResponse(
          {
            challengeId: "challenge-1",
            operatorPublicKey: PUBLIC_KEY,
            purpose: "session",
            nonce: "c".repeat(64),
            message: "AgentPay login challenge",
            issuedAt: "2026-07-17T12:00:00.000Z",
            expiresAt: "2026-07-17T12:05:00.000Z"
          },
          201
        );
      }
      if (url.pathname === "/api/v1/auth/sessions") {
        expect(body).toEqual({
          challengeId: "challenge-1",
          operatorPublicKey: PUBLIC_KEY,
          signature: SIGNATURE
        });
        return jsonResponse(
          {
            token: SESSION_TOKEN,
            operatorPublicKey: PUBLIC_KEY,
            expiresAt: "2026-07-17T13:00:00.000Z"
          },
          201
        );
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    })
  );

  window.history.pushState({}, "", "/audit");
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Connect Casper Wallet" }));

  await waitFor(() => {
    expect(screen.getByText("Casper Wallet connected. Your session stays in this tab.")).toBeTruthy();
  });
  expect(provider.requestConnection).toHaveBeenCalledOnce();
  expect(provider.getActivePublicKey).toHaveBeenCalledOnce();
  expect(provider.signMessage).toHaveBeenCalledWith("AgentPay login challenge", PUBLIC_KEY);
  expect(document.body.textContent).not.toContain(SESSION_TOKEN);
});

it("explains when Casper Wallet is not installed without calling the API", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  window.history.pushState({}, "", "/audit");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Casper Wallet" }));

  await waitFor(() => {
    expect(screen.getByText(/Casper Wallet was not found/i)).toBeTruthy();
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps the user signed out when wallet connection is cancelled", async () => {
  const provider = {
    requestConnection: vi.fn(async () => false),
    getActivePublicKey: vi.fn(async () => PUBLIC_KEY),
    signMessage: vi.fn(async () => ({ cancelled: false, signatureHex: SIGNATURE }))
  };
  Object.defineProperty(window, "CasperWalletProvider", {
    configurable: true,
    value: vi.fn(() => provider)
  });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  window.history.pushState({}, "", "/audit");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Casper Wallet" }));

  await waitFor(() => {
    expect(screen.getByText("Wallet connection was cancelled.")).toBeTruthy();
  });
  expect(provider.getActivePublicKey).not.toHaveBeenCalled();
  expect(provider.signMessage).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText("not connected")).toBeTruthy();
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
