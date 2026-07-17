import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadCasperSignerFromPem,
  transferWithAuthorizationDigest
} from "@agent-pay/client";
import { chromium } from "playwright";
import { OperatorClient } from "../apps/cli/src/operatorClient.js";

const webUrl = normalizedBase(process.env.AGENTPAY_E2E_WEB_URL ?? "http://127.0.0.1:5174");
const apiUrl = normalizedBase(process.env.AGENT_PAY_API_URL ?? "http://127.0.0.1:4121");
const keyPath = process.env.CASPER_SECRET_KEY_PATH;
const mobile = process.env.AGENTPAY_E2E_VIEWPORT === "mobile";
const authMode = parseAuthMode(process.env.AGENTPAY_E2E_AUTH ?? "wallet");

if (!keyPath) throw new Error("CASPER_SECRET_KEY_PATH is required");

const signer = loadCasperSignerFromPem(await readFile(resolve(keyPath), "utf8"));
const token = authMode === "token"
  ? await new OperatorClient({ baseUrl: apiUrl }).createSession(signer)
  : null;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }
  });
  const browserErrors: string[] = [];
  const authTrace: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const sourceUrl = message.location().url;
    if (sourceUrl.startsWith("https://static.cloudflareinsights.com/beacon.min.js/")) return;
    browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/v1/auth")) authTrace.push(`request ${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.url().includes("/v1/auth")) authTrace.push(`response ${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/v1/auth")) {
      authTrace.push(`failed ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`);
    }
  });

  if (authMode === "wallet") {
    await page.exposeFunction("agentPaySignMessage", async (message: unknown, signingPublicKey: unknown) => {
      assert.equal(typeof message, "string", "Wallet received a non-string login challenge");
      assert.equal(signingPublicKey, signer.publicKeyHex, "Wallet was asked to sign with another Casper key");
      const bytes = new TextEncoder().encode(`Casper Message:\n${message}`);
      return Buffer.from(await signer.sign(bytes)).toString("hex");
    });
    await page.exposeFunction("agentPaySignTypedData", async (params: unknown, signingPublicKey: unknown) => {
      assert.equal(signingPublicKey, signer.publicKeyHex, "Wallet was asked to sign with another Casper key");
      const root = record(params, "typed-data signing parameters");
      const typedData = record(root.typedData, "typedData");
      const domain = record(typedData.domain, "typedData.domain");
      const message = record(typedData.message, "typedData.message");
      const types = record(typedData.types, "typedData.types");
      assert.equal(typedData.primaryType, "TransferWithAuthorization");
      assert.deepEqual(types.TransferWithAuthorization, [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]);
      const digest = transferWithAuthorizationDigest({
        tokenName: stringField(domain.name, "domain.name"),
        tokenVersion: stringField(domain.version, "domain.version"),
        network: stringField(domain.chain_name, "domain.chain_name"),
        assetPackageHash: unprefixedHex(domain.contract_package_hash, "domain.contract_package_hash"),
        from: unprefixedHex(message.from, "message.from"),
        to: unprefixedHex(message.to, "message.to"),
        value: uintString(message.value, "message.value"),
        validAfter: uintString(message.validAfter, "message.validAfter"),
        validBefore: uintString(message.validBefore, "message.validBefore"),
        nonceHex: unprefixedHex(message.nonce, "message.nonce")
      });
      const signature = Buffer.from(await signer.sign(digest)).toString("hex");
      const digestHex = Buffer.from(digest).toString("hex");
      return {
        cancelled: false,
        signature,
        signatureHex: signature,
        digest: `0x${digestHex}`,
        publicKey: signer.publicKeyHex,
        error: null
      };
    });
    // Use browser-native source here. Passing a TypeScript callback through
    // Playwright can strand transpiler helpers outside the serialized function.
    await page.addInitScript({
      content: `
        Object.defineProperty(window, "CasperWalletProvider", {
          configurable: true,
          value: function () {
            return {
              requestConnection: async function () { return true; },
              getActivePublicKey: async function () { return ${JSON.stringify(signer.publicKeyHex)}; },
              signMessage: async function (message, signingPublicKey) {
                return {
                  cancelled: false,
                  signatureHex: await window.agentPaySignMessage(message, signingPublicKey)
                };
              },
              getActivePublicKeySupports: async function () {
                return ["sign-message", "sign-typed-data-eip712"];
              },
              signTypedData: async function (params, signingPublicKey) {
                return await window.agentPaySignTypedData(params, signingPublicKey);
              }
            };
          }
        });
      `
    });
  }

  await page.goto(`${webUrl}/audit`, { waitUntil: "networkidle" });
  if (authMode === "wallet") {
    const challengeResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/v1/auth/challenges")
    );
    const sessionResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/v1/auth/sessions")
    );
    await page.getByRole("button", { name: "Connect Casper Wallet" }).click();
    let challenge;
    let session;
    try {
      [challenge, session] = await Promise.all([challengeResponse, sessionResponse]);
    } catch (cause) {
      const authentication = await page.getByRole("region", { name: "Authentication" })
        .innerText()
        .catch(() => "Authentication card is no longer visible");
      throw new Error([
        `Wallet UI authentication failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        `Network trace: ${authTrace.join(" | ") || "no auth request"}`,
        `Authentication UI: ${authentication}`,
        `Browser errors: ${browserErrors.join(" | ") || "none"}`
      ].join("\n"));
    }
    assert.equal(challenge.status(), 201, `Wallet challenge failed: ${await challenge.text()}`);
    assert.equal(session.status(), 201, `Wallet session failed: ${await session.text()}`);
    await page.getByText("Casper Wallet connected. Your session stays in this tab.").waitFor();
  } else {
    assert.ok(token, "Token authentication did not create a session");
    await page.getByText("Use an AgentPay token instead", { exact: true }).click();
    const tokenInput = page.getByRole("textbox", { name: "AgentPay token" });
    await tokenInput.fill(token);
    await tokenInput.press("Enter");
    await page.getByText("AgentPay token active for this tab.").waitFor();
  }

  const quoteResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname.endsWith("/reports/quote");
  });
  await page.getByRole("button", { name: /use agentpay's own charge/i }).click();
  const quoteResponse = await quoteResponsePromise;
  assert.equal(quoteResponse.status(), 200, "The live AgentPay charge shortcut must return a quote");
  const quote = await quoteResponse.json() as Quote;

  const serviceInput = page.getByRole("textbox", { name: "Service URL" });
  await page.waitForFunction((expectedUrl) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Service URL"]');
    return input?.value === expectedUrl;
  }, quote.paymentResource.url);
  assert.equal(await serviceInput.inputValue(), quote.paymentResource.url);
  assert.equal(await page.getByRole("combobox", { name: "HTTP method" }).inputValue(), "POST");
  const probeResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname.endsWith("/v1/probes");
  });
  await page.getByRole("button", { name: "Read charge" }).click();
  const probeResponse = await probeResponsePromise;
  const probeResponseBody = await probeResponse.text();
  const charge = page.getByRole("region", { name: "Charge terms" });
  await page.locator([
    'section[aria-label="Charge terms"][data-step-state="success"]',
    'section[aria-label="Charge terms"][data-step-state="error"]'
  ].join(", ")).waitFor({ timeout: 30_000 });
  const chargeState = await charge.getAttribute("data-step-state");
  assert.equal(
    chargeState,
    "success",
    `Reading the charge failed (${probeResponse.status()} ${probeResponseBody}):\n${await charge.innerText()}`
  );
  const chargeText = await charge.innerText();
  assert.match(chargeText, new RegExp(`${quote.amount}\\s+smallest units`));
  assert.match(chargeText, new RegExp(`\\b${quote.asset}\\b`));

  const initialCheckResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname.endsWith("/v1/checks");
  });
  await page.getByRole("button", { name: "Run check" }).click();
  const initialCheckResponse = await initialCheckResponsePromise;
  if (initialCheckResponse.status() !== 201) {
    throw new Error(`Initial check failed: ${await initialCheckResponse.text()}`);
  }
  const initialCheck = await initialCheckResponse.json() as CheckResponse;
  let reasonCodes = new Set(initialCheck.check.decision.reasons.map((reason) => reason.code));
  const decision = page.getByRole("region", { name: "Decision" });
  await decision.getByText(initialCheck.check.decision.verdict.toUpperCase(), { exact: true })
    .first()
    .waitFor({ timeout: 30_000 });
  await decision.getByText(/buyer has not prepared the payment details needed for signing/i).first().waitFor();

  let providerRuleSaved = false;
  let paymentRulesSaved = false;
  let paymentDetailsPrepared = false;
  let finalVerdict = "review";
  if (authMode === "wallet") {
    if (reasonCodes.has("provider_unapproved")) {
      const providerAction = page.getByRole("region", { name: "Operator action" });
      const actionChallengePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname.endsWith("/v1/auth/challenges");
      });
      const providerDecisionPromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname.endsWith("/v1/provider-decisions");
      });
      await providerAction.getByRole("button", { name: "Approve this provider", exact: true }).click();
      const [actionChallenge, providerDecisionResponse] = await Promise.all([
        actionChallengePromise,
        providerDecisionPromise
      ]);
      if (actionChallenge.status() !== 201) {
        throw new Error(`Provider challenge failed: ${await actionChallenge.text()}`);
      }
      if (providerDecisionResponse.status() !== 201) {
        throw new Error(`Provider approval failed: ${await providerDecisionResponse.text()}`);
      }
      await page.getByText(/Provider approved\. Run the check again/i).waitFor();
      providerRuleSaved = true;

      const recheckResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname.endsWith("/v1/checks");
      });
      await providerAction.getByRole("button", { name: "Run the check again", exact: true }).click();
      const recheckResponse = await recheckResponsePromise;
      if (recheckResponse.status() !== 201) {
        throw new Error(`Check after provider approval failed: ${await recheckResponse.text()}`);
      }
      const recheck = await recheckResponse.json() as CheckResponse;
      reasonCodes = new Set(recheck.check.decision.reasons.map((reason) => reason.code));
      assert.equal(
        reasonCodes.has("provider_unapproved"),
        false,
        "The signed provider approval was not applied to the new check"
      );
    }

    if (reasonCodes.has("policy_cap_missing") || reasonCodes.has("policy_daily_cap_exceeded")) {
      const paymentRules = page.getByRole("region", { name: "Payment rules" });
      await paymentRules.getByRole("button", { name: "Save daily limit", exact: true }).waitFor();
      const limitInput = paymentRules.getByRole("textbox", { name: /Daily limit in/i });
      const limitLabel = await limitInput.getAttribute("aria-label") ?? "";
      await limitInput.fill(
        /smallest token units/i.test(limitLabel)
          ? (BigInt(quote.amount) * 100n).toString()
          : "1"
      );
      const policyChallengePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname.endsWith("/v1/auth/challenges");
      });
      const policyRevisionPromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname.endsWith("/v1/policies/revisions");
      });
      await paymentRules.getByRole("button", { name: "Save daily limit", exact: true }).click();
      const [policyChallenge, policyRevisionResponse] = await Promise.all([
        policyChallengePromise,
        policyRevisionPromise
      ]);
      if (policyChallenge.status() !== 201) {
        throw new Error(`Policy challenge failed: ${await policyChallenge.text()}`);
      }
      if (policyRevisionResponse.status() !== 201) {
        throw new Error(`Payment policy failed: ${await policyRevisionResponse.text()}`);
      }
      await paymentRules.getByText(/Daily limit saved\. Run the check again/i).waitFor();
      paymentRulesSaved = true;

      const policyRecheckResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname.endsWith("/v1/checks");
      });
      await paymentRules.getByRole("button", { name: "Run the check again", exact: true }).click();
      const policyRecheckResponse = await policyRecheckResponsePromise;
      if (policyRecheckResponse.status() !== 201) {
        throw new Error(`Check after payment policy failed: ${await policyRecheckResponse.text()}`);
      }
      const policyRecheck = await policyRecheckResponse.json() as CheckResponse;
      reasonCodes = new Set(policyRecheck.check.decision.reasons.map((reason) => reason.code));
      assert.equal(
        reasonCodes.has("policy_cap_missing") || reasonCodes.has("policy_daily_cap_exceeded"),
        false,
        "The signed daily payment limit was not applied to the new check"
      );
    }

    const chargeSection = page.getByRole("region", { name: "Charge terms" });
    await chargeSection.getByRole("button", { name: "Prepare payment details", exact: true }).click();
    await chargeSection.getByText(/Payment details ready\. Run the check before they expire/i).waitFor();
    paymentDetailsPrepared = true;

    const finalCheckResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname.endsWith("/v1/checks");
    });
    await decision.getByRole("button", { name: "Run check again", exact: true }).click();
    const finalCheckResponse = await finalCheckResponsePromise;
    if (finalCheckResponse.status() !== 201) {
      throw new Error(`Final prepared check failed: ${await finalCheckResponse.text()}`);
    }
    const finalCheck = await finalCheckResponse.json() as CheckResponse;
    finalVerdict = finalCheck.check.decision.verdict;
    assert.equal(
      finalCheck.check.decision.reasons.some((reason) => reason.code === "authorization_required"),
      false,
      "The locally prepared payment details were not applied to the final check"
    );
    assert.equal(finalVerdict, "pay", "The fully prepared safe charge did not reach PAY");
    await decision.getByText("PAY", { exact: true }).first().waitFor();
    await page.getByRole("region", { name: "Signing handoff" }).waitFor();
  }

  const blockedQuoteResponse = await fetch(quote.paymentResource.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    redirect: "error"
  });
  assert.equal(blockedQuoteResponse.status, 402, "The pre-payment check must not pay the quote");
  await blockedQuoteResponse.body?.cancel();

  let walletPaymentSent = false;
  let settlementTransactionHash: string | null = null;
  let settlementVerdict: string | null = null;
  let receiptRecorded = false;
  let receiptAnchored = false;
  let receiptAnchorTransactionHash: string | null = null;
  if (authMode === "wallet" && finalVerdict === "pay") {
    const signing = page.getByRole("region", { name: "Signing handoff" });
    const paidResponsePromise = page.waitForResponse((response) =>
      response.url() === quote.paymentResource.url &&
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["payment-signature"])
    , { timeout: 180_000 });
    const observationResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname.endsWith("/response-observations");
    }, { timeout: 180_000 }).then(
      (response) => ({ response }),
      (error: unknown) => ({ error })
    );
    await signing.getByRole("button", { name: "Pay with Casper Wallet", exact: true }).click();
    const paidResponse = await paidResponsePromise;
    assert.notEqual(paidResponse.status(), 402, "The wallet-signed request was still rejected as unpaid");
    assert.ok(paidResponse.status() >= 200 && paidResponse.status() < 300, `Paid service returned ${paidResponse.status()}`);
    settlementTransactionHash = transactionHashFromPaymentResponse(
      await paidResponse.headerValue("payment-response")
    );
    assert.ok(settlementTransactionHash, "Paid service omitted a valid Casper transaction hash");
    walletPaymentSent = true;

    const observed = await observationResponsePromise;
    if ("error" in observed) throw observed.error;
    const observationResponse = observed.response;
    assert.ok(
      observationResponse.status() === 200 || observationResponse.status() === 201,
      `Response observation failed: ${await observationResponse.text()}`
    );
    await page.locator('section[aria-label="Settlement verdict"][data-verdict="match"]').waitFor({
      timeout: 180_000
    });
    settlementVerdict = "match";
    await page.locator('section[aria-label="Receipt"][data-step-state="success"]').waitFor({
      timeout: 60_000
    });
    receiptRecorded = true;
    const casperRecord = page.locator(
      '[aria-label="Casper receipt record"][data-anchor="anchored"]'
    );
    await casperRecord.waitFor({ timeout: 180_000 });
    const anchorHref = await casperRecord.getByRole("link", { name: "cspr.live (Testnet)" })
      .getAttribute("href");
    receiptAnchorTransactionHash = anchorHref?.match(/[0-9a-f]{64}/i)?.[0]?.toLowerCase() ?? null;
    assert.ok(receiptAnchorTransactionHash, "Anchored receipt omitted its Casper transaction hash");
    receiptAnchored = true;
  }
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);

  const horizontalOverflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  );
  assert.ok(horizontalOverflow <= 1, `Page has ${horizontalOverflow}px of horizontal overflow`);

  const screenshot = mobile
    ? "/tmp/agentpay-auditor-e2e-mobile.png"
    : "/tmp/agentpay-auditor-e2e.png";
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: screenshot, fullPage: true, scale: "css" });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    verdict: finalVerdict,
    quoteId: quote.quoteId,
    paymentResource: quote.paymentResource.url,
    unpaidStatus: blockedQuoteResponse.status,
    authMode,
    providerRuleSaved,
    paymentRulesSaved,
    paymentDetailsPrepared,
    walletPaymentSent,
    settlementTransactionHash,
    settlementVerdict,
    receiptRecorded,
    receiptAnchored,
    receiptAnchorTransactionHash,
    viewport: mobile ? "mobile" : "desktop",
    horizontalOverflow,
    screenshot
  })}\n`);
} finally {
  await browser.close();
}

type Quote = {
  quoteId: string;
  amount: string;
  asset: string;
  paymentResource: { url: string };
};

type CheckResponse = {
  check: {
    decision: {
      verdict: string;
      reasons: Array<{ code: string }>;
    };
  };
};

function normalizedBase(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseAuthMode(value: string): "wallet" | "token" {
  if (value === "wallet" || value === "token") return value;
  throw new Error("AGENTPAY_E2E_AUTH must be wallet or token");
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringField(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  return value;
}

function unprefixedHex(value: unknown, label: string): string {
  const normalized = stringField(value, label).replace(/^0x/i, "").toLowerCase();
  assert.match(normalized, /^[0-9a-f]+$/, `${label} must be hexadecimal`);
  return normalized;
}

function uintString(value: unknown, label: string): string {
  const encoded = stringField(value, label);
  assert.match(encoded, /^(?:0x[0-9a-f]+|[0-9]+)$/i, `${label} must encode an unsigned integer`);
  return BigInt(encoded).toString();
}

function transactionHashFromPaymentResponse(value: string | null): string | null {
  if (!value) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    try {
      decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
  const root = decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : null;
  for (const candidate of [root?.transactionHash, root?.transaction_hash, root?.txHash, root?.transaction]) {
    if (typeof candidate === "string" && /^[0-9a-f]{64}$/i.test(candidate)) return candidate.toLowerCase();
  }
  for (const key of ["payment", "settlement", "result"]) {
    const nested = root?.[key];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
    const record = nested as Record<string, unknown>;
    for (const candidate of [record.transactionHash, record.transaction_hash, record.txHash, record.transaction]) {
      if (typeof candidate === "string" && /^[0-9a-f]{64}$/i.test(candidate)) return candidate.toLowerCase();
    }
  }
  return null;
}
