// Full UI e2e driver for AgentPay, from a user/agent perspective.
//
// Drives the REAL web UI in a browser through the whole rail:
//   landing -> open app -> connect agent -> quote live Casper evidence ->
//   hit the x402 hold -> paste a real signed x402 payload (signed for the EXACT
//   quote the UI is holding) -> settle on Casper Testnet -> verify Merkle proof ->
//   record the decision on-chain -> read the registry receipt.
//
// It captures the MCP tool responses off the wire (quote_report, buy_report,
// verify_report, record_decision, registry_status) so the on-chain tx hashes it
// reports are exactly what the UI received, and screenshots every stage.
//
// Run from repo root with the stack up:
//   CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem \
//   BASE_URL=http://127.0.0.1:5180 ./node_modules/.bin/tsx scripts/e2e-ui-drive.ts

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page, type Response } from "playwright";
import { buildX402PaymentSignature, loadCasperSignerFromPem } from "./x402-buyer";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:5180").replace(/\/+$/, "");
const SECRET = process.env.CASPER_SECRET_KEY_PATH ?? ".agentpay-testnet-key/funded_secret_key.pem";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/agentpay-e2e/shots";
const OUT = process.env.OUT ?? "/tmp/agentpay-e2e/result.json";
const SETTLE_TIMEOUT_MS = Number(process.env.SETTLE_TIMEOUT_MS ?? 480000); // up to 8 min for on-chain confirmation

const captured: Record<string, any> = {
  quote: null,
  buy402: null,
  buySettled: null,
  verify: null,
  record: null,
  registry: null
};

function log(line: string) {
  console.log(line);
}
function short(h?: string | null): string {
  return h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h ?? "";
}
async function shot(page: Page, name: string) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  log(`    · screenshot → ${path}`);
}

async function captureResponse(res: Response) {
  const url = res.url();
  if (!url.includes("/tools/")) return;
  const tool = url.split("/tools/")[1];
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    return;
  }
  if (tool === "quote_report") captured.quote = body;
  else if (tool === "registry_status") captured.registry = body;
  else if (tool === "verify_report") captured.verify = body;
  else if (tool === "record_decision") captured.record = body;
  else if (tool === "buy_report") {
    if (res.status() === 200) captured.buySettled = body;
    else captured.buy402 = { status: res.status(), body };
  }
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: false, slowMo: 120 });
  } catch (error) {
    log(`    (headed launch failed: ${error instanceof Error ? error.message : error} — falling back to headless)`);
    return await chromium.launch({ headless: true });
  }
}

