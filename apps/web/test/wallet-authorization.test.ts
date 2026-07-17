import { ed25519 } from "@noble/curves/ed25519";
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationIntent,
  transferWithAuthorizationTypedData,
  type AuthorizationIntent,
  type PaymentTerms
} from "../../../packages/agent-pay-core/src/payment/index";
import {
  signWalletAuthorization,
  type WalletBrowserWindow
} from "../src/audit/casperWallet";

const PRIVATE_KEY = new Uint8Array(32).fill(19);
const PUBLIC_KEY = `01${hex(ed25519.getPublicKey(PRIVATE_KEY))}`;

const terms: PaymentTerms = {
  x402Version: 2,
  acceptanceIndex: 0,
  scheme: "exact",
  network: "casper:casper-test",
  asset: "9".repeat(64),
  amount: "10000",
  payTo: `00${"8".repeat(64)}`,
  maxTimeoutSeconds: 300,
  extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "TEST" },
  resource: {
    url: "https://service.example/pay",
    description: "Paid resource",
    mimeType: "application/json"
  },
  resourceComparison: { sameHost: true, sameScheme: true, samePath: true },
  requirementHash: "a".repeat(64)
};

describe("Casper Wallet x402 authorization", () => {
  it("signs the exact approved EIP-712 digest and verifies the wallet result locally", async () => {
    const intent = authorizationIntent();
    const signature = `01${hex(ed25519.sign(hexBytes(intent.digest), PRIVATE_KEY))}`;
    const provider = providerFor(intent, {
      cancelled: false,
      signature,
      digest: `0x${intent.digest}`,
      publicKey: PUBLIC_KEY,
      error: null
    });

    await expect(
      signWalletAuthorization(intent, browserWindow(provider))
    ).resolves.toBe(signature);

    const typedData = transferWithAuthorizationTypedData({
      tokenName: intent.tokenName,
      tokenVersion: intent.tokenVersion,
      network: intent.network,
      assetPackageHash: intent.asset,
      from: intent.from,
      to: intent.to,
      value: intent.amount,
      validAfter: intent.validAfter,
      validBefore: intent.validBefore,
      nonce: intent.nonce
    });
    expect(provider.signTypedData).toHaveBeenCalledWith(
      {
        typedData: {
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message
        },
        options: {
          domainTypes: typedData.domainTypes,
          returnHashArtifacts: true,
          rejectUnknownFields: true
        }
      },
      PUBLIC_KEY
    );
  });

  it("refuses a wallet that does not advertise EIP-712 signing", async () => {
    const intent = authorizationIntent();
    const provider = providerFor(intent, null);
    provider.getActivePublicKeySupports.mockResolvedValue(["sign-message"]);

    await expect(signWalletAuthorization(intent, browserWindow(provider))).rejects.toMatchObject({
      code: "wallet_typed_data_unsupported"
    });
    expect(provider.signTypedData).not.toHaveBeenCalled();
  });

  it("refuses to sign after the wallet account changes", async () => {
    const intent = authorizationIntent();
    const provider = providerFor(intent, null);
    provider.getActivePublicKey.mockResolvedValue(`01${"b".repeat(64)}`);

    await expect(signWalletAuthorization(intent, browserWindow(provider))).rejects.toMatchObject({
      code: "wallet_account_changed"
    });
    expect(provider.signTypedData).not.toHaveBeenCalled();
  });

  it.each([
    ["digest", { digest: `0x${"f".repeat(64)}` }, "wallet_digest_mismatch"],
    ["public key", { publicKey: `01${"c".repeat(64)}` }, "wallet_account_changed"],
    ["signature", { signature: `01${"d".repeat(128)}` }, "wallet_signature_invalid"]
  ])("rejects a wallet result with the wrong %s", async (_label, change, code) => {
    const intent = authorizationIntent();
    const signature = `01${hex(ed25519.sign(hexBytes(intent.digest), PRIVATE_KEY))}`;
    const provider = providerFor(intent, {
      cancelled: false,
      signature,
      digest: `0x${intent.digest}`,
      publicKey: PUBLIC_KEY,
      error: null,
      ...change
    });

    await expect(signWalletAuthorization(intent, browserWindow(provider))).rejects.toMatchObject({ code });
  });
});

function authorizationIntent(): AuthorizationIntent {
  return buildAuthorizationIntent({
    terms,
    payerPublicKey: PUBLIC_KEY,
    nowEpochSeconds: 1_700_000_000,
    nonce: "11".repeat(32)
  });
}

function providerFor(intent: AuthorizationIntent, result: Record<string, unknown> | null) {
  return {
    requestConnection: vi.fn(async () => true),
    getActivePublicKey: vi.fn(async () => intent.payerPublicKey),
    signMessage: vi.fn(),
    getActivePublicKeySupports: vi.fn(async () => ["sign-message", "sign-typed-data-eip712"]),
    signTypedData: vi.fn(async () => result)
  };
}

function browserWindow(provider: ReturnType<typeof providerFor>): WalletBrowserWindow {
  return {
    CasperWalletProvider: () => provider
  } as unknown as WalletBrowserWindow;
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
