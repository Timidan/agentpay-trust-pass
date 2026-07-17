import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportApp } from "@agent-pay/report-api/src/app";
import { ApiResponseError } from "../src/apiClient";
import {
  buyReportTool,
  checkX402PaymentTool,
  configuredReportApiUrl,
  getPaymentReceiptTool,
  paymentStatusTool,
  quoteReportTool,
  recordDecisionTool,
  registryStatusTool,
  verifyX402SettlementTool
} from "../src/tools";

const envSnapshot = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
});

async function withReportApi<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const app = createReportApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Report API did not bind to a TCP port");
    }
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("MCP tool layer", () => {
  it("quotes live evidence and preserves the x402 payment gate", async () => {
    clearPaymentEnv();
    await withReportApi(async (reportApiUrl) => {
      process.env.REPORT_API_URL = reportApiUrl;
      const quote = await quoteReportTool({ reportApiUrl, subject: "a".repeat(64) });
      expect(quote.quoteId).toMatch(/^trust-/);
      expect(quote.sourceSummary.length).toBeGreaterThanOrEqual(2);
      expect(quote.paymentReadiness.status).toBe("configuration_required");

      const paymentStatus = await paymentStatusTool({ reportApiUrl });
      expect(paymentStatus).toMatchObject({
        status: "configuration_required",
        reason: "x402_asset_package_hash_required"
      });

      const registryStatus = await registryStatusTool();
      expect(registryStatus).toMatchObject({
        status: "configuration_required",
        reason: "agent_pay_registry_package_hash_required"
      });

      await expect(
        buyReportTool({
          reportApiUrl,
          quoteId: quote.quoteId
        })
      ).rejects.toMatchObject({
        status: 402
      } satisfies Partial<ApiResponseError>);
    });
  }, 20_000);

  it("rejects quote_report when no subject is supplied", async () => {
    await withReportApi(async (reportApiUrl) => {
      process.env.REPORT_API_URL = reportApiUrl;
      await expect(quoteReportTool({ reportApiUrl })).rejects.toThrow(/subject/i);
      await expect(quoteReportTool({ reportApiUrl, subject: "   " })).rejects.toThrow(/subject/i);
    });
  });

  it("requires an explicit report API URL in production", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(() => configuredReportApiUrl({ NODE_ENV: "production" }))
      .toThrow("REPORT_API_URL is required in production");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves a CSPR.trade symbol to an exact Mainnet package before quoting", async () => {
    const reportApiUrl = "https://agentpay.example";
    process.env.REPORT_API_URL = reportApiUrl;
    const packageHash = `hash-${"c".repeat(64)}`;
    const requests: URL[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      requests.push(url);
      if (url.pathname === "/resolve") {
        return Response.json({
          symbol: "WCSPR",
          packageHash,
          name: "Wrapped CSPR",
          network: "casper-mainnet"
        });
      }
      return Response.json({
        quoteId: "quote-mainnet-1",
        evidenceNetwork: "casper-mainnet"
      });
    });

    const quote = await quoteReportTool({ subject: "WCSPR" });

    expect(requests.map((url) => url.pathname)).toEqual([
      "/resolve",
      "/reports/quote"
    ]);
    expect(requests[0].searchParams.get("symbol")).toBe("WCSPR");
    expect(requests[1].searchParams.get("subject")).toBe(packageHash);
    expect(requests[1].searchParams.get("network")).toBe("casper-mainnet");
    expect(quote).toMatchObject({
      quoteId: "quote-mainnet-1",
      evidenceNetwork: "casper-mainnet",
      resolvedToken: {
        symbol: "WCSPR",
        packageHash,
        network: "casper-mainnet",
        source: "CSPR.trade"
      }
    });
  });

  it("does not relabel a CSPR.trade Mainnet token as Testnet", async () => {
    process.env.REPORT_API_URL = "https://agentpay.example";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      symbol: "WCSPR",
      packageHash: `hash-${"c".repeat(64)}`,
      name: "Wrapped CSPR",
      network: "casper-mainnet"
    }));

    await expect(
      quoteReportTool({ subject: "WCSPR", evidenceNetwork: "casper-testnet" })
    ).rejects.toThrow(/listed by CSPR\.trade on casper-mainnet/);
  });

  it("resolves a CSPR.name to a canonical Mainnet account before quoting", async () => {
    process.env.REPORT_API_URL = "https://agentpay.example";
    const publicKey = `01${"4".repeat(64)}`;
    const requests: URL[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      requests.push(url);
      if (url.pathname === "/resolve-account") {
        return Response.json({
          name: "alice.cspr",
          accountHash: `account-hash-${"5".repeat(64)}`,
          publicKey,
          expiresAt: "2027-11-25T09:00:00Z",
          isPrimary: true,
          network: "casper-mainnet",
          source: "CSPR.name",
          sourceUrl: "https://api.cspr.name/resolutions/alice.cspr"
        });
      }
      return Response.json({
        quoteId: "quote-name-1",
        evidenceNetwork: "casper-mainnet"
      });
    });

    const quote = await quoteReportTool({ subject: "Alice.CSPR" });

    expect(requests.map((url) => url.pathname)).toEqual([
      "/resolve-account",
      "/reports/quote"
    ]);
    expect(requests[0].searchParams.get("name")).toBe("Alice.CSPR");
    expect(requests[1].searchParams.get("subject")).toBe(publicKey);
    expect(requests[1].searchParams.get("network")).toBe("casper-mainnet");
    expect(quote).toMatchObject({
      quoteId: "quote-name-1",
      resolvedAccount: {
        name: "alice.cspr",
        publicKey,
        source: "CSPR.name"
      }
    });
  });

  it("does not relabel a CSPR.name Mainnet account as Testnet", async () => {
    process.env.REPORT_API_URL = "https://agentpay.example";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      quoteReportTool({ subject: "alice.cspr", evidenceNetwork: "casper-testnet" })
    ).rejects.toThrow(/CSPR\.name resolves on casper-mainnet/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not emit an AgentPay registry transaction when submitter configuration is absent", async () => {
    clearPaymentEnv();
    await expect(
      recordDecisionTool({
        datasetId: "dataset-runtime",
        datasetRoot: "c".repeat(64),
        reportHash: "a".repeat(64),
        paymentReceiptHash: "b".repeat(64),
        decision: "approved"
      })
    ).rejects.toThrow("AGENT_PAY_REGISTRY_PACKAGE_HASH");
  });

  it("exposes check, settlement, and receipt operations without sending local secrets", async () => {
    process.env.AGENT_PAY_API_URL = "http://127.0.0.1:4021";
    process.env.AGENT_PAY_API_TOKEN = "agent-token-that-is-at-least-32-characters";
    const requests: Array<{ url: string; headers: Headers; body: string | null }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : null
      });
      if (String(url).endsWith("/v1/checks")) {
        return Response.json({ created: true, check: { id: "check-1", decision: { verdict: "pay" } } });
      }
      if (String(url).endsWith("/verify-settlement")) {
        return Response.json({
          created: true,
          check: { id: "check-1", status: "settled" },
          proof: { verdict: "match", transactionHash: "f".repeat(64) },
          receipt: null
        });
      }
      return Response.json({
        receipt: { receiptId: "receipt-1", checkId: "check-1" },
        anchorState: { status: "pending", transactionHash: "a".repeat(64) }
      });
    });

    const authorization = {
      payerPublicKey: `01${"1".repeat(64)}`,
      from: `00${"2".repeat(64)}`,
      to: `00${"3".repeat(64)}`,
      amount: "100",
      validAfter: "1",
      validBefore: "2",
      nonce: "4".repeat(64),
      network: "casper:casper-test" as const,
      asset: "5".repeat(64),
      tokenName: "Test token",
      tokenVersion: "1",
      digest: "6".repeat(64)
    };
    await expect(checkX402PaymentTool({
      request: {
        method: "GET",
        url: "https://service.example/resource",
        bodyHash: "0".repeat(64),
        bodyBytes: 0,
        capturedAt: "2026-07-15T21:00:00.000Z",
        adapterVersion: "test/1"
      },
      paymentRequired: { x402Version: 2, accepts: [] },
      authorization,
      idempotencyKey: "mcp-check-1"
    })).resolves.toMatchObject({ check: { id: "check-1" } });
    await expect(verifyX402SettlementTool({
      checkId: "check-1",
      transactionHash: "f".repeat(64)
    })).resolves.toMatchObject({ proof: { verdict: "match" } });
    await expect(getPaymentReceiptTool({ receiptId: "receipt-1" }))
      .resolves.toMatchObject({
        receipt: { receiptId: "receipt-1" },
        anchorState: { status: "pending", transactionHash: "a".repeat(64) }
      });

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/v1/checks",
      "/v1/checks/check-1/verify-settlement",
      "/v1/receipts/receipt-1"
    ]);
    expect(requests.every((request) => request.headers.get("authorization") === `Bearer ${process.env.AGENT_PAY_API_TOKEN}`))
      .toBe(true);
    expect(requests.map((request) => request.body).join(" ")).not.toMatch(/private|secret|agent-token/i);
  });

  it("rejects caller-supplied API targets before they can receive the configured agent token", async () => {
    process.env.AGENT_PAY_API_URL = "https://agentpay.example";
    process.env.AGENT_PAY_API_TOKEN = "agent-token-that-is-at-least-32-characters";
    delete process.env.AGENT_PAY_ALLOW_REPORT_API_URL_OVERRIDE;
    delete process.env.AGENT_PAY_ALLOWED_REPORT_API_URLS;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(checkX402PaymentTool({
      agentPayApiUrl: "https://attacker.example",
      request: {
        method: "GET",
        url: "https://service.example/resource",
        bodyHash: "0".repeat(64),
        bodyBytes: 0,
        capturedAt: "2026-07-15T21:00:00.000Z",
        adapterVersion: "test/1"
      },
      paymentRequired: { x402Version: 2, accepts: [] },
      authorization: {
        payerPublicKey: `01${"1".repeat(64)}`,
        from: `00${"2".repeat(64)}`,
        to: `00${"3".repeat(64)}`,
        amount: "100",
        validAfter: "1",
        validBefore: "2",
        nonce: "4".repeat(64),
        network: "casper:casper-test",
        asset: "5".repeat(64),
        tokenName: "Test token",
        tokenVersion: "1",
        digest: "6".repeat(64)
      }
    })).rejects.toThrow(/override/i);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("permits only explicitly allowlisted API URL overrides", async () => {
    process.env.REPORT_API_URL = "https://agentpay.example";
    process.env.AGENT_PAY_ALLOW_REPORT_API_URL_OVERRIDE = "1";
    process.env.AGENT_PAY_ALLOWED_REPORT_API_URLS = "https://staging.agentpay.example";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ status: "ready", reason: null, checks: [] })
    );

    await expect(paymentStatusTool({ reportApiUrl: "https://not-allowed.example" }))
      .rejects.toThrow(/allowlist/i);
    await paymentStatusTool({ reportApiUrl: "https://staging.agentpay.example" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://staging.agentpay.example/reports/payment-status");
  });

  it("cancels oversized report API responses before parsing them", async () => {
    process.env.REPORT_API_URL = "https://agentpay.example";
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      }
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { headers: { "content-length": String(3 * 1024 * 1024) } })
    );

    await expect(paymentStatusTool()).rejects.toThrow(/too large/i);
    expect(cancelled).toBe(true);
  });
});

function clearPaymentEnv() {
  delete process.env.X402_ASSET_PACKAGE_HASH;
  delete process.env.PAYEE_ADDRESS;
  delete process.env.X402_FACILITATOR_URL;
  delete process.env.X402_FACILITATOR_AUTH_TOKEN;
  delete process.env.CSPR_CLOUD_ACCESS_TOKEN;
}
