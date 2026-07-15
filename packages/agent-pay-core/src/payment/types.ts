export type PaymentVerdict = "pay" | "review" | "block";
export type SettlementVerdict = "match" | "mismatch" | "pending" | "unverifiable";

export type ReasonCode =
  | "invalid_payment_required"
  | "unsupported_x402_version"
  | "unsupported_scheme"
  | "unsupported_network"
  | "resource_scheme_mismatch"
  | "resource_origin_mismatch"
  | "asset_package_not_found"
  | "authorization_entrypoint_missing"
  | "asset_decimals_mismatch"
  | "evidence_unavailable"
  | "provider_unapproved"
  | "provider_tuple_changed"
  | "signed_offer_invalid"
  | "operator_denied"
  | "policy_cap_missing"
  | "policy_per_call_exceeded"
  | "policy_daily_cap_exceeded"
  | "authorization_required"
  | "authorization_field_mismatch"
  | "authorization_not_yet_valid"
  | "authorization_expired"
  | "authorization_replay"
  | "settlement_pending"
  | "settlement_rpc_unavailable"
  | "settlement_shape_unsupported"
  | "settlement_field_mismatch"
  | "settlement_execution_failed"
  | "mint_authority_open"
  | "supply_mutable"
  | "holder_concentration"
  | "very_new_contract";

export type Reason = {
  code: ReasonCode;
  result: "review" | "block" | "advisory";
  message: string;
  field: string | null;
  expected: unknown;
  received: unknown;
};

export type OriginalRequestInput = {
  method: string;
  url: string;
  bodyHash: string;
  bodyBytes: number;
  capturedAt: string;
  adapterVersion: string;
};

export type OriginalRequest = {
  method: string;
  url: string;
  scheme: "http" | "https";
  origin: string;
  path: string;
  bodyHash: string;
  bodyBytes: number;
  capturedAt: string;
  adapterVersion: string;
  requestHash: string;
};

export type PaymentResource = {
  url: string;
  description: string;
  mimeType: string;
};

export type PaymentRequirement = {
  scheme: "exact";
  network: "casper:casper-test";
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    decimals: string | null;
    symbol: string | null;
  };
};

export type PaymentTerms = PaymentRequirement & {
  x402Version: 2;
  acceptanceIndex: number;
  resource: PaymentResource;
  resourceComparison: {
    sameHost: boolean;
    sameScheme: boolean;
    samePath: boolean;
  };
  requirementHash: string;
};

export type NormalizeResult =
  | {
      ok: true;
      request: OriginalRequest;
      terms: PaymentTerms;
      advisories: Reason[];
    }
  | {
      ok: false;
      reasons: Reason[];
    };

export type AuthorizationIntent = {
  payerPublicKey: string;
  from: string;
  to: string;
  amount: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  network: "casper:casper-test";
  asset: string;
  tokenName: string;
  tokenVersion: string;
  digest: string;
};

export type PaymentAssetEvidence = {
  network: "casper:casper-test";
  packageHash: string;
  packageExists: boolean;
  activeContractHash: string | null;
  authorizationEntrypoint: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  mintAuthorityOpen: boolean | null;
  supplyMutable: boolean | null;
  holderConcentrationPct: number | null;
  contractAgeBlocks: number | null;
  observedBlockHash: string | null;
  observedBlockHeight: number | null;
  observedAt: string;
  missing: string[];
  sourceErrors: string[];
  evidenceHash: string;
};

export type OperatorPolicy = {
  policyId: string;
  operatorPublicKey: string;
  revision: number;
  issuedAt: string;
  effectiveAt: string;
  allowedNetworks: Array<"casper:casper-test">;
  allowedPayerPublicKeys: string[];
  assetDailyCaps: Record<string, string>;
  maximumAuthorizationWindowSeconds: number;
  maximumConcurrentReservations: number;
  deniedOrigins: string[];
  deniedPayees: string[];
  deniedAssets: string[];
  evidenceMaxAgeSeconds: number;
  reviewOnInvestmentAdvisories: boolean;
  allowPinnedResourceSchemeMismatch: boolean;
  signature: string;
  policyHash: string;
};

export type ProviderDecision = {
  decisionId: string;
  kind: "pin" | "deny";
  operatorPublicKey: string;
  revision: number;
  origin: string;
  payee: string;
  asset: string;
  network: "casper:casper-test";
  resourcePathPrefix: string | null;
  perCallCeiling: string;
  expiresAt: string;
  promptedByCheckId: string;
  signature: string;
  decisionHash: string;
};

export type PaymentDecision = {
  checkId: string;
  verdict: PaymentVerdict;
  basis: "operator_pinned" | "signed_offer" | null;
  reasons: Reason[];
  advisories: Reason[];
  policyHash: string | null;
  authorizationDigest: string | null;
  reservation: { amount: string; expiresAt: string } | null;
  decidedAt: string;
  decisionHash: string;
};

export type SettlementProof = {
  checkId: string;
  transactionHash: string;
  verdict: SettlementVerdict;
  reasons: Reason[];
  rpcEndpoint: string;
  blockHash: string | null;
  blockHeight: number | null;
  observedAt: string;
  decoded: Record<string, unknown> | null;
  proofHash: string;
};

export type PurchaseReceipt = {
  schemaVersion: "agentpay-purchase/v1";
  receiptId: string;
  checkId: string;
  request: OriginalRequest;
  terms: PaymentTerms;
  evidence: PaymentAssetEvidence;
  policy: OperatorPolicy;
  providerDecision: ProviderDecision;
  decision: PaymentDecision;
  authorization: AuthorizationIntent;
  settlement: SettlementProof;
  response: {
    observerVersion: string;
    status: number;
    contentType: string | null;
    bodyBytes: number;
    bodyHash: string;
    observedAt: string;
  } | null;
  anchor: {
    status: "off_chain_verified" | "pending" | "anchored" | "failed";
    transactionHash: string | null;
  };
  createdAt: string;
  receiptHash: string;
};
