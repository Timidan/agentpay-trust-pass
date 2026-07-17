import { buildAuthorizationIntent } from "../../../../packages/agent-pay-core/src/payment/authorization";
import type {
  AuthorizationIntent,
  PaymentTerms
} from "../../../../packages/agent-pay-core/src/payment/types";

export function createPaymentDraft(input: {
  terms: PaymentTerms;
  payerPublicKey: string;
  nowEpochSeconds: number;
  webCrypto?: Crypto | null;
}): AuthorizationIntent {
  const webCrypto = input.webCrypto === undefined ? globalThis.crypto : input.webCrypto;
  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new Error("Secure browser randomness is unavailable. Update the browser and try again.");
  }
  const nonce = webCrypto.getRandomValues(new Uint8Array(32));
  return buildAuthorizationIntent({
    terms: input.terms,
    payerPublicKey: input.payerPublicKey,
    nowEpochSeconds: input.nowEpochSeconds,
    nonce: Array.from(nonce, (byte) => byte.toString(16).padStart(2, "0")).join("")
  });
}