async function main() {
  const signer = loadCasperSignerFromPem(await readFile(resolve(process.cwd(), SECRET), "utf8"));
  log(`agent ${signer.accountAddress.slice(0, 14)}… (${signer.algo}) · target ${BASE_URL}`);

  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("response", (res) => void captureResponse(res));

  try {
    // 1. Landing
    log("\n[1] landing — the public evidence-desk page");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "AgentPay", exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200); // let entrance motion settle
    await shot(page, "01-landing");

    // 2. Open the workspace
    log("\n[2] launch — open the agent workspace");
    const launch = page.getByRole("button", { name: /Launch AgentPay/i }).first();
    if (await launch.count()) await launch.click();
    else await page.getByRole("button", { name: /Open app/i }).first().click();
    await page.getByRole("heading", { name: "AgentPay app" }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot(page, "02-workspace");

    // 3. Connect a local agent identifier
    log("\n[3] connect agent — desk-agent-alpha");
    await page.getByPlaceholder("desk-agent-alpha").fill("desk-agent-alpha");
    await page.getByRole("button", { name: "Connect agent" }).click();
    await page.getByText("Local agent", { exact: false }).first().waitFor({ timeout: 10000 });
    await shot(page, "03-agent-connected");

    // 4. Quote live evidence -> hits the x402 hold (402)
    log("\n[4] quote live evidence — live Casper RPC + CSPR.trade, then the 402 hold");
    await page.getByRole("button", { name: /Quote live evidence/i }).click();
    await page.getByText(/x402 payment required|Payment configuration required/i).first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(800);
    await shot(page, "04-x402-hold");

    if (!captured.quote?.paymentRequirements?.length) {
      throw new Error(`No x402 requirement on the quote — cannot settle. Quote: ${JSON.stringify(captured.quote)?.slice(0, 400)}`);
    }
    const requirement = captured.quote.paymentRequirements[0];
    const resource = captured.quote.paymentResource;
    log(`    → quote ${short(captured.quote.quoteId)} · datasetRoot ${short(captured.quote.datasetRoot)}`);
    log(`    → 402 required: ${requirement.amount} ${requirement.extra?.symbol ?? requirement.extra?.name} on ${requirement.network} → ${short(requirement.payTo)}`);
    if (captured.registry) log(`    → registry_status=${captured.registry.status} block=${captured.registry.rpc?.latestBlockHeight ?? "?"}`);

    // 5. Sign the EXACT quote and paste the x402 payload
    log("\n[5] sign x402 payload (EIP-712 CEP-18) for this exact quote and paste it");
    const built = buildX402PaymentSignature({ requirement, resource, signer });
    log(`    → digest ${short(built.digestHex)} · from ${signer.accountAddress.slice(0, 12)}…`);
    const payloadJson = JSON.stringify(built.paymentPayload);
    const textarea = page.getByLabel("x402 payment payload");
    await textarea.fill(payloadJson);
    await shot(page, "05-payload-pasted");

    // 6. Continue settlement -> real Testnet settle + verify + on-chain record
    log("\n[6] continue settlement — facilitator verify/settle → confirm → verify proof → record on-chain");
    await page.getByRole("button", { name: /Continue settlement/i }).click();

    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let outcome: "complete" | "error" | "timeout" = "timeout";
    while (Date.now() < deadline) {
      if (captured.record?.txHash) { outcome = "complete"; break; }
      const errAlert = page.locator(".agent-pay-console .agent-pay-alert, [class*='alert']").filter({ hasText: /reject|fail|error|not executed|mismatch/i });
      if (captured.buy402 && !captured.buySettled && (await errAlert.count())) { outcome = "error"; break; }
      await page.waitForTimeout(2500);
    }

    if (outcome !== "complete") {
      await shot(page, "99-incomplete");
      throw new Error(
        `Settlement did not complete (${outcome}). buy402=${JSON.stringify(captured.buy402)?.slice(0, 300)} settled=${Boolean(
          captured.buySettled
        )} record=${Boolean(captured.record)}`
      );
    }

    const settleTx = captured.buySettled?.payment?.transactionHash ?? null;
    const decisionTx = captured.record?.txHash ?? null;
    log(`    → settlement tx ${short(settleTx)} · ${captured.buySettled?.payment?.confirmation?.executionState}`);
    log(`    → verify_report verified=${captured.verify?.verified}`);
    log(`    → decision ${captured.record?.hashKind} ${short(decisionTx)} · ${captured.record?.confirmation?.executionState}`);

    // 7. Capture the three workspace tabs of the completed run
    log("\n[7] capture completed workspace (registry receipt / proof / settlement)");
    await page.waitForTimeout(800);
    await shot(page, "06-complete-registry");
    await page.getByRole("tab", { name: "Proof" }).click();
    await page.waitForTimeout(600);
    await shot(page, "07-proof-path");
    await page.getByRole("tab", { name: "Evidence" }).click();
    await page.waitForTimeout(600);
    await shot(page, "08-settlement-evidence");

    const result = {
      ok: true,
      agent: signer.accountAddress,
      algo: signer.algo,
      quoteId: captured.quote?.quoteId,
      datasetId: captured.buySettled?.datasetId,
      datasetRoot: captured.buySettled?.datasetRoot,
      reportHash: captured.buySettled?.reportHash,
      paymentReceiptHash: captured.buySettled?.paymentReceiptHash,
      settlement: {
        transactionHash: settleTx,
        confirmation: captured.buySettled?.payment?.confirmation ?? null
      },
      verified: captured.verify?.verified ?? null,
      decision: {
        txHash: decisionTx,
        hashKind: captured.record?.hashKind ?? null,
        confirmation: captured.record?.confirmation ?? null,
        input: captured.record?.input ?? null
      },
      registryStatus: captured.registry?.status ?? null,
      paymentRequirement: requirement
    };
    await writeFile(OUT, JSON.stringify(result, null, 2));
    log(`\n✓ paid → proved → recorded. result → ${OUT}`);
    log(`  settlement: https://testnet.cspr.live/transaction/${settleTx}`);
    log(`  decision:   https://testnet.cspr.live/${captured.record?.hashKind === "deploy" ? "deploy" : "transaction"}/${decisionTx}`);
  } catch (error) {
    await shot(page, "99-error").catch(() => {});
    await writeFile(OUT, JSON.stringify({ ok: false, error: String(error), captured }, null, 2)).catch(() => {});
    throw error;
  } finally {
    await page.waitForTimeout(500);
    await browser.close();
  }
}

main().catch((e) => {
  console.error("\nUI e2e failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
