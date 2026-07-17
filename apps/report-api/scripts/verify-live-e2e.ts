/**
 * Live, no-mock end-to-end verification of the AgentPay evidence path.
 *
 * Proves five things code-side that a mock could not fake:
 *   1. The selected Casper evidence network is reachable independently from AgentPay.
 *   2. The report API builds a subject-scoped dataset from runtime sources.
 *   3. The real Merkle proof/verify path accepts the runtime records and REJECTS
 *      a tampered fact (genuine verification, not a stub returning true).
 *   4. A live CSPR.name resolves through AgentPay to a canonical Mainnet account.
 *   5. The payment + registry stages stop honestly (402 / configuration_required),
 *      never faking a settlement.
 *
 * Run with the backend up:  tsx apps/report-api/scripts/verify-live-e2e.ts
 */
import { randomUUID } from "node:crypto";
import { findReport, parseSubject } from "@agent-pay/core";
import { buildSubjectEvidence } from "../src/subjectEvidence.js";
import { buildAccountEvidence } from "../src/accountEvidence.js";
import {
  defaultEvidenceNetwork,
  evidenceRpcUrl,
  parseEvidenceNetwork
} from "../src/evidenceNetwork.js";

const requestedNetwork = process.env.AGENTPAY_EVIDENCE_NETWORK?.trim();
const EVIDENCE_NETWORK = requestedNetwork
  ? parseEvidenceNetwork(requestedNetwork)
  : defaultEvidenceNetwork();
if (!EVIDENCE_NETWORK) {
  throw new Error("AGENTPAY_EVIDENCE_NETWORK must be casper-mainnet or casper-testnet");
}
const RPC_URL = process.env.AGENTPAY_E2E_RPC_URL ?? evidenceRpcUrl(EVIDENCE_NETWORK);
const API_URL = process.env.REPORT_API_URL ?? "http://127.0.0.1:4021";
const MCP_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3001";
const SUBJECT = process.env.AGENT_PAY_SUBJECT ?? process.env.X402_ASSET_PACKAGE_HASH;
const CSPR_NAME = process.env.AGENTPAY_E2E_CSPR_NAME?.trim() || "alice.cspr";

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

async function getQuote(subject: string) {
  const query = new URLSearchParams({ subject, network: EVIDENCE_NETWORK });
  const response = await fetch(`${API_URL}/reports/quote?${query}`);
  if (!response.ok) throw new Error(`quote -> ${response.status}`);
  return (await response.json()) as {
    quoteId: string;
    datasetId: string;
    datasetRoot: string;
    evidenceNetwork: string;
    sourceSummary: {
      product: string;
      network: string;
      subject: string;
      sourceUrl: string;
      facts: Record<string, unknown>;
    }[];
  };
}

