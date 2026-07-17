import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditApiClient } from "../src/audit/api";
import { createIdempotencyKey, useAuditFlow } from "../src/audit/useAuditFlow";

// Honest-state transitions of the audit workflow hook, driven by a mocked fetch.
// Every verdict/anchor state is asserted verbatim from the API — pending and
// not-checked never collapse into success or failure.

const TOKEN = "operator-session-token-abcdefghijklmnop";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const probeResult = {
  request: {
    method: "GET",
    url: "https://svc.example/pay",
    scheme: "https",
    origin: "https://svc.example",
    path: "/pay",
    bodyHash: "0".repeat(64),
    bodyBytes: 0,
    capturedAt: "2026-07-16T00:00:00.000Z",
    adapterVersion: "agentpay-probe/1.0",
    requestHash: "a".repeat(64)
  },
  response: { status: 402, contentType: "application/json", bodyBytes: 12, bodyHash: "b".repeat(64), observedAt: "2026-07-16T00:00:00.000Z" },
  terms: {
    scheme: "exact",
    network: "casper:casper-test",
    asset: "9".repeat(64),
    amount: "10000",
    payTo: `00${"8".repeat(64)}`,
    maxTimeoutSeconds: 300,
    extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "TEST" },
    x402Version: 2,
    acceptanceIndex: 0,
    resource: { url: "https://svc.example/pay", description: "paid", mimeType: "application/json" },
    resourceComparison: { sameHost: true, sameScheme: true, samePath: true },
    requirementHash: "c".repeat(64)
  },
  advisories: [],
  redirects: []
};

