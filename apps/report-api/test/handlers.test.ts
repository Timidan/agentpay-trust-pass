import { createServer, type IncomingMessage } from "node:http";
import { buildX402PaymentSignature, createCasperSigner } from "@agent-pay/client";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReportApp as createProductionReportApp,
  type CreateReportAppOptions,
  type PaymentAssetEvidenceLoader
} from "../src/app";

// Every quote is subject-scoped now. These are well-formed but nonexistent
// package hashes: token-state degrades to "not checked", so the quote/x402
// flow is exercised without depending on a specific live token. Two distinct
// subjects are needed where a test creates two separate quotes at once.
const QUOTE_SUBJECT = "a".repeat(64);
const QUOTE_SUBJECT_B = "b".repeat(64);

const envSnapshot = { ...process.env };

const testPaymentAssetEvidenceLoader: PaymentAssetEvidenceLoader = async (requirement) => ({
  network: "casper:casper-test",
  packageHash: requirement.asset,
  packageExists: true,
  activeContractHash: "4".repeat(64),
  authorizationEntrypoint: true,
  name: requirement.extra.name,
  symbol: requirement.extra.symbol ?? null,
  decimals: requirement.extra.decimals === undefined ? null : Number(requirement.extra.decimals),
  mintBurnEnabled: false,
  publicMintEntrypoint: false,
  holderConcentrationPct: null,
  contractAgeBlocks: null,
  apiVersion: "2.0.0",
  observedBlockHash: "7".repeat(64),
  observedBlockHeight: 8_449_100,
  observedAt: new Date().toISOString(),
  missing: [],
  sourceErrors: [],
  evidenceHash: "a".repeat(64)
});

