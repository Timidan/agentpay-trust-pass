// Compatibility facade for the existing E2E and buyer scripts. The implementation lives in the
// shared client package so every integration signs the same canonical authorization bytes.
export {
  buildX402PaymentSignature,
  createCasperSigner,
  enforceX402SpendPolicy,
  loadCasperSignerFromPem,
  transferWithAuthorizationDigest,
  x402SpendPolicyFromEnv
} from "@agent-pay/client";

export type {
  BuiltPaymentSignature,
  CasperAlgo,
  CasperSigner,
  PaymentRequirement,
  PaymentResource,
  X402SpendPolicy
} from "@agent-pay/client";
