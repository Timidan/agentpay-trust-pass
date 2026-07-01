/**
 * Live, no-mock end-to-end verification of the AgentPay evidence path.
 *
 * Proves three things code-side that a mock could not fake:
 *   1. The report-api quote embeds the CANONICAL Casper block hash for its
 *      height — confirmed by an independent RPC read of that exact height.
 *   2. The chain tip ADVANCES between two reads (live, not a snapshot).
 *   3. The real Merkle proof/verify path accepts the live records and REJECTS
 *      a tampered fact (genuine verification, not a stub returning true).
 *   4. The payment + registry stages stop honestly (402 / configuration_required),
 *      never faking a settlement.
 *
 * Run with the backend up:  tsx apps/report-api/scripts/verify-live-e2e.ts
 */
import { randomUUID } from "node:crypto";
import { findReport } from "@agent-pay/core";
import { buildLiveEvidenceDataset } from "../src/liveEvidence.js";

const RPC_URL = process.env.CASPER_RPC_URL ?? "https://node.testnet.casper.network/rpc";
const API_URL = process.env.REPORT_API_URL ?? "http://127.0.0.1:4021";
const MCP_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3001";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, pass: boolean, detail: string) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

async function casperRpc<T>(method: string, params: unknown): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params })
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (!response.ok || body.error || !body.result) {
    throw new Error(body.error?.message ?? `RPC ${method} -> ${response.status}`);
  }
  return body.result;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function versioned(v: Record<string, unknown> | null) {
  return asRecord(v?.Version2) ?? asRecord(v?.Version1) ?? v;
}

/** Canonical block hash + height for a given height (or latest when undefined). */
async function chainBlock(height?: number) {
  // Casper JSON-RPC uses by-name params; block_identifier selects a height.
  const params = height === undefined ? [] : { block_identifier: { Height: height } };
  const result = await casperRpc<Record<string, unknown>>("chain_get_block", params);
  const bws = asRecord(result.block_with_signatures);
  const block = versioned(asRecord(bws?.block));
  const header = asRecord(block?.header);
  return {
    hash: String(asRecord(block)?.hash ?? header?.hash),
    height: Number(header?.height),
    stateRootHash: String(header?.state_root_hash),
    eraId: Number(header?.era_id)
  };
}

async function getQuote() {
  const response = await fetch(`${API_URL}/reports/quote`);
  if (!response.ok) throw new Error(`quote -> ${response.status}`);
  return (await response.json()) as {
    quoteId: string;
    datasetId: string;
    datasetRoot: string;
    sourceSummary: { product: string; subject: string; facts: Record<string, unknown> }[];
  };
}

