import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditApiClient } from "../src/audit/api";
import {
  saveAssetPolicyWithWallet,
  saveProviderRuleWithWallet
} from "../src/audit/walletOperatorActions";

const PUBLIC_KEY = `01${"a".repeat(64)}`;
const SIGNATURE = "b".repeat(128);
const DECISION_HASH = "e33bee25d38cc23cac3ef5888bd72d37fdd13ee6c4d6fac8ee947fca4c998544";
const POLICY_HASH = "81b6c76679099c080d4204ded8e5d82b7e1258a582eb7887a3f3dda5dd59b220";

afterEach(() => {
  Reflect.deleteProperty(window, "CasperWalletProvider");
});

describe("wallet-signed provider rules", () => {
  it("hashes, challenge-binds, signs, and saves an exact provider approval", async () => {
    const provider = walletProvider(PUBLIC_KEY);
    installProvider(provider);

    const api = {
      listProviderDecisions: vi.fn(async () => ({ decisions: [] })),
      createActionChallenge: vi.fn(async (_token, operatorPublicKey, action) => {
        expect(operatorPublicKey).toBe(PUBLIC_KEY);
        expect(action).toEqual({
          kind: "provider_decision",
          artifactHash: DECISION_HASH,
          revision: 1
        });
        return { challengeId: "challenge-1", message: "Approve provider challenge" };
      }),
      createProviderDecision: vi.fn(async (_token, body) => ({ decision: body.decision }))
    } as unknown as AuditApiClient;

    const decision = await saveProviderRuleWithWallet(
      api,
      "operator-session-token",
      {
        decisionId: "decision-1",
        kind: "pin",
        operatorPublicKey: PUBLIC_KEY,
        origin: "https://svc.example",
        resourcePathPrefix: "/pay",
        payee: `00${"8".repeat(64)}`,
        asset: "9".repeat(64),
        network: "casper:casper-test",
        perCallCeiling: "10000",
        expiresAt: "2026-08-16T00:00:00.000Z",
        promptedByCheckId: "check-1"
      },
      window
    );

    expect(decision.decisionHash).toBe(DECISION_HASH);
    expect(decision.signatureMessage).toBe("Approve provider challenge");
    expect(decision.signature).toBe(SIGNATURE);
    expect(provider.signMessage).toHaveBeenCalledWith("Approve provider challenge", PUBLIC_KEY);
    expect(api.createProviderDecision).toHaveBeenCalledWith("operator-session-token", {
      challengeId: "challenge-1",
      decision
    });
  });

  it("refuses to sign when the connected account changed", async () => {
    const provider = walletProvider(`01${"c".repeat(64)}`);
    installProvider(provider);
    const api = {
      listProviderDecisions: vi.fn(async () => ({ decisions: [] })),
      createActionChallenge: vi.fn(async () => ({
        challengeId: "challenge-1",
        message: "Approve provider challenge"
      })),
      createProviderDecision: vi.fn()
    } as unknown as AuditApiClient;

    await expect(saveProviderRuleWithWallet(
      api,
      "operator-session-token",
      {
        decisionId: "decision-1",
        kind: "pin",
        operatorPublicKey: PUBLIC_KEY,
        origin: "https://svc.example",
        resourcePathPrefix: "/pay",
        payee: `00${"8".repeat(64)}`,
        asset: "9".repeat(64),
        network: "casper:casper-test",
        perCallCeiling: "10000",
        expiresAt: "2026-08-16T00:00:00.000Z",
        promptedByCheckId: "check-1"
      },
      window
    )).rejects.toMatchObject({
      code: "wallet_account_changed",
      message: "Casper Wallet switched accounts. Reconnect the wallet you used to sign in."
    });
    expect(provider.signMessage).not.toHaveBeenCalled();
    expect(api.createProviderDecision).not.toHaveBeenCalled();
  });
});

describe("wallet-signed payment rules", () => {
  it("creates a conservative first policy for one payer, network, and payment token", async () => {
    const provider = walletProvider(PUBLIC_KEY);
    installProvider(provider);
    const api = {
      getCurrentPolicy: vi.fn(async () => null),
      createActionChallenge: vi.fn(async (_token, operatorPublicKey, action) => {
        expect(operatorPublicKey).toBe(PUBLIC_KEY);
        expect(action).toEqual({
          kind: "policy_revision",
          artifactHash: POLICY_HASH,
          revision: 1
        });
        return { challengeId: "policy-challenge-1", message: "Install payment rules challenge" };
      }),
      createPolicyRevision: vi.fn(async (_token, body) => ({ policy: body.policy }))
    } as unknown as AuditApiClient;

    const policy = await saveAssetPolicyWithWallet(
      api,
      "operator-session-token",
      {
        policyId: "policy-1",
        operatorPublicKey: PUBLIC_KEY,
        asset: "9".repeat(64),
        dailyCap: "50000",
        now: "2026-07-17T00:00:00.000Z"
      },
      window
    );

    expect(policy).toMatchObject({
      policyId: "policy-1",
      revision: 1,
      allowedNetworks: ["casper:casper-test"],
      allowedPayerPublicKeys: [PUBLIC_KEY],
      assetDailyCaps: { ["9".repeat(64)]: "50000" },
      maximumAuthorizationWindowSeconds: 900,
      maximumConcurrentReservations: 5,
      reviewOnInvestmentAdvisories: false,
      allowPinnedResourceSchemeMismatch: false,
      policyHash: POLICY_HASH,
      signatureMessage: "Install payment rules challenge",
      signature: SIGNATURE
    });
    expect(api.createPolicyRevision).toHaveBeenCalledWith("operator-session-token", {
      challengeId: "policy-challenge-1",
      policy
    });
  });
});

function walletProvider(publicKey: string) {
  return {
    requestConnection: vi.fn(async () => true),
    getActivePublicKey: vi.fn(async () => publicKey),
    signMessage: vi.fn(async () => ({ cancelled: false, signatureHex: SIGNATURE }))
  };
}

function installProvider(provider: ReturnType<typeof walletProvider>) {
  Object.defineProperty(window, "CasperWalletProvider", {
    configurable: true,
    value: vi.fn(() => provider)
  });
}
