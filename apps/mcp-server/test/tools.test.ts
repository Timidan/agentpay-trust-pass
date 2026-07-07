import { afterEach, describe, expect, it } from "vitest";
import { createReportApp } from "@agent-pay/report-api/src/app";
import { ApiResponseError } from "../src/apiClient";
import { buyReportTool, paymentStatusTool, quoteReportTool, recordDecisionTool, registryStatusTool } from "../src/tools";

const envSnapshot = { ...process.env };

afterEach(() => {
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
      await expect(quoteReportTool({ reportApiUrl })).rejects.toThrow(/subject/i);
      await expect(quoteReportTool({ reportApiUrl, subject: "   " })).rejects.toThrow(/subject/i);
    });
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
});

function clearPaymentEnv() {
  delete process.env.X402_ASSET_PACKAGE_HASH;
  delete process.env.PAYEE_ADDRESS;
  delete process.env.X402_FACILITATOR_URL;
  delete process.env.X402_FACILITATOR_AUTH_TOKEN;
  delete process.env.CSPR_CLOUD_ACCESS_TOKEN;
}