function reviewCheck(id: string) {
  return {
    created: true,
    check: {
      id,
      request: probeResult.request,
      terms: probeResult.terms,
      authorization: null,
      status: "review",
      decision: {
        checkId: id,
        verdict: "review",
        basis: null,
        reasons: [
          { code: "authorization_required", result: "review", message: "Authorization intent is required", field: "authorization", expected: "signed intent", received: null }
        ],
        advisories: [],
        policyHash: null,
        authorizationDigest: null,
        reservation: null,
        decidedAt: "2026-07-16T00:00:00.000Z",
        decisionHash: "d".repeat(64)
      }
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function authenticate(result: { current: ReturnType<typeof useAuditFlow> }) {
  act(() => result.current.setToken(TOKEN));
  act(() => result.current.setProbeInput({ url: "https://svc.example/pay", method: "GET" }));
}

describe("useAuditFlow honest states", () => {
  it("uses secure random bytes when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });
    const key = createIdempotencyKey({
      getRandomValues,
      randomUUID: undefined
    } as unknown as Crypto);

    expect(key).toBe("abababab-abab-4bab-abab-abababababab");
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("refuses to mint an idempotency key without secure randomness", () => {
    expect(() => createIdempotencyKey(null)).toThrow(/Secure browser randomness is unavailable/);
  });

  it("can load the public x402 service without sending audit requests to it", async () => {
    const packageHash = `hash-${"a".repeat(64)}`;
    const requestedOrigins: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const requestUrl = new URL(String(url));
        requestedOrigins.push(requestUrl.origin);
        if (requestUrl.pathname === "/api/resolve") {
          return jsonResponse({ packageHash, network: "casper-mainnet" });
        }
        return jsonResponse({
          quoteId: "quote-live-1",
          paymentResource: { url: "https://service.agentpay.example/api/reports/buy/quote-live-1" },
          paymentRequirements: [{ scheme: "exact" }],
          paymentReadiness: { status: "ready", reason: null }
        });
      })
    );

    const client = new AuditApiClient(
      "https://auditor.agentpay.example/api",
      "https://service.agentpay.example/api"
    );
    await client.getAgentPayServiceQuote();

    expect(requestedOrigins).toEqual([
      "https://service.agentpay.example",
      "https://service.agentpay.example"
    ]);
  });

  it("loads a fresh AgentPay x402 charge as the payment checker target", async () => {
    const packageHash = `hash-${"a".repeat(64)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === "/api/resolve") {
          expect(requestUrl.searchParams.get("symbol")).toBe("WCSPR");
          return jsonResponse({
            symbol: "WCSPR",
            packageHash,
            name: "Wrapped CSPR",
            network: "casper-mainnet"
          });
        }
        expect(requestUrl.pathname).toBe("/api/reports/quote");
        expect(requestUrl.searchParams.get("subject")).toBe(packageHash);
        expect(requestUrl.searchParams.get("network")).toBe("casper-mainnet");
        return jsonResponse({
          quoteId: "quote-live-1",
          paymentResource: { url: "https://agentpay.example/api/reports/buy/quote-live-1" },
          paymentRequirements: [{ scheme: "exact" }],
          paymentReadiness: { status: "ready", reason: null }
        });
      })
    );

    const { result } = renderHook(() => useAuditFlow());
    await act(async () => {
      await result.current.loadAgentPayService();
    });

    expect(result.current.liveService.status).toBe("success");
    expect(result.current.probeInput).toEqual({
      url: "https://agentpay.example/api/reports/buy/quote-live-1",
      method: "POST",
      body: {}
    });
  });

  it("does not label AgentPay's own charge ready when the payment service is unavailable", async () => {
    const packageHash = `hash-${"a".repeat(64)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === "/api/resolve") {
          return jsonResponse({ packageHash, network: "casper-mainnet" });
        }
        return jsonResponse({
          quoteId: "quote-unavailable-1",
          paymentResource: { url: "https://agentpay.example/api/reports/buy/quote-unavailable-1" },
          paymentRequirements: [],
          paymentReadiness: { status: "facilitator_unavailable", reason: "facilitator_unavailable" }
        });
      })
    );

    const { result } = renderHook(() => useAuditFlow());
    await act(async () => {
      await result.current.loadAgentPayService();
    });

    expect(result.current.liveService.status).toBe("error");
    expect(result.current.liveService.error?.code).toBe("service_charge_unavailable");
    expect(result.current.liveService.error?.message).toMatch(/Testnet payment service is not ready/i);
    expect(result.current.probeInput.url).toBe("");
  });

  it("surfaces a probe error verbatim without inventing a charge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { code: "probe_https_required", message: "Probe targets must use HTTPS", retryable: false, field: "url", expected: "https URL", received: "http://x" },
          400
        )
      )
    );
    const { result } = renderHook(() => useAuditFlow());
    await authenticate(result);
    await act(async () => {
      await result.current.runProbe();
    });
    expect(result.current.probe.status).toBe("error");
    expect(result.current.probe.error?.code).toBe("probe_https_required");
    expect(result.current.probe.error?.field).toBe("url");
    expect(result.current.probe.data).toBeNull();
  });

  it("renders the backend REVIEW verdict verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/v1/probes")) return jsonResponse(probeResult);
        if (String(url).endsWith("/v1/checks")) return jsonResponse(reviewCheck("check-1"), 201);
        throw new Error(`unexpected ${url}`);
      })
    );
    const { result } = renderHook(() => useAuditFlow());
    await authenticate(result);
    await act(async () => {
      await result.current.runProbe();
    });
    await act(async () => {
      await result.current.runCheck();
    });
    expect(result.current.decision).toBe("review");
    expect(result.current.check.data?.check.decision.reasons[0].code).toBe("authorization_required");
  });

  it("re-check mints a fresh idempotency key and preserves the prior check", async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/v1/probes")) return jsonResponse(probeResult);
        if (String(url).endsWith("/v1/checks")) {
          const headers = new Headers(init?.headers);
          keys.push(headers.get("idempotency-key") ?? "");
          return jsonResponse(reviewCheck(`check-${keys.length}`), 201);
        }
        throw new Error(`unexpected ${url}`);
      })
    );
    const { result } = renderHook(() => useAuditFlow());
    await authenticate(result);
    await act(async () => {
      await result.current.runProbe();
    });
    await act(async () => {
      await result.current.runCheck();
    });
    await act(async () => {
      await result.current.recheck();
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBeTruthy();
    expect(result.current.previousChecks.map((check) => check.id)).toEqual(["check-1"]);
    expect(result.current.check.data?.check.id).toBe("check-2");
  });

  it("keeps a pending settlement distinct from success and failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/v1/probes")) return jsonResponse(probeResult);
        if (String(url).endsWith("/v1/checks")) return jsonResponse(reviewCheck("check-1"), 201);
        if (String(url).includes("/verify-settlement")) {
          return jsonResponse({
            created: true,
            check: { id: "check-1", status: "settlement_pending" },
            proof: { checkId: "check-1", transactionHash: "e".repeat(64), verdict: "pending", reasons: [], rpcEndpoint: "https://rpc", blockHash: null, blockHeight: null, observedAt: "2026-07-16T00:00:00.000Z", decoded: null, proofHash: "f".repeat(64) },
            receipt: null
          });
        }
        throw new Error(`unexpected ${url}`);
      })
    );
    const { result } = renderHook(() => useAuditFlow());
    await authenticate(result);
    await act(async () => {
      await result.current.runProbe();
    });
    await act(async () => {
      await result.current.runCheck();
    });
    await act(async () => {
      await result.current.verifySettlement("e".repeat(64));
    });
    // Request completed, but the verdict is pending — not collapsed to a result.
    expect(result.current.settlement.status).toBe("success");
    expect(result.current.settlementVerdict).toBe("pending");
  });

  it("errors honestly when recording a response without a check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 200)));
    const { result } = renderHook(() => useAuditFlow());
    act(() => result.current.setToken(TOKEN));
    await act(async () => {
      await result.current.recordObservation({
        observerVersion: "test",
        status: 200,
        contentType: "application/json",
        bodyBytes: 3,
        bodyHash: "4".repeat(64),
        observedAt: "2026-07-16T00:00:00.000Z"
      });
    });
    // No check id yet → observation errors honestly, the receipt stays absent.
    expect(result.current.observation.status).toBe("error");
    expect(result.current.anchorState).toBeNull();
  });

  it("polls the receipt anchor and stops on a terminal state", async () => {
    vi.useFakeTimers();
    let receiptReads = 0;
    const receiptBody = {
      schemaVersion: "agentpay-purchase/v1",
      receiptId: "receipt-check-1",
      checkId: "check-1",
      request: probeResult.request,
      terms: probeResult.terms,
      decision: { verdict: "review" },
      settlement: { verdict: "match", transactionHash: "e".repeat(64) },
      response: { status: 200, bodyBytes: 3 },
      anchor: { status: "pending", transactionHash: null },
      createdAt: "2026-07-16T00:00:00.000Z",
      receiptHash: "1".repeat(64)
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/v1/probes")) return jsonResponse(probeResult);
        if (String(url).endsWith("/v1/checks")) return jsonResponse(reviewCheck("check-1"), 201);
        if (String(url).endsWith("/response-observations")) {
          return jsonResponse({ created: true, observation: { checkId: "check-1", observationHash: "2".repeat(64) }, receipt: receiptBody }, 201);
        }
        if (String(url).includes("/v1/receipts/")) {
          receiptReads += 1;
          const status = receiptReads >= 2 ? "anchored" : "pending";
          return jsonResponse({ receipt: receiptBody, anchorState: { status, transactionHash: receiptReads >= 2 ? "3".repeat(64) : null } });
        }
        throw new Error(`unexpected ${url}`);
      })
    );
    const { result } = renderHook(() => useAuditFlow());
    act(() => result.current.setToken(TOKEN));
    act(() => result.current.setProbeInput({ url: "https://svc.example/pay" }));
    await act(async () => {
      await result.current.runProbe();
    });
    await act(async () => {
      await result.current.runCheck();
    });
    await act(async () => {
      await result.current.recordObservation({
        observerVersion: "test",
        status: 200,
        contentType: "application/json",
        bodyBytes: 3,
        bodyHash: "4".repeat(64),
        observedAt: "2026-07-16T00:00:00.000Z"
      });
    });
    // Anchor starts pending — polling is live, verdict not yet decided.
    expect(result.current.receipt.anchorPoll).toBe("polling");
    expect(result.current.anchorState?.status).toBe("pending");

    // Advance through the backoff until the anchor reaches a terminal state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(result.current.anchorState?.status).toBe("anchored");
    expect(result.current.receipt.anchorPoll).toBe("terminal");
    // Two reads: pending then anchored. Polling stops on terminal.
    expect(receiptReads).toBe(2);
  });
});
