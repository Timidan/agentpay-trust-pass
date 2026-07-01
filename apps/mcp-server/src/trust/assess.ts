/**
 * assessSubject — pure orchestration layer for the Trust Signal rail.
 *
 * Dependencies are injected so the function is fully unit-testable without
 * any network or Casper keyfile. Layer B (tools.ts / app.ts) wires in the
 * real implementations.
 */

import {
  buildVerdictReport,
  extractSignals,
  hashJson,
  parseSubject,
  policyHash,
  scoreSubject,
  type ReportProof,
  type SubjectRef,
} from "@agent-pay/core";

export type Verdict = {
  aspect: string;
  decision: "approved" | "needs_review" | "rejected";
  flags: { code: string; severity: string; message: string }[];
  notChecked: string[];
  rationale: string;
  notCheckedNote: string;
  subject: SubjectRef;
  paymentReceiptHash: string;
  settlementTxHash: string;
  decisionTxHash: string;
  datasetRoot: string;
  policyHash: string;
  explorerUrl: string;
};

export type AssessSubjectDeps = {
  /** Fetch a quote for the subject. Returns quoteId, paymentRequirements, paymentResource, datasetRoot, datasetId. */
  quote: (subject: string) => Promise<any>;
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
  /** Narrate the verdict in human-readable prose. */
  narrate: (args: {
    aspect: string;
    flags: { code: string; severity: string; message: string }[];
    notChecked: string[];
    signals: Record<string, unknown>;
  }) => Promise<{ rationale: string; notCheckedNote: string }>;
};

export async function assessSubject(
  input: { subject: string; reportApiUrl?: string },
  deps: AssessSubjectDeps
): Promise<Verdict> {
  // 1. Parse and validate the subject
  const parsed = parseSubject(input.subject);
  if (!parsed.ok) {
    throw new Error(`Invalid subject: ${parsed.error}`);
  }
  const subject: SubjectRef = parsed.subject;

  // 2. Quote (fetches price + datasetRoot + quoteId)
  const quoteResult = await deps.quote(subject.packageHash);

  // 3. Settle (sign x402 + buy → paid result with evidence[])
  const paidResult = await deps.settle({ quote: quoteResult });

  const evidence: ReportProof[] = paidResult.evidence ?? [];
  const datasetRoot: string = paidResult.datasetRoot ?? quoteResult.datasetRoot;
  const paymentReceiptHash: string = paidResult.paymentReceiptHash;
  const settlementTxHash: string = paidResult.payment?.transactionHash ?? "";
  const datasetId: string = paidResult.datasetId ?? quoteResult.datasetId;

  // 4. Verify each evidence leaf — reject if any fails
  for (const leaf of evidence) {
    const result = await deps.verify({
      record: leaf.record,
      proof: leaf.proof,
      datasetRoot,
    });
    if (!result.verified) {
      throw new Error(
        `Evidence verification failed for record ${leaf.record?.id ?? "(unknown)"} — refusing to stamp unverified evidence`
      );
    }
  }

  // 5. Extract signals from all evidence records
  const records = evidence.map((e) => e.record);
  const signals = extractSignals(records);

  // 6. Score — this is the authoritative decision; narrator cannot override it
  const rule = scoreSubject(signals);

  // 7. Narrate (may call LLM or use deterministic fallback; cannot change aspect/decision)
  const { rationale, notCheckedNote } = await deps.narrate({
    aspect: rule.aspect,
    flags: rule.flags,
    notChecked: rule.notChecked,
    signals: signals as Record<string, unknown>,
  });

  // 8. Build and hash the verdict report
  const verdictReport = buildVerdictReport({
    subject,
    signals,
    rule,
    rationale,
    notCheckedNote,
  });
  const reportHash = hashJson(verdictReport);

  // 9. Record the decision on-chain
  const recordResult = await deps.record({
    datasetId,
    datasetRoot,
    reportHash,
    paymentReceiptHash,
    decision: rule.decision,
  });

  const decisionTxHash = recordResult.txHash;
  const hashKind = recordResult.hashKind;

  const explorerUrl =
    hashKind === "transaction"
      ? `https://testnet.cspr.live/transaction/${decisionTxHash}`
      : `https://testnet.cspr.live/deploy/${decisionTxHash}`;

  return {
    aspect: rule.aspect,
    decision: rule.decision,
    flags: rule.flags,
    notChecked: rule.notChecked,
    rationale,
    notCheckedNote,
    subject,
    paymentReceiptHash,
    settlementTxHash,
    decisionTxHash,
    datasetRoot,
    policyHash: policyHash(),
    explorerUrl,
  };
}
