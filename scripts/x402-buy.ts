// AgentPay x402 buyer CLI.
//
// Runs the real two-stage flow against a running report API:
//   1. GET  /reports/quote                 -> live evidence quote + x402 requirement
//   2. POST /reports/buy/:quoteId           with a signed PAYMENT-SIGNATURE
// The report API forwards the payload to the configured Casper x402 facilitator (/verify, /settle) and
// only releases the paid report after the settlement transaction is confirmed executed on Casper.
//
// Usage:
//   REPORT_API_URL=http://127.0.0.1:4021 \
//   CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem \
//   tsx scripts/x402-buy.ts
//
// The report API process must already be configured with X402_ASSET_PACKAGE_HASH, PAYEE_ADDRESS,
// and any hosted facilitator auth token required by that URL; otherwise the quote returns the exact
// missing configuration and this CLI reports it instead of attempting a payment.

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildX402PaymentSignature,
  loadCasperSignerFromPem,
  x402SpendPolicyFromEnv,
  type PaymentRequirement,
  type PaymentResource
} from "./x402-buyer";

const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";

type Quote = {
  quoteId: string;
  paymentResource: PaymentResource;
  paymentRequirements: PaymentRequirement[];
  paymentConfigurationRequired?: boolean;
  paymentConfigurationReason?: string | null;
  paymentReadiness?: { status: string; reason: string | null };
};

async function main(): Promise<void> {
  const reportApiUrl = (process.env.REPORT_API_URL ?? "http://127.0.0.1:4021").replace(/\/+$/, "");
  const secretKeyPath = process.env.CASPER_SECRET_KEY_PATH;
  if (!secretKeyPath) {
    throw new Error("CASPER_SECRET_KEY_PATH is required to sign the x402 payment authorization");
  }

  const pem = await readFile(resolveFromCwd(secretKeyPath), "utf8");
  const signer = loadCasperSignerFromPem(pem);
  console.log(`payer account: ${signer.accountAddress} (${signer.algo})`);

  const quoteResponse = await fetch(`${reportApiUrl}/reports/quote`);
  const quote = (await quoteResponse.json()) as Quote;
  if (!quoteResponse.ok) {
    throw new Error(`quote failed (${quoteResponse.status}): ${JSON.stringify(quote)}`);
  }
  console.log(`quote: ${quote.quoteId}`);

  const requirement = quote.paymentRequirements?.[0];
  if (!requirement) {
    console.error(
      `x402 payment requirement is not available: ${quote.paymentConfigurationReason ?? quote.paymentReadiness?.reason ?? "unknown"}`
    );
    console.error(
      "Configure the report API with X402_ASSET_PACKAGE_HASH, PAYEE_ADDRESS and CSPR_CLOUD_ACCESS_TOKEN, then retry."
    );
    process.exitCode = 2;
    return;
  }

  const built = buildX402PaymentSignature({
    requirement,
    resource: quote.paymentResource,
    signer,
    policy: x402SpendPolicyFromEnv(process.env)
  });
  console.log(`signed authorization nonce ${built.authorization.nonce}, digest ${built.digestHex}`);

  const buyResponse = await fetch(`${reportApiUrl}/reports/buy/${quote.quoteId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [PAYMENT_SIGNATURE_HEADER]: built.header
    },
    body: JSON.stringify({})
  });
  const body = (await buyResponse.json()) as Record<string, unknown>;

  if (buyResponse.status === 200) {
    const payment = body.payment as { transactionHash?: string; confirmation?: unknown } | undefined;
    console.log("PAID REPORT RELEASED");
    console.log(`settlement transaction: ${payment?.transactionHash ?? "(missing)"}`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  console.error(`buy_report did not release the report (HTTP ${buyResponse.status}):`);
  console.error(JSON.stringify(body, null, 2));
  process.exitCode = 1;
}

function resolveFromCwd(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
