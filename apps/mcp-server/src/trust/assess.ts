/**
 * Pure orchestration for a paid Casper token or account check.
 *
 * Dependencies are injected so the function is fully unit-testable without
 * any network or Casper keyfile. Layer B (tools.ts / app.ts) wires in the
 * real implementations.
 */

import {
  accountPolicyHash,
  ACCOUNT_POLICY_VERSION,
  buildVerdictReport,
  extractAccountSignals,
  extractSignals,
  hashJson,
  parseSubject,
  policyHash,
  POLICY_VERSION,
  scoreAccount,
  scoreSubject,
  type ReportProof,
  type SubjectRef,
} from "@agent-pay/core";
import { ToolInputError } from "../errors.js";
import type { NarrateVerdict } from "./narrator.js";
import type { EvidenceNetwork, ResolvedCsprName, ResolvedToken } from "../apiClient.js";

export type Verdict = {
  aspect: string;
  decision: "approved" | "needs_review" | "rejected";
  flags: { code: string; severity: string; message: string }[];
  notChecked: string[];
  passed: string[];
  rationale: string;
  notCheckedNote: string;
  subject: SubjectRef;
  resolvedToken?: ResolvedToken & { source: "CSPR.trade" };
  resolvedAccount?: ResolvedCsprName;
  evidenceNetwork: EvidenceNetwork;
  payment: {
    amount: string;
    amountDisplay: string;
    asset: string;
    assetSymbol: string;
    assetDecimals: number | null;
    network: string;
  };
  paymentReceiptHash: string;
  settlementTxHash: string;
  decisionTxHash: string;
  datasetRoot: string;
  policyHash: string;
  publicationProof: {
    hashKind: "transaction" | "deploy";
    datasetId: string;
    datasetRoot: string;
    reportHash: string;
    paymentReceiptHash: string;
    verdictReport: Record<string, unknown>;
  };
  settlementExplorerUrl: string;
  explorerUrl: string;
};

export type AssessSubjectDeps = {
  /** Fetch a quote for the subject. Returns quoteId, paymentRequirements, paymentResource, datasetRoot, datasetId. */
  quote: (subject: string, evidenceNetwork?: EvidenceNetwork) => Promise<any>;
  /** Sign x402 + buy the report. Returns the paid result incl. evidence[], paymentReceiptHash, payment.transactionHash. */
  settle: (args: { quote: any }) => Promise<any>;
  /** Verify a single Merkle proof leaf. */
  verify: (args: { record: any; proof: any; datasetRoot: string }) => Promise<{ verified: boolean }>;
  /** Record the trust decision on-chain. */
  record: (args: {
    datasetId: string;
    datasetRoot: string;
    reportHash: string;
    paymentReceiptHash: string;
    decision: string;
  }) => Promise<{ txHash: string; hashKind: "transaction" | "deploy" }>;
  /** Narrate the verdict in human-readable prose. Cannot change aspect/decision. */
  narrate: NarrateVerdict;
};

