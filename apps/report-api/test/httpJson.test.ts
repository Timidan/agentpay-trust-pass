import { describe, expect, it, vi } from "vitest";
import { fetchBoundedJson } from "../src/httpJson";

describe("bounded backend JSON transport", () => {
  it("rejects a response whose declared length exceeds the configured limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      }
    });
    const fetchImpl = vi.fn(async () =>
      new Response(body, {
        headers: { "content-length": "1000", "content-type": "application/json" }
      })
    );

    await expect(fetchBoundedJson("https://service.example/data", {}, {
      fetchImpl,
      maxResponseBytes: 100
    })).rejects.toThrow(/exceeds 100 bytes/i);
    expect(cancelled).toBe(true);
  });

  it("cancels a streamed response as soon as it crosses the configured limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
      },
      cancel() {
        cancelled = true;
      }
    });
    const fetchImpl = vi.fn(async () => new Response(body));

    await expect(fetchBoundedJson("https://service.example/data", {}, {
      fetchImpl,
      maxResponseBytes: 100
    })).rejects.toThrow(/exceeds 100 bytes/i);
    expect(cancelled).toBe(true);
  });

  it("aborts stalled requests at the configured deadline", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })
    );

    await expect(fetchBoundedJson("https://service.example/data", {}, {
      fetchImpl,
      timeoutMs: 5
    })).rejects.toThrow(/timed out/i);
  });
});
