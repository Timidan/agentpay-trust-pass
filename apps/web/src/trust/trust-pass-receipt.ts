import type { Verdict } from "../api";

export type TrustPassReceipt = {
  product: "AgentPay Trust Pass";
  aspect: Verdict["aspect"];
  decision: Verdict["decision"];
  subject: {
    kind: string;
    id: string;
    fingerprint: string;
  };
  evidence: {
    datasetRoot: string;
    policyHash: string;
  };
  payment: {
    scheme: "x402";
    receiptHash: string;
    settlementTxHash: string;
  };
  casperRecord: {
    decisionTxHash: string;
    explorerUrl: string;
  };
};

export function buildTrustPassReceipt(verdict: Verdict): TrustPassReceipt {
  return {
    product: "AgentPay Trust Pass",
    aspect: verdict.aspect,
    decision: verdict.decision,
    subject: {
      kind: verdict.subject.kind,
      id: verdict.subject.raw,
      fingerprint: verdict.subject.packageHash
    },
    evidence: {
      datasetRoot: verdict.datasetRoot,
      policyHash: verdict.policyHash
    },
    payment: {
      scheme: "x402",
      receiptHash: verdict.paymentReceiptHash,
      settlementTxHash: verdict.settlementTxHash
    },
    casperRecord: {
      decisionTxHash: verdict.decisionTxHash,
      explorerUrl: verdict.explorerUrl
    }
  };
}

export function serializeTrustPassReceipt(receipt: TrustPassReceipt): string {
  return JSON.stringify(receipt, null, 2);
}

export function casperTransactionUrl(hash: string): string {
  return `https://testnet.cspr.live/transaction/${hash}`;
}
