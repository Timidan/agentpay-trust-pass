import {
  ACCOUNT_POLICY_VERSION,
  accountPolicyHash,
  buildVerdictReport,
  hashJson,
  policyHash,
  POLICY_VERSION,
  scoreAccount,
  scoreSubject,
  type AccountSignals,
  type SubjectSignals
} from "@agent-pay/core";
import { describe, expect, it } from "vitest";
import {
  parseVerdictCardSubmission,
  type VerdictCardSubmission
} from "../src/card.js";

const signals: SubjectSignals = {
  mintBurnEnabled: false,
  publicMintEntrypoint: false,
  holderCount: 20,
  topHolderPct: 12,
  contractAgeBlocks: 500,
  lpHolderCount: null,
  liquidityDepth: null
};
const rule = scoreSubject(signals);
const verdictReport = {
  ...buildVerdictReport({
    subject: { kind: "token", packageHash: "a".repeat(64), raw: `hash-${"a".repeat(64)}` },
    signals,
    rule,
    rationale: "Every check required by this policy ran and passed. Review the receipt before you proceed.",
    notCheckedNote: "AgentPay completed every check required by this policy.",
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

const submission: VerdictCardSubmission = {
  card: {
    aspect: rule.aspect,
    subjectShortHash: "a".repeat(8),
    flags: rule.flags.map(({ code, message }) => ({ code, message })),
    notChecked: rule.notChecked,
    decisionTxHash: "c".repeat(64),
    policyHash: policyHash()
  },
  proof: {
    hashKind: "deploy",
    datasetId: "trust-casper-mainnet-token-1",
    datasetRoot: "d".repeat(64),
    reportHash: hashJson(verdictReport),
    paymentReceiptHash: "e".repeat(64),
    verdictReport
  }
};

const accountSignals: AccountSignals = {
  exists: true,
  balanceMotes: "2000000000",
  associatedKeyCount: 1,
  deploymentThreshold: 1,
  keyManagementThreshold: 1,
  namedKeyCount: 0,
  ageBlocks: null,
  txCount: null
};
const accountRule = scoreAccount(accountSignals);
const accountReport = {
  ...buildVerdictReport({
    subject: {
      kind: "account" as const,
      packageHash: "f".repeat(64),
      raw: `account-hash-${"f".repeat(64)}`
    },
    signals: accountSignals,
    rule: accountRule,
    rationale: "The required Casper account checks ran and passed.",
    notCheckedNote: "Optional account history was not required for this result.",
    policyVersion: ACCOUNT_POLICY_VERSION,
    policyHash: accountPolicyHash()
  }),
  evidenceNetwork: "casper-mainnet",
  payment: verdictReport.payment
};
const accountSubmission: VerdictCardSubmission = {
  card: {
    aspect: accountRule.aspect,
    subjectShortHash: "f".repeat(8),
    flags: accountRule.flags.map(({ code, message }) => ({ code, message })),
    notChecked: accountRule.notChecked,
    decisionTxHash: "1".repeat(64),
    policyHash: accountPolicyHash()
  },
  proof: {
    hashKind: "deploy",
    datasetId: "trust-casper-mainnet-account-1",
    datasetRoot: "2".repeat(64),
    reportHash: hashJson(accountReport),
    paymentReceiptHash: "3".repeat(64),
    verdictReport: accountReport
  }
};

describe("parseVerdictCardSubmission", () => {
  it("accepts a card whose fields match the current deterministic verdict report", () => {
    expect(parseVerdictCardSubmission(submission)).toEqual(submission);
  });

  it("rejects a card whose displayed result differs from its committed report", () => {
    expect(parseVerdictCardSubmission({
      ...submission,
      card: { ...submission.card, aspect: "DANGER" }
    })).toBeNull();
  });

  it("rejects a verdict report whose content does not match its report hash", () => {
    expect(parseVerdictCardSubmission({
      ...submission,
      proof: {
        ...submission.proof,
        verdictReport: { ...submission.proof.verdictReport, rationale: "changed" }
      }
    })).toBeNull();
  });

  it("accepts equivalent JSON regardless of object key insertion order", () => {
    const reorderedFlags = (submission.proof.verdictReport.flags as Array<{
      code: string;
      severity: string;
      message: string;
    }>).map((flag) => ({
      message: flag.message,
      severity: flag.severity,
      code: flag.code
    }));
    const reorderedReport = {
      ...submission.proof.verdictReport,
      flags: reorderedFlags
    };

    expect(parseVerdictCardSubmission({
      ...submission,
      proof: {
        ...submission.proof,
        reportHash: hashJson(reorderedReport),
        verdictReport: reorderedReport
      }
    })).not.toBeNull();
  });

  it("accepts a current account-policy verdict", () => {
    expect(parseVerdictCardSubmission(accountSubmission)).toEqual(accountSubmission);
  });
});