export async function assessSubject(
  input: {
    subject: string;
    reportApiUrl?: string;
    evidenceNetwork?: EvidenceNetwork;
  },
  deps: AssessSubjectDeps
): Promise<Verdict> {
  // 1. Parse and validate the subject
  const parsed = parseSubject(input.subject);
  if (!parsed.ok) {
    throw new ToolInputError(`Invalid subject: ${parsed.error}`);
  }
  const subject: SubjectRef = parsed.subject;

  // 2. Quote (fetches price + datasetRoot + quoteId).
  //    Forward the raw identifier, not the bare packageHash: report-api
  //    re-parses this string, and a stripped account hash would be re-read as
  //    a token — buying token evidence while we score with the account policy.
  const quoteResult = await deps.quote(subject.raw, input.evidenceNetwork);
  const evidenceNetwork = requireEvidenceNetwork(
    quoteResult?.evidenceNetwork,
    "quote evidence network"
  );
  if (input.evidenceNetwork && input.evidenceNetwork !== evidenceNetwork) {
    throw new Error("Quote evidence network does not match the requested Casper network");
  }

  // 3. Settle (sign x402 + buy → paid result with evidence[])
  const paidResult = await deps.settle({ quote: quoteResult });
  const evidence = requireEvidence(paidResult?.evidence);
  const quotedDatasetRoot = requireHash(quoteResult?.datasetRoot, "quote dataset root");
  const datasetRoot = requireHash(paidResult?.datasetRoot, "paid dataset root");
  if (datasetRoot !== quotedDatasetRoot) {
    throw new Error("Paid report dataset root does not match the accepted quote");
  }
  const paymentReceiptHash = requireHash(
    paidResult?.paymentReceiptHash,
    "payment receipt hash"
  );
  const paidEvidenceNetwork = requireEvidenceNetwork(
    paidResult?.evidenceNetwork,
    "paid evidence network"
  );
  if (paidEvidenceNetwork !== evidenceNetwork) {
    throw new Error("Paid report evidence network does not match the accepted quote");
  }
  const settlementTxHash = requireHash(
    paidResult?.payment?.transactionHash,
    "settlement transaction hash"
  );
  if (
    paidResult?.payment?.scheme !== "x402" ||
    paidResult?.payment?.status !== "settled" ||
    paidResult?.payment?.confirmation?.executionState !== "executed"
  ) {
    throw new Error("Paid report does not contain an executed x402 settlement confirmation");
  }
  const payment = requirePaymentDetails(quoteResult, paidResult);
  const datasetId = requireDatasetId(paidResult?.datasetId);
  if (quoteResult?.datasetId !== datasetId) {
    throw new Error("Paid report dataset id does not match the accepted quote");
  }

  // 4. Verify each evidence leaf — reject if any fails
  for (const leaf of evidence) {
    if (leaf.datasetId !== datasetId || hashJson(leaf.record) !== leaf.reportHash) {
      throw new Error("Evidence leaf metadata does not match the paid dataset");
    }
    const result = await deps.verify({
      record: leaf.record,
      proof: leaf.proof,
      datasetRoot,
    });
    if (!result.verified) {
      throw new Error(
        `Evidence verification failed for record ${leaf.record?.id ?? "(unknown)"}: refusing to stamp unverified evidence`
      );
    }
  }

  // 5. Extract signals from all evidence records
  const records = evidence.map((e) => e.record);
  if (records.some((record) => record.network !== evidenceNetwork)) {
    throw new Error("Paid report contains evidence from a different Casper network");
  }
  const isAccount = subject.kind === "account";
  requireEvidenceFamilies(records, isAccount);
  const signals = isAccount ? extractAccountSignals(records) : extractSignals(records);

  // 6. Score — this is the authoritative decision; narrator cannot override it.
  //    Accounts and tokens have separate deterministic policies.
  const rule = isAccount
    ? scoreAccount(signals as ReturnType<typeof extractAccountSignals>)
    : scoreSubject(signals as ReturnType<typeof extractSignals>);
  const activePolicyHash = isAccount ? accountPolicyHash() : policyHash();
  const activePolicyVersion = isAccount ? ACCOUNT_POLICY_VERSION : POLICY_VERSION;

  // 7. Narrate (may call LLM or use deterministic fallback; cannot change aspect/decision)
  const { rationale, notCheckedNote } = await deps.narrate({
    aspect: rule.aspect,
    flags: rule.flags,
    notChecked: rule.notChecked,
    signals: signals as Record<string, unknown>,
  });

  // 8. Build and hash the verdict report
  const verdictReport = {
    ...buildVerdictReport({
      subject,
      signals,
      rule,
      rationale,
      notCheckedNote,
      policyVersion: activePolicyVersion,
      policyHash: activePolicyHash,
    }),
    evidenceNetwork,
    payment
  };
  const reportHash = hashJson(verdictReport);

  // 9. Record the decision on-chain
  const recordResult = await deps.record({
    datasetId,
    datasetRoot,
    reportHash,
    paymentReceiptHash,
    decision: rule.decision,
  });

  const decisionTxHash = requireHash(recordResult.txHash, "decision transaction hash");
  const hashKind = recordResult.hashKind;
  if (hashKind !== "transaction" && hashKind !== "deploy") {
    throw new Error("Decision recorder returned an unsupported Casper hash kind");
  }

  const explorerUrl =
    hashKind === "transaction"
      ? `https://testnet.cspr.live/transaction/${decisionTxHash}`
      : `https://testnet.cspr.live/deploy/${decisionTxHash}`;
  const settlementExplorerUrl =
    `https://testnet.cspr.live/transaction/${settlementTxHash}`;

  return {
    aspect: rule.aspect,
    decision: rule.decision,
    flags: rule.flags,
    notChecked: rule.notChecked,
    passed: rule.passed,
    rationale,
    notCheckedNote,
    subject,
    evidenceNetwork,
    payment,
    paymentReceiptHash,
    settlementTxHash,
    decisionTxHash,
    datasetRoot,
    policyHash: activePolicyHash,
    publicationProof: {
      hashKind,
      datasetId,
      datasetRoot,
      reportHash,
      paymentReceiptHash,
      verdictReport
    },
    settlementExplorerUrl,
    explorerUrl,
  };
}

