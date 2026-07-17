import {
  operatorPolicyHash,
  providerDecisionHash
} from "../../../../packages/agent-pay-core/src/payment/artifacts";
import { normalizePackageHash } from "../../../../packages/agent-pay-core/src/packageHash";
import type {
  OperatorPolicy,
  ProviderDecision
} from "../../../../packages/agent-pay-core/src/payment/types";
import type { AuditApiClient } from "./api";
import { signWalletMessage, type WalletBrowserWindow } from "./casperWallet";

export type ProviderRuleDraft = Omit<
  ProviderDecision,
  "revision" | "signatureMessage" | "signature" | "decisionHash"
>;

export type AssetPolicyDraft = {
  policyId: string;
  operatorPublicKey: string;
  asset: string;
  dailyCap: string;
  now: string;
};

export async function saveAssetPolicyWithWallet(
  api: AuditApiClient,
  token: string,
  draft: AssetPolicyDraft,
  browserWindow: WalletBrowserWindow = window as WalletBrowserWindow
): Promise<OperatorPolicy> {
  if (!/^[1-9][0-9]*$/.test(draft.dailyCap)) {
    throw new TypeError("The daily payment limit must be a positive whole number.");
  }
  const timestamp = new Date(draft.now).toISOString();
  if (timestamp !== draft.now) {
    throw new TypeError("The payment policy time must be a canonical ISO timestamp.");
  }
  const asset = normalizePackageHash(draft.asset);
  const current = await api.getCurrentPolicy(token);
  const unsigned: OperatorPolicy = current
    ? {
        ...current,
        operatorPublicKey: draft.operatorPublicKey,
        revision: current.revision + 1,
        issuedAt: timestamp,
        effectiveAt: timestamp,
        allowedNetworks: [...new Set([...current.allowedNetworks, "casper:casper-test" as const])],
        allowedPayerPublicKeys: [...new Set([...current.allowedPayerPublicKeys, draft.operatorPublicKey])],
        assetDailyCaps: { ...current.assetDailyCaps, [asset]: draft.dailyCap },
        signatureMessage: "",
        signature: "",
        policyHash: ""
      }
    : {
        policyId: draft.policyId,
        operatorPublicKey: draft.operatorPublicKey,
        revision: 1,
        issuedAt: timestamp,
        effectiveAt: timestamp,
        allowedNetworks: ["casper:casper-test"],
        allowedPayerPublicKeys: [draft.operatorPublicKey],
        assetDailyCaps: { [asset]: draft.dailyCap },
        maximumAuthorizationWindowSeconds: 900,
        maximumConcurrentReservations: 5,
        deniedOrigins: [],
        deniedPayees: [],
        deniedAssets: [],
        evidenceMaxAgeSeconds: 300,
        reviewOnInvestmentAdvisories: false,
        allowPinnedResourceSchemeMismatch: false,
        signatureMessage: "",
        signature: "",
        policyHash: ""
      };
  const policyHash = operatorPolicyHash(unsigned);
  const challenge = await api.createActionChallenge(token, draft.operatorPublicKey, {
    kind: "policy_revision",
    artifactHash: policyHash,
    revision: unsigned.revision
  });
  const signature = await signWalletMessage(
    challenge.message,
    draft.operatorPublicKey,
    browserWindow
  );
  const policy: OperatorPolicy = {
    ...unsigned,
    policyHash,
    signatureMessage: challenge.message,
    signature
  };
  const saved = await api.createPolicyRevision(token, {
    challengeId: challenge.challengeId,
    policy
  });
  return saved.policy;
}

export async function saveProviderRuleWithWallet(
  api: AuditApiClient,
  token: string,
  draft: ProviderRuleDraft,
  browserWindow: WalletBrowserWindow = window as WalletBrowserWindow
): Promise<ProviderDecision> {
  const { decisions } = await api.listProviderDecisions(token);
  const revision = decisions.reduce(
    (highest, decision) => Math.max(highest, decision.revision),
    0
  ) + 1;
  const unsigned: ProviderDecision = {
    ...draft,
    origin: new URL(draft.origin).origin,
    payee: draft.payee.toLowerCase(),
    asset: normalizePackageHash(draft.asset),
    revision,
    signatureMessage: "",
    signature: "",
    decisionHash: ""
  };
  const decisionHash = providerDecisionHash(unsigned);
  const challenge = await api.createActionChallenge(token, draft.operatorPublicKey, {
    kind: "provider_decision",
    artifactHash: decisionHash,
    revision
  });
  const signature = await signWalletMessage(
    challenge.message,
    draft.operatorPublicKey,
    browserWindow
  );
  const decision: ProviderDecision = {
    ...unsigned,
    decisionHash,
    signatureMessage: challenge.message,
    signature
  };
  const saved = await api.createProviderDecision(token, {
    challengeId: challenge.challengeId,
    decision
  });
  return saved.decision;
}