function createReportApp(options: CreateReportAppOptions = {}) {
  return createProductionReportApp({
    paymentAssetEvidenceLoader: testPaymentAssetEvidenceLoader,
    ...options
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
});

describe("report API", () => {
  it("serves the agent skill with the request origin substituted for local development", async () => {
    delete process.env.AGENTPAY_PUBLIC_ORIGIN;
    delete process.env.AGENT_PAY_PUBLIC_ORIGIN;

    const response = await dispatchReportApp("/skill.md", { host: "agentpay.local:4021" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/markdown/);
    expect(response.body).toContain("# AgentPay");
    expect(response.body).toContain("http://agentpay.local:4021");
    expect(response.body).not.toContain("$AGENT_PAY_BASE_URL");
  });

  it("pins served skill examples to AGENTPAY_PUBLIC_ORIGIN despite forged Host headers", async () => {
    process.env.AGENTPAY_PUBLIC_ORIGIN = "https://agentpay.example/";
    process.env.AGENT_PAY_PUBLIC_ORIGIN = "https://legacy.example/";

    const response = await dispatchReportApp("/skill", {
      host: "evil.example",
      "x-forwarded-proto": "https"
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain("https://agentpay.example");
    expect(response.body).not.toContain("evil.example");
    expect(response.body).not.toContain("$AGENT_PAY_BASE_URL");
  });

  it("keeps the public API path in hosted skill examples", async () => {
    process.env.AGENT_PAY_RESOURCE_BASE_URL = "https://agentpay.example/api/";
    process.env.AGENTPAY_PUBLIC_ORIGIN = "https://agentpay.example";

    const response = await dispatchReportApp("/skill.md", { host: "evil.example" });

    expect(response.status).toBe(200);
    expect(response.body).toContain("https://agentpay.example/api/skill.md");
    expect(response.body).not.toContain("https://agentpay.example/skill.md");
    expect(response.body).not.toContain("evil.example");
  });

  it("uses the canonical public origin for quoted x402 resource URLs", async () => {
    await withSupportedFacilitator(async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      delete process.env.AGENT_PAY_RESOURCE_BASE_URL;
      delete process.env.REPORT_API_PUBLIC_URL;
      process.env.REPORT_API_URL = "http://127.0.0.1:4021";
      process.env.AGENTPAY_PUBLIC_ORIGIN = "https://agentpay.example";

      const response = await request(createReportApp())
        .get(`/reports/quote?subject=${QUOTE_SUBJECT}`)
        .expect(200);

      expect(response.body.paymentResource.url).toBe(
        `https://agentpay.example/reports/buy/${response.body.quoteId}`
      );
    });
  }, 20_000);

  it("never exposes the internal report API URL in a quoted payment resource", async () => {
    await withSupportedFacilitator(async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      delete process.env.AGENT_PAY_PUBLIC_API_URL;
      delete process.env.AGENT_PAY_RESOURCE_BASE_URL;
      delete process.env.REPORT_API_PUBLIC_URL;
      delete process.env.AGENTPAY_PUBLIC_ORIGIN;
      delete process.env.AGENT_PAY_PUBLIC_ORIGIN;
      process.env.REPORT_API_URL = "http://127.0.0.1:4021";

      const response = await request(createReportApp())
        .get(`/reports/quote?subject=${QUOTE_SUBJECT}`)
        .set("host", "agentpay.example")
        .set("x-forwarded-proto", "https")
        .expect(200);

      expect(response.body.paymentResource.url).toBe(
        `https://agentpay.example/reports/buy/${response.body.quoteId}`
      );
      expect(JSON.stringify(response.body)).not.toContain("127.0.0.1");
    });
  }, 20_000);

  it("requires an explicit HTTPS public API base in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AGENT_PAY_PUBLIC_API_URL;
    delete process.env.AGENT_PAY_RESOURCE_BASE_URL;
    delete process.env.REPORT_API_PUBLIC_URL;
    delete process.env.AGENTPAY_PUBLIC_ORIGIN;
    delete process.env.AGENT_PAY_PUBLIC_ORIGIN;
    process.env.REPORT_API_URL = "http://127.0.0.1:4021";

    expect(() => createReportApp()).toThrow("AGENT_PAY_RESOURCE_BASE_URL is required in production");

    process.env.AGENT_PAY_RESOURCE_BASE_URL = "http://127.0.0.1:4021";
    expect(() => createReportApp()).toThrow("public API base must use HTTPS in production");
  });

  it("quotes subject-scoped Casper evidence", async () => {
    await withSupportedFacilitator(async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();

      const response = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);

      expect(response.body.quoteId).toMatch(/^trust-/);
      expect(response.body.datasetRoot).toMatch(/^[0-9a-f]{64}$/);
      expect(response.body.evidenceNetwork).toBe("casper-testnet");
      expect(
        response.body.sourceSummary.every(
          (source: { network: string }) => source.network === "casper-testnet"
        )
      ).toBe(true);
      expect(response.body.sourceSummary.length).toBeGreaterThanOrEqual(2);
      expect(
        response.body.sourceSummary.every(
          (source: { sourceUrl?: string }) => typeof source.sourceUrl === "string"
        )
      ).toBe(true);
      expect(response.body.sourceSummary.map((source: { product: string }) => source.product)).toContain(
        "Casper Token Authority"
      );
      expect(response.body.paymentRequirements[0]).toMatchObject({
        scheme: "exact",
        network: "casper:casper-test",
        asset: "9".repeat(64),
        payTo: `00${"8".repeat(64)}`,
        amount: "10000",
        extra: {
          name: "Cep18x402",
          version: "1",
          symbol: "CSPR"
        }
      });
      expect(response.body.paymentReadiness).toMatchObject({
        status: "ready",
        reason: null,
        supportedKind: {
          x402Version: 2,
          scheme: "exact",
          network: "casper:casper-test"
        }
      });
      expect(response.body.paymentReadiness).not.toHaveProperty("facilitatorUrl");
      expect(response.body.paymentReadiness).not.toHaveProperty("supportedKind.feePayer");
      expect(JSON.stringify(response.body)).not.toContain(facilitatorUrl);

      const paymentStatus = await request(app).get("/reports/payment-status").expect(200);
      expect(paymentStatus.body).not.toHaveProperty("facilitatorUrl");
      expect(paymentStatus.body).not.toHaveProperty("supportedKind.feePayer");
      expect(JSON.stringify(paymentStatus.body)).not.toContain(facilitatorUrl);
      expect(response.body.paymentResource.url).toContain(`/reports/buy/${response.body.quoteId}`);
    });
  }, 20_000);

  it("requires an x402 payment payload before releasing the report", async () => {
    await withSupportedFacilitator(async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);

      const response = await request(app).post(`/reports/buy/${quote.body.quoteId}`).send({}).expect(402);

      expect(response.body).toMatchObject({
        error: "payment_required",
        reason: "PAYMENT-SIGNATURE header is required"
      });
      expect(response.body.accepts[0]).toMatchObject({ scheme: "exact" });
      expect(response.body.quote.paymentReadiness).not.toHaveProperty("facilitatorUrl");
      expect(JSON.stringify(response.body)).not.toContain(facilitatorUrl);
      expect(response.headers["payment-required"]).toBeTruthy();
    });
  }, 20_000);

  it("returns the x402 challenge for a bare POST without a content type", async () => {
    configureX402Payment("https://facilitator.test");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (rawUrl, init) => {
      if (String(rawUrl).endsWith("/supported")) {
        return Response.json(supportedFacilitatorPayload());
      }
      const requestBody = JSON.parse(String(init?.body)) as { id?: string };
      return Response.json({
        jsonrpc: "2.0",
        id: requestBody.id,
        error: { code: -32000, message: "Evidence unavailable in this fixture" }
      });
    }));
    const app = createReportApp();
    const quoteResponse = await dispatchReportApp(
      `/reports/quote?subject=${QUOTE_SUBJECT}`,
      { host: "127.0.0.1:4021" },
      { app }
    );
    expect(quoteResponse.status).toBe(200);
    const quote = JSON.parse(quoteResponse.body) as { quoteId: string };

    const response = await dispatchReportApp(
      `/reports/buy/${quote.quoteId}`,
      { host: "127.0.0.1:4021" },
      { app, method: "POST" }
    );

    expect(response.status).toBe(402);
    expect(JSON.parse(response.body)).toMatchObject({
      error: "payment_required",
      reason: "PAYMENT-SIGNATURE header is required"
    });
    expect(response.headers["payment-required"]).toBeTruthy();
  }, 20_000);

  it("does not release a paid report or upstream internals when settlement omits the Casper transaction hash", async () => {
    await withSettlementFacilitator({
      settleBody: { success: true, internalToken: "facilitator-secret-must-not-leak" }
    }, async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
      const paymentPayload = boundPaymentPayload(quote.body);

      const response = await request(app)
        .post(`/reports/buy/${quote.body.quoteId}`)
        .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
        .send({})
        .expect(402);

      expect(response.body).toMatchObject({
        error: "payment_required",
        reason: "payment_rejected"
      });
      expect(response.headers["payment-response"]).toBeTruthy();
      const paymentResponse = JSON.parse(Buffer.from(response.headers["payment-response"], "base64").toString("utf8"));
      expect(paymentResponse).toMatchObject({
        isValid: false,
        invalidReason: "missing_transaction_hash"
      });
      expect(JSON.stringify(paymentResponse)).not.toContain("facilitator-secret-must-not-leak");
      expect(paymentResponse).not.toHaveProperty("settle");
    });
  }, 20_000);

  it("does not release a paid report when settlement returns a malformed Casper transaction hash", async () => {
    await withSettlementFacilitator({ settleBody: { success: true, transaction: "not-a-casper-hash" } }, async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
      const paymentPayload = boundPaymentPayload(quote.body);

      const response = await request(app)
        .post(`/reports/buy/${quote.body.quoteId}`)
        .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
        .send({})
        .expect(402);

      const paymentResponse = JSON.parse(Buffer.from(response.headers["payment-response"], "base64").toString("utf8"));
      expect(paymentResponse).toMatchObject({
        isValid: false,
        invalidReason: "invalid_transaction_hash"
      });
    });
  }, 20_000);

  it("does not release a paid report when the payment payload uses the wrong x402 version", async () => {
    await withSettlementFacilitator({ settleBody: { success: true } }, async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
      const paymentPayload = {
        ...boundPaymentPayload(quote.body),
        x402Version: 1
      };

      const response = await request(app)
        .post(`/reports/buy/${quote.body.quoteId}`)
        .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
        .send({})
        .expect(402);

      const paymentResponse = JSON.parse(Buffer.from(response.headers["payment-response"], "base64").toString("utf8"));
      expect(paymentResponse).toMatchObject({
        isValid: false,
        invalidReason: "x402_version_mismatch"
      });
    });
  }, 20_000);

  it("does not release a paid report when the payment payload accepts a different requirement", async () => {
    await withSettlementFacilitator({ settleBody: { success: true } }, async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
      const paymentPayload = {
        ...boundPaymentPayload(quote.body),
        accepted: {
          ...quote.body.paymentRequirements[0],
          amount: "1"
        }
      };

      const response = await request(app)
        .post(`/reports/buy/${quote.body.quoteId}`)
        .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
        .send({})
        .expect(402);

      const paymentResponse = JSON.parse(Buffer.from(response.headers["payment-response"], "base64").toString("utf8"));
      expect(paymentResponse).toMatchObject({
        isValid: false,
        invalidReason: "payment_requirement_mismatch"
      });
    });
  }, 20_000);

  it("does not release a paid report when the payment payload targets a different resource", async () => {
    await withSettlementFacilitator({ settleBody: { success: true } }, async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
      const paymentPayload = {
        ...boundPaymentPayload(quote.body),
        resource: {
          ...quote.body.paymentResource,
          url: `${quote.body.paymentResource.url}/other`
        }
      };

      const response = await request(app)
        .post(`/reports/buy/${quote.body.quoteId}`)
        .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
        .send({})
        .expect(402);

      const paymentResponse = JSON.parse(Buffer.from(response.headers["payment-response"], "base64").toString("utf8"));
      expect(paymentResponse).toMatchObject({
        isValid: false,
        invalidReason: "payment_resource_mismatch"
      });
    });
  }, 20_000);

  it("confirms x402 settlement transactions through Casper RPC before releasing the report", async () => {
    const transactionHash = "4".repeat(64);
    const blockHash = "5".repeat(64);
    let confirmationCalls = 0;
    const rpc = await withRpcServer(async (requestBody) => {
      if (requestBody.method === "info_get_status") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {
            api_version: "2.0.0",
            protocol_version: "2.0.0",
            peers: [],
            last_added_block_info: {
              hash: "6".repeat(64),
              height: 8135708,
              timestamp: "2026-06-10T15:24:00.000Z"
            }
          }
        };
      }

      if (requestBody.method === "chain_get_block") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {
            block_with_signatures: {
              block: {
                hash: "7".repeat(64),
                header: {
                  height: 8135708,
                  timestamp: "2026-06-10T15:24:00.000Z",
                  era_id: 10,
                  protocol_version: "2.0.0",
                  state_root_hash: "8".repeat(64),
                  proposer: "9".repeat(64)
                },
                body: {
                  transactions: {}
                }
              }
            }
          }
        };
      }

      if (requestBody.method === "query_global_state") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          error: { code: -32003, message: "Token package state is unavailable in this fixture" }
        };
      }

      expect(requestBody.method).toBe("info_get_transaction");
      confirmationCalls += 1;
      expect(requestBody.params).toMatchObject({
        transaction_hash: { Version1: transactionHash }
      });

      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: matchingPaymentTransaction(transactionHash, {
          blockHash,
          blockHeight: 8135708
        })
      };
    });

    try {
      await withSettlementFacilitator({ settleBody: { success: true, transaction: transactionHash } }, async (facilitatorUrl) => {
        configureX402Payment(facilitatorUrl);
        process.env.CASPER_RPC_URL = rpc.url;
        process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
        process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
        const app = createReportApp();
        const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
        const paymentPayload = boundPaymentPayload(quote.body);

        const response = await request(app)
          .post(`/reports/buy/${quote.body.quoteId}`)
          .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
          .send({})
          .expect(200);

        expect(response.body.payment).toMatchObject({
          scheme: "x402",
          status: "settled",
          transactionHash,
          confirmation: {
            rpcUrl: rpc.url,
            method: "info_get_transaction",
            apiVersion: "2.0.0",
            executionState: "executed",
            blockHash,
            attempts: 1
          }
        });
        expect(confirmationCalls).toBe(1);
      });
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("waits longer than the generic HTTP timeout for Casper facilitator settlement", async () => {
    const transactionHash = "d".repeat(64);
    const rpc = await withExecutedPaymentRpc(transactionHash);

    try {
      await withSettlementFacilitator(
        {
          settleBody: { success: true, transaction: transactionHash },
          settleDelayMs: 5_100
        },
        async (facilitatorUrl) => {
          configureX402Payment(facilitatorUrl);
          process.env.CASPER_RPC_URL = rpc.url;
          process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
          process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
          const app = createReportApp();
          const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);

          const response = await request(app)
            .post(`/reports/buy/${quote.body.quoteId}`)
            .set("PAYMENT-SIGNATURE", encodePaymentPayload(boundPaymentPayload(quote.body)))
            .send({})
            .expect(200);

          expect(response.body.payment).toMatchObject({
            status: "settled",
            transactionHash
          });
        }
      );
    } finally {
      await rpc.close();
    }
  }, 15_000);

  it("does not release a report for an executed Casper transaction that differs from the signed payment", async () => {
    const transactionHash = "3".repeat(64);
    const rpc = await withRpcServer(async (requestBody) => {
      if (requestBody.method === "info_get_status") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {
            api_version: "2.0.0",
            last_added_block_info: { hash: "6".repeat(64), height: 8135708 }
          }
        };
      }
      if (requestBody.method === "chain_get_block") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {
            block_with_signatures: {
              block: {
                hash: "7".repeat(64),
                header: { height: 8135708 },
                body: { transactions: {} }
              }
            }
          }
        };
      }
      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: matchingPaymentTransaction(
          transactionHash,
          { blockHash: "5".repeat(64), blockHeight: 8135708 },
          { amount: "1" }
        )
      };
    });

    try {
      await withSettlementFacilitator(
        { settleBody: { success: true, transaction: transactionHash } },
        async (facilitatorUrl) => {
          configureX402Payment(facilitatorUrl);
          process.env.CASPER_RPC_URL = rpc.url;
          process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
          process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
          const app = createReportApp();
          const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);

          const response = await request(app)
            .post(`/reports/buy/${quote.body.quoteId}`)
            .set("PAYMENT-SIGNATURE", encodePaymentPayload(boundPaymentPayload(quote.body)))
            .send({})
            .expect(402);

          const paymentResponse = JSON.parse(
            Buffer.from(response.headers["payment-response"], "base64").toString("utf8")
          );
          expect(paymentResponse).toMatchObject({
            isValid: false,
            invalidReason: "settlement_transaction_mismatch"
          });
        }
      );
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("returns an already settled quote without settling the same payment twice", async () => {
    const transactionHash = "b".repeat(64);
    const rpc = await withExecutedPaymentRpc(transactionHash);
    let verifyCalls = 0;
    let settleCalls = 0;

    try {
      await withSettlementFacilitator(
        {
          settleBody: { success: true, transaction: transactionHash },
          onRequest: (path) => {
            if (path === "/verify") {
              verifyCalls += 1;
            }
            if (path === "/settle") {
              settleCalls += 1;
            }
          }
        },
        async (facilitatorUrl) => {
          configureX402Payment(facilitatorUrl);
          process.env.CASPER_RPC_URL = rpc.url;
          process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
          process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
          const app = createReportApp();
          const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
          const paymentPayload = boundPaymentPayload(quote.body);

          const first = await request(app)
            .post(`/reports/buy/${quote.body.quoteId}`)
            .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
            .send({})
            .expect(200);

          const second = await request(app)
            .post(`/reports/buy/${quote.body.quoteId}`)
            .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
            .send({})
            .expect(200);

          expect(second.body).toMatchObject({
            paymentReceiptHash: first.body.paymentReceiptHash,
            payment: {
              transactionHash
            }
          });
          expect(verifyCalls).toBe(1);
          expect(settleCalls).toBe(1);
        }
      );
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("coalesces concurrent retries for the same quote and payment", async () => {
    const transactionHash = "e".repeat(64);
    const rpc = await withExecutedPaymentRpc(transactionHash);
    let verifyCalls = 0;
    let settleCalls = 0;

    try {
      await withSettlementFacilitator(
        {
          settleBody: { success: true, transaction: transactionHash },
          settleDelayMs: 100,
          onRequest: (path) => {
            if (path === "/verify") verifyCalls += 1;
            if (path === "/settle") settleCalls += 1;
          }
        },
        async (facilitatorUrl) => {
          configureX402Payment(facilitatorUrl);
          process.env.CASPER_RPC_URL = rpc.url;
          process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
          process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
          const app = createReportApp();
          const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
          const paymentHeader = encodePaymentPayload(boundPaymentPayload(quote.body));
          const buy = () =>
            request(app)
              .post(`/reports/buy/${quote.body.quoteId}`)
              .set("PAYMENT-SIGNATURE", paymentHeader)
              .send({})
              .expect(200);

          const [first, second] = await Promise.all([buy(), buy()]);

          expect(second.body.paymentReceiptHash).toBe(first.body.paymentReceiptHash);
          expect(first.body.payment.transactionHash).toBe(transactionHash);
          expect(verifyCalls).toBe(1);
          expect(settleCalls).toBe(1);
        }
      );
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("does not release a second quote with a reused Casper settlement transaction hash", async () => {
    const transactionHash = "c".repeat(64);
    const rpc = await withExecutedPaymentRpc(transactionHash);

    try {
      await withSettlementFacilitator({ settleBody: { success: true, transaction: transactionHash } }, async (facilitatorUrl) => {
        configureX402Payment(facilitatorUrl);
        process.env.CASPER_RPC_URL = rpc.url;
        process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
        process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
        const app = createReportApp();
        const firstQuote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
        const secondQuote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT_B}`).expect(200);

        await request(app)
          .post(`/reports/buy/${firstQuote.body.quoteId}`)
          .set("PAYMENT-SIGNATURE", encodePaymentPayload(boundPaymentPayload(firstQuote.body)))
          .send({})
          .expect(200);

        const response = await request(app)
          .post(`/reports/buy/${secondQuote.body.quoteId}`)
          .set("PAYMENT-SIGNATURE", encodePaymentPayload(boundPaymentPayload(secondQuote.body)))
          .send({})
          .expect(402);

        const paymentResponse = JSON.parse(Buffer.from(response.headers["payment-response"], "base64").toString("utf8"));
        expect(paymentResponse).toMatchObject({
          isValid: false,
          invalidReason: "duplicate_transaction_hash"
        });
      });
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("does not release a paid report while the settlement transaction is still pending on Casper", async () => {
    const transactionHash = "a".repeat(64);
    const rpc = await withRpcServer(async (requestBody) => {
      if (requestBody.method === "info_get_status") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {
            api_version: "2.0.0",
            protocol_version: "2.0.0",
            peers: [],
            last_added_block_info: {
              hash: "6".repeat(64),
              height: 8135709,
              timestamp: "2026-06-10T15:25:00.000Z"
            }
          }
        };
      }

      if (requestBody.method === "chain_get_block") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {
            block_with_signatures: {
              block: {
                hash: "7".repeat(64),
                header: {
                  height: 8135709,
                  timestamp: "2026-06-10T15:25:00.000Z"
                },
                body: {
                  transactions: {}
                }
              }
            }
          }
        };
      }

      // Casper 2.0: a found-but-not-yet-executed transaction has null execution_info.
      return {
        jsonrpc: "2.0",
        id: requestBody.id,
          result: matchingPaymentTransaction(transactionHash, null)
      };
    });

    try {
      await withSettlementFacilitator({ settleBody: { success: true, transaction: transactionHash } }, async (facilitatorUrl) => {
        configureX402Payment(facilitatorUrl);
        process.env.CASPER_RPC_URL = rpc.url;
        process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
        process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
        const app = createReportApp();
        const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);
        const paymentPayload = boundPaymentPayload(quote.body);

        const response = await request(app)
          .post(`/reports/buy/${quote.body.quoteId}`)
          .set("PAYMENT-SIGNATURE", encodePaymentPayload(paymentPayload))
          .send({})
          .expect(402);

        const paymentResponse = JSON.parse(Buffer.from(response.headers["payment-response"], "base64").toString("utf8"));
        expect(paymentResponse).toMatchObject({
          isValid: false,
          invalidReason: "settlement_transaction_not_executed"
        });
      });
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("surfaces missing x402 configuration instead of releasing reports", async () => {
    const rpc = await withExecutedPaymentRpc("d".repeat(64));

    try {
      clearX402Payment();
      process.env.CASPER_RPC_URL = rpc.url;
      const app = createReportApp();
      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);

      expect(quote.body.paymentRequirements).toEqual([]);
      expect(quote.body.paymentConfigurationRequired).toBe(true);
      expect(quote.body.paymentConfigurationReason).toBe("x402_asset_package_hash_required");
      expect(quote.body.paymentReadiness).toMatchObject({
        status: "configuration_required",
        reason: "x402_asset_package_hash_required"
      });

      const response = await request(app).post(`/reports/buy/${quote.body.quoteId}`).send({}).expect(402);
      const paymentRequired = JSON.parse(Buffer.from(response.headers["payment-required"], "base64").toString("utf8"));

      expect(response.body).toMatchObject({
        error: "payment_required",
        reason: "x402_asset_package_hash_required"
      });
      expect(paymentRequired).toMatchObject({
        x402Version: 2,
        error: "x402_asset_package_hash_required",
        accepts: []
      });
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("rejects malformed payee addresses before advertising x402 payment requirements", async () => {
    const rpc = await withExecutedPaymentRpc("e".repeat(64));

    try {
      clearX402Payment();
      process.env.CASPER_RPC_URL = rpc.url;
      process.env.X402_ASSET_PACKAGE_HASH = "9".repeat(64);
      process.env.PAYEE_ADDRESS = "not-a-casper-account-hash";
      const app = createReportApp();

      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);

      expect(quote.body.paymentRequirements).toEqual([]);
      expect(quote.body.paymentConfigurationRequired).toBe(true);
      expect(quote.body.paymentConfigurationReason).toBe("payee_address_must_be_00_plus_64_hex_chars");
      expect(quote.body.paymentReadiness).toMatchObject({
        status: "configuration_required",
        reason: "payee_address_must_be_00_plus_64_hex_chars"
      });
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("rejects zero or non-canonical report prices before advertising payment", async () => {
    const rpc = await withExecutedPaymentRpc("e".repeat(64));

    try {
      clearX402Payment();
      process.env.CASPER_RPC_URL = rpc.url;
      process.env.X402_ASSET_PACKAGE_HASH = "9".repeat(64);
      process.env.PAYEE_ADDRESS = `00${"8".repeat(64)}`;
      process.env.AGENT_PAY_REPORT_AMOUNT = "0";
      process.env.X402_TOKEN_NAME = "Cep18x402";
      process.env.X402_TOKEN_VERSION = "1";
      process.env.X402_TOKEN_DECIMALS = "9";
      process.env.X402_TOKEN_SYMBOL = "X402";
      const app = createReportApp();

      const quote = await request(app).get(`/reports/quote?subject=${QUOTE_SUBJECT}`).expect(200);

      expect(quote.body.paymentRequirements).toEqual([]);
      expect(quote.body.paymentConfigurationReason).toBe(
        "agent_pay_report_amount_must_be_positive_u256_base_units"
      );
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("quotes subject-scoped evidence when ?subject= is a valid 64-hex package hash", async () => {
    const rpc = await withRpcServer(async (requestBody) => {
      // buildSubjectEvidence calls chain_get_block for latestBlock
      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          block_with_signatures: {
            block: {
              Version2: {
                hash: "7".repeat(64),
                header: {
                  height: 9000000,
                  timestamp: "2026-06-25T00:00:00.000Z"
                },
                body: { transactions: {} }
              }
            }
          }
        }
      };
    });

    try {
      clearX402Payment();
      process.env.CASPER_RPC_URL = rpc.url;
      const packageHash = "a".repeat(64);
      const app = createReportApp();

      const response = await request(app)
        .get(`/reports/quote?subject=${packageHash}`)
        .expect(200);

      expect(response.body.datasetRoot).toMatch(/^[0-9a-f]{64}$/);
      expect(Array.isArray(response.body.sourceSummary)).toBe(true);
      expect(response.body.sourceSummary.length).toBeGreaterThanOrEqual(1);
      const products = response.body.sourceSummary.map((s: { product: string }) => s.product);
      expect(products).toContain("Casper Token Authority");
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("does not inject canned fixture facts for known demo-era package hashes", async () => {
    const rpc = await withRpcServer(async () => ({
      jsonrpc: "2.0",
      id: "agent-pay-test",
      result: {
        block_with_signatures: {
          block: {
            Version2: {
              hash: "7".repeat(64),
              header: {
                height: 9000000,
                timestamp: "2026-06-25T00:00:00.000Z"
              },
              body: { transactions: {} }
            }
          }
        }
      }
    }));

    try {
      clearX402Payment();
      process.env.CASPER_RPC_URL = rpc.url;
      const formerFixtureHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01";
      const app = createReportApp();

      const response = await request(app)
        .get(`/reports/quote?subject=${formerFixtureHash}`)
        .expect(200);

      expect(response.body.sourceSummary.every((source: { network: string }) => source.network !== "casper-testnet-fixture")).toBe(true);
      expect(response.body.sourceSummary.flatMap((source: { facts: Record<string, unknown> }) => Object.keys(source.facts))).not.toEqual(
        expect.arrayContaining(["mintBurnEnabled", "holderCount", "topHolderPct"])
      );
    } finally {
      await rpc.close();
    }
  }, 20_000);

  it("returns 400 invalid_subject when ?subject= is malformed", async () => {
    const app = createReportApp();

    const response = await request(app)
      .get("/reports/quote?subject=not-a-hash")
      .expect(400);

    expect(response.body).toMatchObject({
      error: "invalid_subject"
    });
  });

  it("returns 400 subject_required when no subject is supplied", async () => {
    const app = createReportApp();

    const response = await request(app).get("/reports/quote").expect(400);

    expect(response.body).toMatchObject({ error: "subject_required" });
  });

  it("rejects an unsupported evidence network before reading any source", async () => {
    const response = await request(createReportApp())
      .get(`/reports/quote?subject=${QUOTE_SUBJECT}&network=casper:casper-test`)
      .expect(400);

    expect(response.body).toEqual({
      error: "invalid_evidence_network",
      allowed: ["casper-mainnet", "casper-testnet"]
    });
  });

  it("surfaces unavailable token-list discovery instead of returning an empty healthy list", async () => {
    delete process.env.CSPR_CLOUD_ACCESS_TOKEN;

    const response = await dispatchReportApp("/tokens", { host: "127.0.0.1:4021" });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      code: "source_unavailable",
      message: "CSPR.cloud token discovery is unavailable.",
      retryable: true,
      field: null,
      expected: "available CSPR.cloud token discovery source",
      received: null
    });
  });

  it("surfaces an unavailable CSPR.trade source instead of reporting a symbol as unlisted", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => {
      throw new Error("CSPR.trade unavailable in this fixture");
    }));

    const response = await dispatchReportApp(
      "/resolve?symbol=WCSPR",
      { host: "127.0.0.1:4021" }
    );

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      code: "source_unavailable",
      message: "CSPR.trade token discovery is unavailable.",
      retryable: true,
      field: null,
      expected: "available CSPR.trade token discovery source",
      received: null
    });
  });
});

async function dispatchReportApp(
  path: string,
  headers: Record<string, string>,
  options: { app?: ReturnType<typeof createReportApp>; method?: "GET" | "POST" } = {}
) {
  const app = options.app ?? createReportApp();
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
    const responseHeaders: Record<string, string> = {};
    let body = "";
    const requestLike = {
      method: options.method ?? "GET",
      url: path,
      headers,
      socket: { remoteAddress: "127.0.0.1" }
    };
    const responseLike = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      setHeader(name: string, value: string | number | readonly string[]) {
        responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
      },
      getHeader(name: string) {
        return responseHeaders[name.toLowerCase()];
      },
      removeHeader(name: string) {
        delete responseHeaders[name.toLowerCase()];
      },
      writeHead(status: number, headersToWrite?: Record<string, string>) {
        this.statusCode = status;
        this.headersSent = true;
        if (headersToWrite) {
          for (const [name, value] of Object.entries(headersToWrite)) {
            this.setHeader(name, value);
          }
        }
      },
      write(chunk: unknown) {
        body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: responseHeaders, body });
      }
    };

    app.handle(requestLike as never, responseLike as never, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve({ status: responseLike.statusCode, headers: responseHeaders, body });
      }
    });
  });
}

function supportedFacilitatorPayload() {
  return {
    kinds: [
      {
        x402Version: 2,
        scheme: "exact",
        network: "casper:casper-test",
        extra: { feePayer: "7".repeat(64) }
      }
    ],
    extensions: [],
    signers: { "casper:*": ["7".repeat(64)] }
  };
}

async function withSupportedFacilitator<T>(fn: (facilitatorUrl: string) => Promise<T>): Promise<T> {
  const server = createServer((request, response) => {
    if (request.url === "/supported") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          kinds: [
            {
              x402Version: 2,
              scheme: "exact",
              network: "casper:casper-test",
              extra: {
                feePayer: "7".repeat(64)
              }
            }
          ],
          extensions: [],
          signers: {
            "casper:*": ["7".repeat(64)]
          }
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Facilitator test server did not bind to a TCP port");
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withSettlementFacilitator<T>(
  input: {
    settleBody: unknown | (() => unknown);
    settleDelayMs?: number;
    onRequest?: (path: "/supported" | "/verify" | "/settle") => void;
  },
  fn: (facilitatorUrl: string) => Promise<T>
): Promise<T> {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/supported") {
      input.onRequest?.("/supported");
      response.end(
        JSON.stringify({
          kinds: [
            {
              x402Version: 2,
              scheme: "exact",
              network: "casper:casper-test",
              extra: {
                feePayer: "7".repeat(64)
              }
            }
          ],
          extensions: [],
          signers: {
            "casper:*": ["7".repeat(64)]
          }
        })
      );
      return;
    }
    if (request.url === "/verify") {
      input.onRequest?.("/verify");
      response.end(JSON.stringify({ isValid: true, payer: `00${"6".repeat(64)}` }));
      return;
    }
    if (request.url === "/settle") {
      input.onRequest?.("/settle");
      const settle = () => {
        response.end(JSON.stringify(typeof input.settleBody === "function" ? input.settleBody() : input.settleBody));
      };
      if (input.settleDelayMs) {
        setTimeout(settle, input.settleDelayMs);
      } else {
        settle();
      }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Facilitator test server did not bind to a TCP port");
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withRpcServer(
  handler: (requestBody: Record<string, any>) => Promise<Record<string, unknown>>
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    const requestBody = JSON.parse(await readRequestBody(request));
    const responseBody = await handler(requestBody);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("AgentPay RPC test server did not bind to a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function withExecutedPaymentRpc(transactionHash: string): Promise<{ url: string; close: () => Promise<void> }> {
  return withRpcServer(async (requestBody) => {
    if (requestBody.method === "info_get_status") {
      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          api_version: "2.0.0",
          protocol_version: "2.0.0",
          peers: [],
          last_added_block_info: {
            hash: "6".repeat(64),
            height: 8135710,
            timestamp: "2026-06-10T15:26:00.000Z"
          }
        }
      };
    }

    if (requestBody.method === "chain_get_block") {
      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          block_with_signatures: {
            block: {
              hash: "7".repeat(64),
              header: {
                height: 8135710,
                timestamp: "2026-06-10T15:26:00.000Z"
              },
              body: {
                transactions: {}
              }
            }
          }
        }
      };
    }

    return {
      jsonrpc: "2.0",
      id: requestBody.id,
      result: matchingPaymentTransaction(transactionHash, {
        blockHash: "5".repeat(64),
        blockHeight: 8135710
      })
    };
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function configureX402Payment(facilitatorUrl: string) {
  process.env.X402_ASSET_PACKAGE_HASH = "9".repeat(64);
  process.env.PAYEE_ADDRESS = `00${"8".repeat(64)}`;
  process.env.AGENT_PAY_REPORT_AMOUNT = "10000";
  process.env.AGENT_PAY_REPORT_ASSET = "CSPR";
  process.env.X402_NETWORK = "casper:casper-test";
  process.env.X402_FACILITATOR_URL = facilitatorUrl;
  process.env.X402_TOKEN_NAME = "Cep18x402";
  process.env.X402_TOKEN_VERSION = "1";
  process.env.X402_TOKEN_DECIMALS = "9";
  process.env.X402_TOKEN_SYMBOL = "CSPR";
}

function clearX402Payment() {
  delete process.env.X402_ASSET_PACKAGE_HASH;
  delete process.env.PAYEE_ADDRESS;
  delete process.env.AGENT_PAY_REPORT_AMOUNT;
  delete process.env.AGENT_PAY_REPORT_ASSET;
  delete process.env.X402_NETWORK;
  delete process.env.X402_FACILITATOR_URL;
  delete process.env.X402_TOKEN_NAME;
  delete process.env.X402_TOKEN_VERSION;
  delete process.env.X402_TOKEN_DECIMALS;
  delete process.env.X402_TOKEN_SYMBOL;
}

function boundPaymentPayload(quote: {
  paymentRequirements: [Record<string, unknown>, ...Record<string, unknown>[]];
  paymentResource: Record<string, unknown>;
}) {
  return buildX402PaymentSignature({
    requirement: quote.paymentRequirements[0] as never,
    resource: quote.paymentResource as never,
    signer: TEST_PAYMENT_SIGNER,
    now: TEST_PAYMENT_NOW,
    nonce: TEST_PAYMENT_NONCE
  }).paymentPayload;
}

const TEST_PAYMENT_SIGNER = createCasperSigner("secp256k1", new Uint8Array(32).fill(7));
const TEST_PAYMENT_NOW = Math.floor(Date.now() / 1_000);
const TEST_PAYMENT_NONCE = new Uint8Array(32).fill(4);

function matchingPaymentTransaction(
  transactionHash: string,
  execution: { blockHash: string; blockHeight: number } | null,
  overrides: { amount?: string } = {}
) {
  const built = buildX402PaymentSignature({
    requirement: {
      scheme: "exact",
      network: "casper:casper-test",
      asset: "9".repeat(64),
      amount: "10000",
      payTo: `00${"8".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Cep18x402", version: "1", symbol: "CSPR" }
    },
    resource: { url: "https://agentpay.invalid/report", description: "fixture", mimeType: "application/json" },
    signer: TEST_PAYMENT_SIGNER,
    now: TEST_PAYMENT_NOW,
    nonce: TEST_PAYMENT_NONCE
  });
  const authorization = built.authorization;
  const payload = built.paymentPayload.payload as {
    signature: string;
    publicKey: string;
  };
  return {
    api_version: "2.0.0",
    transaction: {
      Version1: {
        hash: transactionHash,
        payload: {
          chain_name: "casper-test",
          fields: {
            target: { Stored: { id: { ByPackageHash: { addr: "9".repeat(64) } } } },
            entry_point: { Custom: "transfer_with_authorization" },
            args: {
              Named: [
                ["from", keyArgument(authorization.from)],
                ["to", keyArgument(authorization.to)],
                ["amount", integerArgument("U256", overrides.amount ?? authorization.value)],
                ["valid_after", integerArgument("U64", authorization.validAfter)],
                ["valid_before", integerArgument("U64", authorization.validBefore)],
                ["nonce", byteListArgument(authorization.nonce)],
                ["public_key", { cl_type: "PublicKey", parsed: payload.publicKey }],
                ["signature", byteListArgument(payload.signature)]
              ]
            }
          }
        }
      }
    },
    execution_info: execution
      ? {
          block_hash: execution.blockHash,
          block_height: execution.blockHeight,
          execution_result: { Version2: { error_message: null } }
        }
      : null
  };
}

function keyArgument(address: string) {
  return { cl_type: "Key", parsed: `account-hash-${address.slice(2)}` };
}

function integerArgument(clType: "U64" | "U256", value: string) {
  return { cl_type: clType, parsed: value };
}

function byteListArgument(value: string) {
  return { cl_type: { List: "U8" }, parsed: [...Buffer.from(value, "hex")] };
}

function encodePaymentPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
