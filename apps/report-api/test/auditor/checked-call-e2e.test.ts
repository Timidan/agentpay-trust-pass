import { createServer, type Server } from "node:http";
import {
  AgentPayHttpClient,
  PaymentAuditError,
  checkedX402Call,
  createCasperSigner
} from "@agent-pay/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_TOKEN,
  ASSET,
  FINALIZED_TRANSACTION_RESULT,
  NOW,
  PAYEE,
  TRANSACTION_HASH,
  createPaymentAuditContext,
  type PaymentAuditContext
} from "./payment-audit-fixture.js";

type PaidAuthorization = {
  signature: string;
  publicKey: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
};

const servers: Server[] = [];
const contexts: PaymentAuditContext[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  for (const context of contexts.splice(0)) context.repository.close();
});

describe("checked x402 call over HTTP", () => {
  it("runs challenge, PAY, local signing, settlement verification, observation, and receipt creation", async () => {
    const signer = createCasperSigner("ed25519", new Uint8Array(32).fill(7));
    let publishTransaction: ((result: unknown) => void) | null = null;
    let unsignedRequests = 0;
    let signedRequests = 0;

    const paymentService = createServer((request, response) => {
      const paymentHeader = request.headers["payment-signature"];
      if (typeof paymentHeader !== "string") {
        unsignedRequests += 1;
        response.writeHead(402, {
          "content-type": "application/json",
          "payment-required": Buffer.from(JSON.stringify(paymentRequired(serviceUrl(paymentService))), "utf8").toString("base64")
        });
        response.end(JSON.stringify({ error: "payment_required" }));
        return;
      }

      signedRequests += 1;
      const payment = parsePaidAuthorization(paymentHeader);
      if (!publishTransaction) throw new Error("Payment audit context is not ready");
      publishTransaction(transactionResult(payment));
      response.writeHead(200, {
        "content-type": "application/json",
        "payment-response": JSON.stringify({ transactionHash: TRANSACTION_HASH })
      });
      response.end(JSON.stringify({ answer: "paid" }));
    });
    await listen(paymentService);
    servers.push(paymentService);

    const context = createPaymentAuditContext(FINALIZED_TRANSACTION_RESULT, undefined, {
      payerPublicKey: signer.publicKeyHex,
      providerOrigin: new URL(serviceUrl(paymentService)).origin,
      providerResourcePathPrefix: "/v1/speak"
    });
    contexts.push(context);
    publishTransaction = context.setTransactionResult;

    const apiServer = createServer(context.app);
    await listen(apiServer);
    servers.push(apiServer);
    const api = new AgentPayHttpClient({ baseUrl: serviceUrl(apiServer), token: AGENT_TOKEN });

    let result;
    try {
      result = await checkedX402Call({
        url: `${serviceUrl(paymentService)}/v1/speak`,
        method: "POST",
        body: { text: "AgentPay integration test" },
        signer,
        api,
        now: () => new Date(NOW),
        nonce: new Uint8Array(32).fill(9),
        settlementAttempts: 1
      });
    } catch (error) {
      if (error instanceof PaymentAuditError && error.checkId) {
        const check = context.repository.getCheck(error.checkId);
        throw new Error(`Checked call failed: ${JSON.stringify(check?.decision.reasons ?? [])}`, { cause: error });
      }
      throw error;
    }

    expect(result.check.decision.verdict).toBe("pay");
    expect(result.settlement.proof.verdict).toBe("match");
    expect(result.receipt.checkId).toBe(result.check.id);
    expect(result.receipt.settlement.transactionHash).toBe(TRANSACTION_HASH);
    expect(await result.response.json()).toEqual({ answer: "paid" });
    expect(unsignedRequests).toBe(1);
    expect(signedRequests).toBe(1);

    const stored = await api.getReceiptRecord(result.receipt.receiptId);
    expect(stored.receipt.receiptHash).toBe(result.receipt.receiptHash);
    expect(stored.anchorState.status).toBe("off_chain_verified");
  });
});

function paymentRequired(url: string): Record<string, unknown> {
  return {
    x402Version: 2,
    resource: {
      url: `${url}/v1/speak`,
      description: "Deterministic text service",
      mimeType: "application/json"
    },
    accepts: [{
      scheme: "exact",
      network: "casper:casper-test",
      asset: ASSET,
      amount: "100000000",
      payTo: PAYEE,
      maxTimeoutSeconds: 900,
      extra: {
        name: "Casper X402 Token",
        version: "1",
        decimals: "9",
        symbol: "X402"
      }
    }]
  };
}

function parsePaidAuthorization(header: string): PaidAuthorization {
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
    payload?: unknown;
  };
  const payload = decoded.payload as Partial<PaidAuthorization> | undefined;
  if (
    !payload ||
    typeof payload.signature !== "string" ||
    typeof payload.publicKey !== "string" ||
    typeof payload.authorization !== "object" ||
    payload.authorization === null
  ) {
    throw new TypeError("Paid request contained an invalid x402 payload");
  }
  return payload as PaidAuthorization;
}

function transactionResult(payment: PaidAuthorization): unknown {
  type Argument = { parsed: unknown };
  type CapturedResult = {
    transaction: {
      Version1: {
        hash: string;
        payload: {
          initiator_addr: { PublicKey: string };
          fields: {
            args: { Named: Array<[string, Argument]> };
          };
        };
      };
    };
    execution_info: {
      execution_result: { Version2: { initiator: { PublicKey: string } } };
    };
  };
  const result = structuredClone(FINALIZED_TRANSACTION_RESULT) as CapturedResult;
  const version = result.transaction.Version1;
  version.hash = TRANSACTION_HASH;
  version.payload.initiator_addr.PublicKey = payment.publicKey;
  result.execution_info.execution_result.Version2.initiator.PublicKey = payment.publicKey;
  const args = new Map(version.payload.fields.args.Named);
  setParsed(args, "from", `account-hash-${payment.authorization.from.slice(2)}`);
  setParsed(args, "to", `account-hash-${payment.authorization.to.slice(2)}`);
  setParsed(args, "amount", payment.authorization.value);
  setParsed(args, "valid_after", payment.authorization.validAfter);
  setParsed(args, "valid_before", payment.authorization.validBefore);
  setParsed(args, "nonce", hexBytes(payment.authorization.nonce));
  setParsed(args, "public_key", payment.publicKey);
  setParsed(args, "signature", hexBytes(payment.signature));
  return result;
}

function setParsed(args: Map<string, { parsed: unknown }>, name: string, value: unknown): void {
  const argument = args.get(name);
  if (!argument) throw new Error(`Captured Casper transaction omitted ${name}`);
  argument.parsed = value;
}

function hexBytes(value: string): number[] {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new TypeError("Expected an even-length hex string");
  return [...Buffer.from(value, "hex")];
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function serviceUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server is not listening");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