function requireEvidenceNetwork(value: unknown, label: string): EvidenceNetwork {
  if (value !== "casper-mainnet" && value !== "casper-testnet") {
    throw new Error(`${label} must be casper-mainnet or casper-testnet`);
  }
  return value;
}

function requirePaymentDetails(
  quoteResult: any,
  paidResult: any
): Verdict["payment"] {
  const requirement = Array.isArray(quoteResult?.paymentRequirements)
    ? quoteResult.paymentRequirements[0]
    : null;
  const paid = paidResult?.payment;
  const expectedAmount = requireText(requirement?.amount, "quoted payment amount");
  const expectedAsset = requireText(requirement?.asset, "quoted payment asset");
  const expectedNetwork = requireText(requirement?.network, "quoted payment network");
  const amount = requireText(paid?.amount, "paid amount");
  const asset = requireText(paid?.asset, "paid asset");
  const network = requireText(paid?.network, "paid network");
  if (
    amount !== expectedAmount ||
    asset.toLowerCase() !== expectedAsset.toLowerCase() ||
    network !== expectedNetwork
  ) {
    throw new Error("Paid report payment details do not match the accepted quote");
  }
  const decimalsValue =
    paid?.assetDecimals ??
    quoteResult?.assetDecimals ??
    requirement?.extra?.decimals ??
    null;
  const assetDecimals = decimalsValue === null ? null : Number(decimalsValue);
  if (
    assetDecimals !== null &&
    (!Number.isSafeInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 255)
  ) {
    throw new Error("paid asset decimals must be an integer from 0 to 255");
  }
  return {
    amount,
    amountDisplay: requireText(
      paid?.amountDisplay ?? quoteResult?.amountDisplay ?? amount,
      "paid display amount"
    ),
    asset: asset.toLowerCase(),
    assetSymbol: requireText(
      paid?.assetSymbol ?? quoteResult?.asset,
      "paid asset symbol"
    ),
    assetDecimals,
    network
  };
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireEvidence(value: unknown): ReportProof[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("Paid report must contain a bounded, non-empty evidence set");
  }
  for (const leaf of value) {
    if (
      !leaf ||
      typeof leaf !== "object" ||
      Array.isArray(leaf) ||
      !Array.isArray((leaf as ReportProof).proof) ||
      !(leaf as ReportProof).record ||
      typeof (leaf as ReportProof).record !== "object" ||
      typeof (leaf as ReportProof).datasetId !== "string" ||
      !/^[0-9a-f]{64}$/i.test((leaf as ReportProof).reportHash)
    ) {
      throw new Error("Paid report contains malformed evidence");
    }
  }
  return value as ReportProof[];
}

function requireEvidenceFamilies(records: ReportProof["record"][], account: boolean): void {
  const expected = account
    ? ["account_identity", "account_control", "account_balance"]
    : ["token_authority", "token_holders", "token_age"];
  const observed = new Set(records.map((record) => record.subject));
  if (expected.some((subject) => !observed.has(subject))) {
    throw new Error("Paid report is missing a required AgentPay evidence family");
  }
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be 64 hexadecimal characters`);
  }
  return value.toLowerCase();
}

function requireDatasetId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new Error("Paid report dataset id is invalid");
  }
  return value;
}
