import { createServer, type IncomingMessage } from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createReportApp } from "../src/app";

const envSnapshot = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
});

describe("report API", () => {
  it("serves the agent skill with the request origin substituted for local development", async () => {
    delete process.env.AGENT_PAY_PUBLIC_ORIGIN;

    const response = await dispatchReportApp("/skill.md", { host: "agentpay.local:4021" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/markdown/);
    expect(response.body).toContain("# AgentPay");
    expect(response.body).toContain("http://agentpay.local:4021");
    expect(response.body).not.toContain("$AGENT_PAY_BASE_URL");
  });

  it("pins served skill examples to AGENT_PAY_PUBLIC_ORIGIN despite forged Host headers", async () => {
    process.env.AGENT_PAY_PUBLIC_ORIGIN = "https://agentpay.example/";

    const response = await dispatchReportApp("/skill", {
      host: "evil.example",
      "x-forwarded-proto": "https"
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain("https://agentpay.example");
    expect(response.body).not.toContain("evil.example");
    expect(response.body).not.toContain("$AGENT_PAY_BASE_URL");
  });

  it("quotes live Casper product evidence", async () => {
    await withSupportedFacilitator(async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();

      const response = await request(app).get("/reports/quote").expect(200);

      expect(response.body.quoteId).toMatch(/^agent-pay-live-/);
      expect(response.body.datasetRoot).toMatch(/^[0-9a-f]{64}$/);
      expect(response.body.sourceSummary.length).toBeGreaterThanOrEqual(2);
      expect(response.body.sourceSummary.map((source: { product: string }) => source.product)).toContain(
        "Casper Node RPC"
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
      expect(response.body.paymentResource.url).toContain(`/reports/buy/${response.body.quoteId}`);
    });
  }, 20_000);

  it("requires an x402 payment payload before releasing the report", async () => {
    await withSupportedFacilitator(async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get("/reports/quote").expect(200);

      const response = await request(app).post(`/reports/buy/${quote.body.quoteId}`).send({}).expect(402);

      expect(response.body).toMatchObject({
        error: "payment_required",
        reason: "PAYMENT-SIGNATURE header is required"
      });
      expect(response.body.accepts[0]).toMatchObject({ scheme: "exact" });
      expect(response.headers["payment-required"]).toBeTruthy();
    });
  }, 20_000);

  it("does not release a paid report when settlement omits the Casper transaction hash", async () => {
    await withSettlementFacilitator({ settleBody: { success: true } }, async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get("/reports/quote").expect(200);
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
    });
  }, 20_000);

  it("does not release a paid report when settlement returns a malformed Casper transaction hash", async () => {
    await withSettlementFacilitator({ settleBody: { success: true, transaction: "not-a-casper-hash" } }, async (facilitatorUrl) => {
      configureX402Payment(facilitatorUrl);
      const app = createReportApp();
      const quote = await request(app).get("/reports/quote").expect(200);
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
      const quote = await request(app).get("/reports/quote").expect(200);
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
      const quote = await request(app).get("/reports/quote").expect(200);
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
      const quote = await request(app).get("/reports/quote").expect(200);
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

      expect(requestBody.method).toBe("info_get_transaction");
      confirmationCalls += 1;
      expect(requestBody.params).toMatchObject({
        transaction_hash: { Version1: transactionHash }
      });

      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          api_version: "2.0.0",
          transaction: { hash: { Version1: transactionHash } },
          execution_info: {
            block_hash: blockHash,
            block_height: 8135708,
            execution_result: { Version2: { error_message: null } }
          }
        }
      };
    });

    try {
      await withSettlementFacilitator({ settleBody: { success: true, transaction: transactionHash } }, async (facilitatorUrl) => {
        configureX402Payment(facilitatorUrl);
        process.env.CASPER_RPC_URL = rpc.url;
        process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
        process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
        const app = createReportApp();
        const quote = await request(app).get("/reports/quote").expect(200);
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
          const quote = await request(app).get("/reports/quote").expect(200);
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
        const firstQuote = await request(app).get("/reports/quote").expect(200);
        const secondQuote = await request(app).get("/reports/quote").expect(200);

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
        result: {
          api_version: "2.0.0",
          transaction: { hash: { Version1: transactionHash } },
          execution_info: null
        }
      };
    });

    try {
      await withSettlementFacilitator({ settleBody: { success: true, transaction: transactionHash } }, async (facilitatorUrl) => {
        configureX402Payment(facilitatorUrl);
        process.env.CASPER_RPC_URL = rpc.url;
        process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
        process.env.CASPER_CONFIRMATION_DELAY_MS = "0";
        const app = createReportApp();
        const quote = await request(app).get("/reports/quote").expect(200);
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
      const quote = await request(app).get("/reports/quote").expect(200);

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

      const quote = await request(app).get("/reports/quote").expect(200);

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
        expect.arrayContaining(["mintAuthorityOpen", "supplyRenounced", "holderCount", "topHolderPct"])
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
});

async function dispatchReportApp(path: string, headers: Record<string, string>) {
  const app = createReportApp();
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
    const responseHeaders: Record<string, string> = {};
    let body = "";
    const requestLike = {
      method: "GET",
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
  input: { settleBody: unknown | (() => unknown); onRequest?: (path: "/supported" | "/verify" | "/settle") => void },
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
      response.end(JSON.stringify(typeof input.settleBody === "function" ? input.settleBody() : input.settleBody));
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
      result: {
        api_version: "2.0.0",
        transaction: { hash: { Version1: transactionHash } },
        execution_info: {
          block_hash: "5".repeat(64),
          block_height: 8135710,
          execution_result: { Version2: { error_message: null } }
        }
      }
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
  delete process.env.X402_TOKEN_SYMBOL;
}

function boundPaymentPayload(quote: {
  paymentRequirements: [Record<string, unknown>, ...Record<string, unknown>[]];
  paymentResource: Record<string, unknown>;
}) {
  return {
    x402Version: 2,
    accepted: quote.paymentRequirements[0],
    resource: quote.paymentResource,
    payload: "signed"
  };
}

function encodePaymentPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
