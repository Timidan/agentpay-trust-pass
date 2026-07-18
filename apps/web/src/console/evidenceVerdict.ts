import type { PaidReport } from "../api";
import { extractSignals } from "../../../../packages/agent-pay-core/src/trust/signals";
import { extractAccountSignals } from "../../../../packages/agent-pay-core/src/trust/accountSignals";
import { scoreSubject, type RuleResult, type WireDecision } from "../../../../packages/agent-pay-core/src/trust/rules";
import { scoreAccount } from "../../../../packages/agent-pay-core/src/trust/accountRules";

// The console runs the raw report tools (quote → buy → verify → record) rather
// than assess_subject, so it is the one place the console-flow verdict is
// computed. This module owns that computation: pick the evidence records, route
// to the account or token rule engine, and score. The rule engines in
// @agent-pay/core remain the single source of the CLEAR/CAUTION/DANGER aspect.
//
// Account routing here sniffs the evidence record subject because, unlike the
// server's assess.ts (which has the parsed SubjectRef.kind), the console only
// has the returned PaidReport. This is the only signal available post-hoc.
function isAccountEvidence(records: PaidReport["report"][]): boolean {
  return records.some((r) => typeof r?.subject === "string" && r.subject.startsWith("account_"));
}

export function verdictForPaidReport(paidReport: PaidReport): RuleResult {
  const evidenceRecords =
    paidReport.evidence && paidReport.evidence.length > 0
      ? paidReport.evidence.map((leaf) => leaf.record)
      : [paidReport.report];
  return isAccountEvidence(evidenceRecords)
    ? scoreAccount(extractAccountSignals(evidenceRecords))
    : scoreSubject(extractSignals(evidenceRecords));
}

export function decisionForPaidReport(paidReport: PaidReport): WireDecision {
  return verdictForPaidReport(paidReport).decision;
}