async function main() {
  if (!SUBJECT) {
    throw new Error("AGENT_PAY_SUBJECT or X402_ASSET_PACKAGE_HASH is required");
  }
  console.log("AgentPay live e2e verification — no mocks\n");
  console.log(`Evidence network: ${EVIDENCE_NETWORK}`);
  console.log(`RPC : ${RPC_URL}`);
  console.log(`API : ${API_URL}\n`);

  // --- 1. Independent ground truth from the live chain --------------------
  const tip1 = await chainBlock();
  record(
    `${EVIDENCE_NETWORK} RPC reachable (independent read)`,
    Number.isFinite(tip1.height) && tip1.hash.length === 64,
    `tip height ${tip1.height.toLocaleString()}, hash ${tip1.hash.slice(0, 16)}…, era ${tip1.eraId}`
  );

  // --- 2. Subject-scoped quote from the running report API ---------------
  const quote = await getQuote(SUBJECT);
  record(
    "report-api built a subject-scoped quote",
    quote.quoteId.length > 0 &&
      quote.datasetRoot.length === 64 &&
      quote.evidenceNetwork === EVIDENCE_NETWORK &&
      quote.sourceSummary.length >= 3 &&
      quote.sourceSummary.every(
        (source) => source.network === EVIDENCE_NETWORK && /^https?:\/\//.test(source.sourceUrl)
      ),
    `datasetId ${quote.datasetId}, network ${quote.evidenceNetwork}, ${quote.sourceSummary.length} evidence families`
  );

  // --- 3. A second independent read must be internally consistent --------
  const tip2 = await chainBlock();
  record(
    "Casper tip is monotonic across independent reads",
    tip2.height >= tip1.height && tip2.hash.length === 64,
    `${tip1.height.toLocaleString()} -> ${tip2.height.toLocaleString()} (+${tip2.height - tip1.height} blocks)`
  );

  // --- 4. Resolve a live human-readable Casper account ------------------
  const nameResponse = await fetch(
    `${API_URL}/resolve-account?${new URLSearchParams({ name: CSPR_NAME })}`
  );
  const nameBody = (await nameResponse.json()) as {
    name?: string;
    accountHash?: string;
    publicKey?: string | null;
    network?: string;
    source?: string;
    sourceUrl?: string;
  };
  record(
    "CSPR.name resolves to a canonical Mainnet account",
    nameResponse.ok &&
      nameBody.name === CSPR_NAME.toLowerCase() &&
      /^account-hash-[0-9a-f]{64}$/.test(nameBody.accountHash ?? "") &&
      (nameBody.publicKey === null || /^(01[0-9a-f]{64}|02[0-9a-f]{66})$/.test(nameBody.publicKey ?? "")) &&
      nameBody.network === "casper-mainnet" &&
      nameBody.source === "CSPR.name" &&
      nameBody.sourceUrl?.startsWith("https://api.cspr.name/resolutions/") === true,
    nameResponse.ok
      ? `${nameBody.name} -> ${(nameBody.accountHash ?? "").slice(0, 26)}…`
      : `HTTP ${nameResponse.status}`
  );

  // --- 5. Build and verify the current subject evidence ------------------
  const parsed = parseSubject(SUBJECT);
  if (!parsed.ok) throw new Error(parsed.error);
  const dataset = parsed.subject.kind === "token"
    ? await buildSubjectEvidence(parsed.subject, { network: EVIDENCE_NETWORK, rpcUrl: RPC_URL })
    : await buildAccountEvidence(parsed.subject, { network: EVIDENCE_NETWORK, rpcUrl: RPC_URL });
  record(
    "AgentPay built runtime subject evidence",
    dataset.datasetId.length > 0 && dataset.root.length === 64 && dataset.reports.length >= 3,
    `datasetId ${dataset.datasetId}, root ${dataset.root.slice(0, 16)}…`
  );
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
    facts: { ...leaf.record.facts, verificationTamper: true }
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

  let registryResponse: Response | null = null;
  try {
    registryResponse = await fetch(`${MCP_URL}/tools/registry_status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.MCP_SERVER_AUTH_TOKEN
          ? { authorization: `Bearer ${process.env.MCP_SERVER_AUTH_TOKEN}` }
          : {})
      },
      body: JSON.stringify({})
    });
  } catch {
    // Recorded as a failed mandatory check below.
  }
  if (registryResponse?.ok) {
    const reg = (await registryResponse.json()) as { status?: string; reason?: string };
    record(
      "registry_status reports honest readiness (not a fake 'recorded')",
      reg.status === "ready" ||
        ((reg.status === "configuration_required" || reg.status === "rpc_unavailable") &&
          Boolean(reg.reason)),
      `status=${reg.status}${reg.reason ? `, reason=${reg.reason}` : ""}`
    );
  } else {
    record(
      "registry_status is reachable and explicit",
      false,
      registryResponse ? `HTTP ${registryResponse.status}` : "MCP bridge unreachable"
    );
  }

  // --- Verdict -----------------------------------------------------------
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`VERDICT: ${passed}/${checks.length} checks passed`);
  console.log(
    checks.every((check) => check.pass)
      ? "Live subject evidence, proof verification, payment gating, and registry\n" +
          "readiness all behaved as implemented without fixture responses."
      : "Some live checks did not pass — see FAIL lines above."
  );
  console.log("─".repeat(60));
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}

main().catch((error) => {
  console.error("\nverification error:", error instanceof Error ? error.message : error);
  process.exit(2);
});