async function main() {
  console.log("AgentPay live e2e verification — no mocks\n");
  console.log(`RPC : ${RPC_URL}`);
  console.log(`API : ${API_URL}\n`);

  // --- 1. Independent ground truth from the live chain --------------------
  const tip1 = await chainBlock();
  record(
    "Casper testnet RPC reachable (independent read)",
    Number.isFinite(tip1.height) && tip1.hash.length === 64,
    `tip height ${tip1.height.toLocaleString()}, hash ${tip1.hash.slice(0, 16)}…, era ${tip1.eraId}`
  );

  // --- 2. Quote from the running report-api ------------------------------
  const quote = await getQuote();
  const blockSource = quote.sourceSummary.find((s) => s.subject === "latest_finalized_block");
  const quotedHeight = Number(blockSource?.facts.height);
  const quotedHash = String(blockSource?.facts.blockHash);
  record(
    "report-api built a live quote",
    quote.quoteId.length > 0 && quote.datasetRoot.length === 64,
    `datasetId ${quote.datasetId}, root ${quote.datasetRoot.slice(0, 16)}…`
  );

  // --- 3. THE no-mock proof: quoted block hash == canonical chain hash ----
  const canonical = await chainBlock(quotedHeight);
  record(
    "Quoted block hash matches the canonical chain at that height",
    canonical.hash === quotedHash && quotedHash.length === 64,
    `height ${quotedHeight.toLocaleString()} — quote=${quotedHash.slice(0, 20)}… chain=${canonical.hash.slice(0, 20)}…`
  );
  record(
    "datasetId is derived from live block (height+hash)",
    quote.datasetId === `agent-pay-live-${quotedHeight}-${quotedHash.slice(0, 16)}`,
    `datasetId encodes block ${quotedHeight} / ${quotedHash.slice(0, 16)}`
  );

  // --- 4. Liveness over time: chain tip advances -------------------------
  console.log("\n…waiting ~16s for the chain to advance…\n");
  await new Promise((r) => setTimeout(r, 16000));
  const tip2 = await chainBlock();
  record(
    "Chain tip advances between reads (live, not a snapshot)",
    tip2.height > tip1.height,
    `${tip1.height.toLocaleString()} -> ${tip2.height.toLocaleString()} (+${tip2.height - tip1.height} blocks)`
  );

  // --- 5. Real Merkle proof/verify on the live dataset -------------------
  // buildLiveEvidenceDataset() is the exact function the quote path uses.
  const dataset = await buildLiveEvidenceDataset();
  const leaf = findReport(dataset, dataset.reports[0].record.id);

  const verifyResponse = await fetch(`${API_URL}/reports/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: leaf.record, proof: leaf.proof, datasetRoot: dataset.root })
  });
  const verifyBody = (await verifyResponse.json()) as { verified: boolean };
  record(
    "Live evidence proof verifies against the dataset root",
    verifyBody.verified === true,
    `report "${leaf.record.subject}" proof (${leaf.proof.length} steps) -> verified=${verifyBody.verified}`
  );

  // Tamper a fact — genuine verification must now reject it.
  const tampered = {
    ...leaf.record,
    facts: { ...leaf.record.facts, height: Number(leaf.record.facts.height ?? 0) + 1 }
  };
  const tamperResponse = await fetch(`${API_URL}/reports/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record: tampered, proof: leaf.proof, datasetRoot: dataset.root })
  });
  const tamperBody = (await tamperResponse.json()) as { verified: boolean };
  record(
    "Tampered evidence is REJECTED (verification is real, not a stub)",
    tamperBody.verified === false,
    `one fact mutated -> verified=${tamperBody.verified}`
  );

  // --- 6. Honest gating: payment + registry do not fake success ----------
  const buyResponse = await fetch(`${API_URL}/reports/buy/${quote.quoteId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId: quote.quoteId })
  });
  const buyBody = (await buyResponse.json()) as { error?: string; reason?: string };
  record(
    "Unpaid buy_report is gated (402 / payment required, no fake report)",
    buyResponse.status === 402,
    `HTTP ${buyResponse.status} — ${buyBody.reason ?? buyBody.error ?? "payment required"}`
  );

  const registryResponse = await fetch(`${MCP_URL}/tools/registry_status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  }).catch(() => null);
  if (registryResponse?.ok) {
    const reg = (await registryResponse.json()) as { status?: string; reason?: string };
    record(
      "registry_status reports honest readiness (not a fake 'recorded')",
      reg.status !== "ready" || Boolean(reg.reason),
      `status=${reg.status}${reg.reason ? `, reason=${reg.reason}` : ""}`
    );
  }

  // --- Verdict -----------------------------------------------------------
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`VERDICT: ${passed}/${checks.length} checks passed`);
  const liveProven = checks
    .filter((c) => c.pass && /matches the canonical|advances|proof verifies|REJECTED/.test(c.name))
    .length;
  console.log(
    liveProven >= 4
      ? "Casper works END-TO-END on LIVE data with no mocks, up to the\n" +
          "honestly-gated x402 settlement + on-chain registry write."
      : "Some live checks did not pass — see FAIL lines above."
  );
  console.log("─".repeat(60));
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}

main().catch((error) => {
  console.error("\nverification error:", error instanceof Error ? error.message : error);
  process.exit(2);
});
