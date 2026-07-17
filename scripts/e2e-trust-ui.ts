import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = normalizedBase(process.env.AGENTPAY_E2E_WEB_URL ?? "http://127.0.0.1:5174");
const reportApiUrl = normalizedBase(process.env.AGENT_PAY_API_URL ?? "http://127.0.0.1:4121");
const subject = process.env.AGENTPAY_E2E_SUBJECT ?? "WCSPR";
const outputDir = process.env.AGENTPAY_E2E_OUTPUT_DIR ?? "/tmp/agentpay-trust-e2e";
const timeoutMs = Number(process.env.AGENTPAY_E2E_TIMEOUT_MS ?? 480_000);
const mobile = process.env.AGENTPAY_E2E_VIEWPORT === "mobile";

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  const browserErrors: string[] = [];
  const unexpectedResponses: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const sourceUrl = message.location().url;
    if (sourceUrl.startsWith("https://static.cloudflareinsights.com/beacon.min.js/")) return;
    if (!/Failed to load resource:.*\b402\b/i.test(text)) browserErrors.push(text);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.status() !== 402) {
      unexpectedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await page.goto(`${baseUrl}/check`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Check a token before you buy it." }).waitFor();
  await page.getByRole("textbox", { name: "Token symbol or package hash" }).fill(subject);

  const assessmentResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/tools/assess_subject"),
    { timeout: timeoutMs }
  );
  await page.getByRole("button", { name: "Check this token" }).click();
  const assessmentResponse = await assessmentResponsePromise;
  const assessmentText = await assessmentResponse.text();
  assert.equal(
    assessmentResponse.status(),
    200,
    `The paid token assessment failed (${assessmentResponse.status()}): ${assessmentText}`
  );
  const verdict = JSON.parse(assessmentText) as Verdict;

  await page.getByLabel(`Verdict: ${verdict.aspect}`).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_200);
  assert.match(verdict.decisionTxHash, /^[0-9a-f]{64}$/i);
  assert.match(verdict.settlementTxHash, /^[0-9a-f]{64}$/i);
  assert.equal(verdict.evidenceNetwork, "casper-mainnet");
  assert.equal(verdict.publicationProof.reportHash.length, 64);
  assert.equal(verdict.publicationProof.datasetRoot, verdict.datasetRoot);
  assert.equal(verdict.publicationProof.paymentReceiptHash, verdict.paymentReceiptHash);
  assert.ok(verdict.passed.length >= 1, "WCSPR must expose at least one check that ran and passed");
  assert.ok(
    verdict.notChecked.length <= 3,
    `WCSPR returned ${verdict.notChecked.length} unavailable checks; expected the public mint check to run`
  );

  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
  );
  assert.ok(overflow <= 1, `Token result has ${overflow}px of horizontal overflow`);
  await page.screenshot({ path: `${outputDir}/token-result.png`, fullPage: true, scale: "css" });

  const shareResponsesPromise = Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === `${reportApiUrl}/card`,
      { timeout: 60_000 }
    ),
    page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === `${reportApiUrl}/feed/share`,
      { timeout: 60_000 }
    )
  ]);
  await page.getByRole("button", { name: "Share" }).click();
  const [cardResponse, shareResponse] = await shareResponsesPromise;
  const cardText = await cardResponse.text();
  assert.equal(cardResponse.status(), 200, `The proof-verified card was rejected: ${cardText}`);
  const card = JSON.parse(cardText) as { id: string };
  assert.match(card.id, /^card-[0-9a-f]{32}$/i);

  assert.equal(shareResponse.status(), 200, `Publishing the verified card failed: ${await shareResponse.text()}`);
  await page.getByRole("button", { name: /Shared \/ link copied/i }).waitFor();

  const feedResponse = await fetch(`${reportApiUrl}/feed`);
  assert.equal(feedResponse.status, 200);
  const feed = await feedResponse.json() as { entries: FeedEntry[] };
  const entry = feed.entries.find((item) => item.id === card.id);
  assert.ok(entry, "The proof-verified card did not appear in the public feed");
  assert.equal(entry.aspect, verdict.aspect);
  assert.equal(entry.subjectShortHash.toLowerCase(), verdict.subject.packageHash.slice(0, 8).toLowerCase());

  const imageResponse = await fetch(`${reportApiUrl}/card/${card.id}.png`);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get("content-type") ?? "", /^image\/(?:png|svg\+xml)/);
  assert.ok((await imageResponse.arrayBuffer()).byteLength > 100, "Published card image is empty");

  await page.goto(`${baseUrl}/feed`, { waitUntil: "networkidle" });
  await page.getByRole("link", {
    name: new RegExp(`${verdict.aspect}`, "i")
  }).first().waitFor();
  await page.screenshot({ path: `${outputDir}/public-feed.png`, fullPage: true, scale: "css" });

  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
  assert.deepEqual(unexpectedResponses, [], `Unexpected HTTP responses: ${unexpectedResponses.join(" | ")}`);

  const result = {
    ok: true,
    subject,
    aspect: verdict.aspect,
    passed: verdict.passed,
    notChecked: verdict.notChecked,
    settlementTxHash: verdict.settlementTxHash,
    decisionTxHash: verdict.decisionTxHash,
    decisionHashKind: verdict.publicationProof.hashKind,
    cardId: card.id,
    feedEntries: feed.entries.length,
    viewport: mobile ? "mobile" : "desktop",
    overflow,
    screenshots: [`${outputDir}/token-result.png`, `${outputDir}/public-feed.png`]
  };
  await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await browser.close();
}

type Verdict = {
  aspect: "CLEAR" | "CAUTION" | "DANGER";
  evidenceNetwork: string;
  passed: string[];
  notChecked: string[];
  subject: { packageHash: string };
  settlementTxHash: string;
  decisionTxHash: string;
  datasetRoot: string;
  paymentReceiptHash: string;
  publicationProof: {
    hashKind: "deploy" | "transaction";
    datasetRoot: string;
    reportHash: string;
    paymentReceiptHash: string;
  };
};

type FeedEntry = {
  id: string;
  aspect: string;
  subjectShortHash: string;
};

function normalizedBase(value: string): string {
  return value.replace(/\/+$/, "");
}
