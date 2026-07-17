import {
  buildVerdictReport,
  hashJson,
  policyHash,
  POLICY_VERSION,
  scoreSubject,
  type SubjectSignals
} from "@agent-pay/core";
import type { VerdictCardSubmission } from "../src/card.js";
import type { DecisionRecordVerifier } from "../src/decisionRecord.js";

const CLEAR_SIGNALS: SubjectSignals = {
  mintBurnEnabled: false,
  publicMintEntrypoint: false,
  holderCount: 20,
  topHolderPct: 12,
  contractAgeBlocks: 2_000,
  lpHolderCount: null,
  liquidityDepth: null
};

export const acceptDecisionRecord: DecisionRecordVerifier = async () => ({
  verified: true,
  blockHeight: 8_500_000
});

export function createVerdictSubmission(input: {
  packageHash?: string;
  decisionTxHash?: string;
  datasetRoot?: string;
  signals?: SubjectSignals;
} = {}): VerdictCardSubmission {
  const packageHash = input.packageHash ?? "a".repeat(64);
  const signals = input.signals ?? CLEAR_SIGNALS;
  const rule = scoreSubject(signals);
  const verdictReport = {
    ...buildVerdictReport({
      subject: { kind: "token" as const, packageHash, raw: `hash-${packageHash}` },
      signals,
      rule,
      rationale: "AgentPay applied the published rules to verified Casper evidence.",
      notCheckedNote: rule.notChecked.length > 0
        ? "The receipt lists the checks that could not run."
        : "Every check required by this policy ran.",
      policyVersion: POLICY_VERSION,
      policyHash: policyHash()
    }),
    evidenceNetwork: "casper-mainnet",
    payment: {
      amount: "10000",
      amountDisplay: "0.00001",
      asset: "b".repeat(64),
      assetSymbol: "WCSPR",
      assetDecimals: 9,
      network: "casper:casper-test"
    }
  };

  return {
    card: {
      aspect: rule.aspect,
      subjectShortHash: packageHash.slice(0, 8),
      flags: rule.flags.map(({ code, message }) => ({ code, message })),
      notChecked: rule.notChecked,
      decisionTxHash: input.decisionTxHash ?? "c".repeat(64),
      policyHash: policyHash()
    },
    proof: {
      hashKind: "deploy",
      datasetId: `trust-casper-mainnet-token-${packageHash.slice(0, 8)}`,
      datasetRoot: input.datasetRoot ?? "d".repeat(64),
      reportHash: hashJson(verdictReport),
      paymentReceiptHash: "e".repeat(64),
      verdictReport
    }
  };
}
