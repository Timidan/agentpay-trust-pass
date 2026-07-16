import { describe, expect, it, vi } from "vitest";
import { AgentPayApiError, AgentPayHttpClient } from "../src/index.js";

const TOKEN = "agent-token-that-is-at-least-32-characters";

describe("AgentPayHttpClient transport", () => {
  it("allows loopback IPv6 for local development", () => {
    expect(() => new AgentPayHttpClient({ baseUrl: "http://[::1]:4021", token: TOKEN })).not.toThrow();
  });

  it("returns dynamic anchor state without changing the compatible receipt lookup", async () => {
    const payload = {
      receipt: { receiptId: "receipt-1", checkId: "check-1" },
      anchorState: { status: "anchored", transactionHash: "a".repeat(64) }
    };
    const client = new AgentPayHttpClient({
      baseUrl: "http://127.0.0.1:4021",
      token: TOKEN,
      fetchImpl: vi.fn(async () => Response.json(payload))
    });

    await expect(client.getReceiptRecord("receipt-1")).resolves.toEqual(payload);
    await expect(client.getReceipt("receipt-1")).resolves.toEqual(payload.receipt);
  });

  it("cancels an API response once it exceeds the configured limit", async () => {
    let cancelled = false;
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(4).fill(pullCount));
        if (pullCount === 3) controller.close();
      },
      cancel() {
        cancelled = true;
      }
    });
    const client = new AgentPayHttpClient({
      baseUrl: "http://127.0.0.1:4021",
      token: TOKEN,
      maxResponseBytes: 5,
      fetchImpl: vi.fn(async () => new Response(body, { status: 200 }))
    });

    await expect(client.getReceipt("receipt-1")).rejects.toThrow(/too large/i);
    expect(cancelled).toBe(true);
  });

  it("refuses redirects and turns timeouts into retryable API errors", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (!init?.signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        init.signal.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = new AgentPayHttpClient({
      baseUrl: "http://127.0.0.1:4021",
      token: TOKEN,
      timeoutMs: 5,
      fetchImpl
    });

    await expect(client.getReceipt("receipt-1")).rejects.toMatchObject<Partial<AgentPayApiError>>({
      status: 0,
      retryable: true
    });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
