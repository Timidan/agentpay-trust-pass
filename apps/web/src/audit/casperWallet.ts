import {
  transferWithAuthorizationTypedData,
  verifyAuthorizationSignature,
  type AuthorizationIntent
} from "../../../../packages/agent-pay-core/src/payment/index";
import { AuditApiClient, AuditApiError, type OperatorSession } from "./api";

const CASPER_PUBLIC_KEY = /^(?:01[0-9a-f]{64}|02[0-9a-f]{66})$/i;
const CASPER_SIGNATURE = /^(?:[0-9a-f]{128}|(?:01|02)[0-9a-f]{128})$/i;
const WALLET_REQUEST_TIMEOUT_MS = 120_000;

type SignatureResponse =
  | { cancelled: true }
  | {
      cancelled: false;
      signatureHex?: string;
      signature?: string | Uint8Array;
    };

type TypedDataSignatureResponse = {
  cancelled: boolean;
  signature?: string | null;
  signatureHex?: string | null;
  digest?: string | null;
  publicKey?: string | null;
  error?: string | null;
  errorCode?: string;
};

type SignTypedDataParams = {
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  options: {
    domainTypes: Array<{ name: string; type: string }>;
    returnHashArtifacts: boolean;
    rejectUnknownFields: boolean;
  };
};

type CasperWalletProvider = {
  requestConnection(): Promise<boolean>;
  getActivePublicKey(): Promise<string>;
  signMessage(message: string, signingPublicKeyHex: string): Promise<SignatureResponse>;
  getActivePublicKeySupports?(): Promise<string[] | string>;
  signTypedData?(
    params: SignTypedDataParams,
    signingPublicKeyHex: string
  ): Promise<TypedDataSignatureResponse | null | undefined>;
};

export type WalletBrowserWindow = Window & {
  CasperWalletProvider?: (options?: { timeout: number }) => CasperWalletProvider;
};

export type WalletSession = OperatorSession;

export async function createWalletSession(
  api: AuditApiClient,
  browserWindow: WalletBrowserWindow = window as WalletBrowserWindow
): Promise<WalletSession> {
  try {
    const provider = walletProvider(browserWindow);
    const operatorPublicKey = await connectedPublicKey(provider);

    const challenge = await api.createSessionChallenge(operatorPublicKey);
    const signature = await signWithProvider(provider, challenge.message, operatorPublicKey);

    return await api.createOperatorSession({
      challengeId: challenge.challengeId,
      operatorPublicKey,
      signature
    });
  } catch (cause) {
    if (cause instanceof AuditApiError) throw cause;
    throw walletError(
      "wallet_unavailable",
      "Casper Wallet could not complete the login. Unlock it and try again."
    );
  }
}

export async function signWalletMessage(
  message: string,
  expectedPublicKey: string,
  browserWindow: WalletBrowserWindow = window as WalletBrowserWindow
): Promise<string> {
  try {
    if (!CASPER_PUBLIC_KEY.test(expectedPublicKey)) {
      throw walletError("wallet_public_key_invalid", "The connected AgentPay session has an invalid account key.");
    }
    const provider = walletProvider(browserWindow);
    const activePublicKey = await connectedPublicKey(provider);
    if (activePublicKey.toLowerCase() !== expectedPublicKey.toLowerCase()) {
      throw walletError(
        "wallet_account_changed",
        "Casper Wallet switched accounts. Reconnect the wallet you used to sign in."
      );
    }
    return await signWithProvider(provider, message, activePublicKey);
  } catch (cause) {
    if (cause instanceof AuditApiError) throw cause;
    throw walletError(
      "wallet_unavailable",
      "Casper Wallet could not sign this action. Unlock it and try again."
    );
  }
}

