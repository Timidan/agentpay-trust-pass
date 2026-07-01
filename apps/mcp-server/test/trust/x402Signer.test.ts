import { describe, expect, it, vi } from "vitest";
import {
  buildX402PaymentSignature,
  x402SpendPolicyFromEnv,
  type PaymentRequirement,
  type PaymentResource,
  type X402Signer
} from "../../src/trust/x402Signer.js";

describe("MCP x402 signer spend policy", () => {
  const requirement: PaymentRequirement = {
    scheme: "exact",
    network: "casper:casper-test",
    asset: "9".repeat(64),
    amount: "10000",
    payTo: `00${"8".repeat(64)}`,
    maxTimeoutSeconds: 300,
    extra: { name: "Cep18x402", version: "1", symbol: "CSPR" }
  };
  const resource: PaymentResource = {
    url: "http://127.0.0.1:4021/reports/buy/agent-pay-live-1",
    description: "AgentPay live evidence report",
    mimeType: "application/json"
  };

  it("signs when the quoted payment is within local policy", () => {
    const signer = mockSigner();

    const built = buildX402PaymentSignature({
      requirement,
      resource,
      signer,
      policy: x402SpendPolicyFromEnv({
        AGENT_PAY_EXPECTED_PAYEE_ADDRESS: requirement.payTo,
        AGENT_PAY_EXPECTED_X402_ASSET: requirement.asset,
        AGENT_PAY_EXPECTED_NETWORK: requirement.network,
        AGENT_PAY_MAX_REPORT_AMOUNT: requirement.amount
      }),
      now: 1_700_000_000,
      nonce: new Uint8Array(32).fill(3)
    });

    expect(built.authorization.to).toBe(requirement.payTo);
    expect(signer.sign).toHaveBeenCalledOnce();
  });

  it("rejects and does not sign when the payee address mismatches policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement: { ...requirement, payTo: `00${"7".repeat(64)}` },
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_EXPECTED_PAYEE_ADDRESS: requirement.payTo
        })
      })
    ).toThrow(/payee address mismatch.*expected.*actual/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("rejects and does not sign when the x402 asset mismatches policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement: { ...requirement, asset: "7".repeat(64) },
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_EXPECTED_X402_ASSET: requirement.asset
        })
      })
    ).toThrow(/asset mismatch.*expected.*actual/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("rejects and does not sign when the network mismatches policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement: { ...requirement, network: "casper:casper" },
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_EXPECTED_NETWORK: requirement.network
        })
      })
    ).toThrow(/network mismatch.*expected.*actual/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("rejects and does not sign when the quoted amount exceeds policy", () => {
    const signer = mockSigner();

    expect(() =>
      buildX402PaymentSignature({
        requirement,
        resource,
        signer,
        policy: x402SpendPolicyFromEnv({
          AGENT_PAY_MAX_REPORT_AMOUNT: "9999"
        })
      })
    ).toThrow(/amount exceeds.*expected <= 9999.*actual 10000/i);
    expect(signer.sign).not.toHaveBeenCalled();
  });
});

function mockSigner(): X402Signer & { sign: ReturnType<typeof vi.fn> } {
  return {
    algo: "secp256k1",
    publicKeyHex: `02${"1".repeat(66)}`,
    accountAddress: `00${"6".repeat(64)}`,
    sign: vi.fn(() => new Uint8Array(65).fill(2))
  };
}
