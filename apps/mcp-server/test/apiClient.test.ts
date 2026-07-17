import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiResponseError, buyReport, resolveCsprName } from "../src/apiClient.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("report API client timeouts", () => {
  it("keeps a settlement request alive beyond the generic read timeout", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });

    const outcome = buyReport({
      reportApiUrl: "https://agentpay.example",
      quoteId: "quote-1",
      paymentPayload: { x402Version: 2 }
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(15_001);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(104_999);
    await expect(outcome).resolves.toBeInstanceOf(ApiResponseError);
  });
});

describe("CSPR.name API client", () => {
  it("returns a resolved account and preserves a real not-found response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        name: "alice.cspr",
        accountHash: `account-hash-${"a".repeat(64)}`,
        publicKey: null,
        expiresAt: "2027-11-25T09:00:00Z",
        isPrimary: false,
        network: "casper-mainnet",
        source: "CSPR.name",
        sourceUrl: "https://api.cspr.name/resolutions/alice.cspr"
      }))
      .mockResolvedValueOnce(Response.json({ error: "not_found" }, { status: 404 }));

    await expect(resolveCsprName("https://agentpay.example", "Alice.CSPR"))
      .resolves.toMatchObject({ name: "alice.cspr", source: "CSPR.name" });
    await expect(resolveCsprName("https://agentpay.example", "missing.cspr"))
      .resolves.toBeNull();

    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      "https://agentpay.example/resolve-account?name=Alice.CSPR",
      "https://agentpay.example/resolve-account?name=missing.cspr"
    ]);
  });
});