export async function signWalletAuthorization(
  intent: AuthorizationIntent,
  browserWindow: WalletBrowserWindow = window as WalletBrowserWindow
): Promise<string> {
  try {
    if (!CASPER_PUBLIC_KEY.test(intent.payerPublicKey)) {
      throw walletError("wallet_public_key_invalid", "The approved payment has an invalid account key.");
    }
    const provider = walletProvider(browserWindow);
    const activePublicKey = await connectedPublicKey(provider);
    if (activePublicKey.toLowerCase() !== intent.payerPublicKey.toLowerCase()) {
      throw walletError(
        "wallet_account_changed",
        "Casper Wallet switched accounts. Reconnect the wallet AgentPay approved for this payment."
      );
    }
    if (typeof provider.signTypedData !== "function") {
      throw typedDataUnsupported();
    }
    if (typeof provider.getActivePublicKeySupports === "function") {
      const advertised = await provider.getActivePublicKeySupports();
      const features = Array.isArray(advertised) ? advertised : [advertised];
      if (!features.includes("sign-typed-data-eip712")) throw typedDataUnsupported();
    }

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
    const signed = await provider.signTypedData(
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
      activePublicKey
    );
    if (!signed) {
      throw walletError("wallet_unavailable", "Casper Wallet did not return a payment signature.");
    }
    if (signed.cancelled) {
      throw walletError("wallet_cancelled", "Payment signing was cancelled.");
    }
    if (signed.error) {
      throw walletError("wallet_signing_failed", "Casper Wallet could not sign this payment.");
    }
    const signedPublicKey = signed.publicKey?.trim().toLowerCase();
    if (!signedPublicKey || signedPublicKey !== activePublicKey.toLowerCase()) {
      throw walletError(
        "wallet_account_changed",
        "Casper Wallet signed with a different account. No payment was sent."
      );
    }
    const signedDigest = signed.digest?.trim().replace(/^0x/i, "").toLowerCase();
    if (!signedDigest || signedDigest !== intent.digest.toLowerCase()) {
      throw walletError(
        "wallet_digest_mismatch",
        "Casper Wallet signed different payment details. No payment was sent."
      );
    }
    const signature = signatureHex(signed);
    if (!verifyAuthorizationSignature(intent, signature)) {
      throw walletError(
        "wallet_signature_invalid",
        "Casper Wallet returned a signature that did not match the approved payment."
      );
    }
    return signature;
  } catch (cause) {
    if (cause instanceof AuditApiError) throw cause;
    throw walletError(
      "wallet_unavailable",
      "Casper Wallet could not sign this payment. Unlock it and try again."
    );
  }
}

function walletProvider(browserWindow: WalletBrowserWindow): CasperWalletProvider {
  const providerFactory = browserWindow.CasperWalletProvider;
  if (typeof providerFactory !== "function") {
    throw walletError(
      "wallet_not_found",
      "Casper Wallet was not found. Install or unlock the browser extension, then try again."
    );
  }
  const provider = providerFactory({ timeout: WALLET_REQUEST_TIMEOUT_MS });
  if (!isWalletProvider(provider)) {
    throw walletError("wallet_unavailable", "Casper Wallet is not ready. Reload the page and try again.");
  }
  return provider;
}

async function connectedPublicKey(provider: CasperWalletProvider): Promise<string> {
  if (!(await provider.requestConnection())) {
    throw walletError("wallet_cancelled", "Wallet connection was cancelled.");
  }
  const publicKey = (await provider.getActivePublicKey()).trim();
  if (!CASPER_PUBLIC_KEY.test(publicKey)) {
    throw walletError("wallet_public_key_invalid", "Casper Wallet returned an invalid account key.");
  }
  return publicKey;
}

async function signWithProvider(
  provider: CasperWalletProvider,
  message: string,
  publicKey: string
): Promise<string> {
  const signed = await provider.signMessage(message, publicKey);
  if (!signed || signed.cancelled) {
    throw walletError("wallet_cancelled", "Wallet signing was cancelled.");
  }
  return signatureHex(signed);
}

function signatureHex(response: {
  signatureHex?: string | null;
  signature?: string | Uint8Array | null;
}): string {
  const value =
    typeof response.signatureHex === "string"
      ? response.signatureHex
      : typeof response.signature === "string"
        ? response.signature
        : response.signature instanceof Uint8Array
          ? Array.from(response.signature, (byte) => byte.toString(16).padStart(2, "0")).join("")
          : "";
  const normalized = value.replace(/^0x/i, "").toLowerCase();
  if (!CASPER_SIGNATURE.test(normalized)) {
    throw walletError("wallet_signature_invalid", "Casper Wallet returned an invalid signature.");
  }
  return normalized;
}

function typedDataUnsupported(): AuditApiError {
  return walletError(
    "wallet_typed_data_unsupported",
    "This Casper Wallet version cannot sign x402 payments. Update it or use the AgentPay CLI."
  );
}

function isWalletProvider(value: unknown): value is CasperWalletProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Record<string, unknown>;
  return (
    typeof provider.requestConnection === "function" &&
    typeof provider.getActivePublicKey === "function" &&
    typeof provider.signMessage === "function"
  );
}

function walletError(code: string, message: string): AuditApiError {
  return new AuditApiError({ code, message, status: 0, retryable: true });
}
