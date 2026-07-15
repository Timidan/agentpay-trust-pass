import { artifactHash, canonicalJson } from "./canonical.js";
import { authorizationDigest, verifyAuthorizationSignature } from "./authorization.js";
import {
  operatorActionMessage,
  publicKeyToAccountAddress,
  verifyCasperMessageSignature
} from "./casperSignature.js";
import { operatorPolicyHash, providerDecisionHash } from "./policy.js";
import type {
  OperatorPolicy,
  PaymentTerms,
  ProviderDecision,
  PurchaseReceipt
} from "./types.js";

const HASH = /^[0-9a-f]{64}$/;
const OPERATOR_MESSAGE_PREFIX = "AgentPay Operator Action v1\n";

export type PurchaseReceiptInput = Omit<PurchaseReceipt, "schemaVersion" | "receiptHash">;

export type ReceiptVerificationError = {
  code: string;
  field: string;
  message: string;
};

export type ReceiptVerificationResult = {
  verified: boolean;
  errors: ReceiptVerificationError[];
};

export function buildPurchaseReceipt(input: PurchaseReceiptInput): PurchaseReceipt {
  const content = {
    schemaVersion: "agentpay-purchase/v1" as const,
    ...input
  };
  const receipt: PurchaseReceipt = {
    ...content,
    receiptHash: artifactHash(content)
  };
  const verification = verifyPurchaseReceipt(receipt);
  if (!verification.verified) {
    const summary = verification.errors.map((error) => `${error.field}: ${error.message}`).join("; ");
    throw new TypeError(`Cannot build an invalid purchase receipt: ${summary}`);
  }
  return receipt;
}

export function verifyPurchaseReceipt(value: unknown): ReceiptVerificationResult {
  const errors: ReceiptVerificationError[] = [];
  if (!isRecord(value)) {
    return invalidShape("receipt", "Purchase receipt must be an object");
  }

  const receipt = value as unknown as PurchaseReceipt;
  try {
    verifyStructure(receipt, errors);
    if (errors.some((error) => error.code === "receipt_invalid_shape")) {
      return { verified: false, errors };
    }

    verifyArtifactHashes(receipt, errors);
    verifySignedControls(receipt, errors);
    verifyBindings(receipt, errors);
    verifySettlement(receipt, errors);
    verifyResponseAndAnchor(receipt, errors);
    verifyOuterHash(receipt, errors);
  } catch (error) {
    add(
      errors,
      "receipt_invalid_shape",
      "receipt",
      error instanceof Error ? error.message : "Purchase receipt is malformed"
    );
  }

  return { verified: errors.length === 0, errors };
}

function verifyStructure(receipt: PurchaseReceipt, errors: ReceiptVerificationError[]): void {
  if (receipt.schemaVersion !== "agentpay-purchase/v1") {
    add(errors, "receipt_schema_unsupported", "schemaVersion", "Receipt schema version is unsupported");
  }
  for (const [field, value] of [
    ["receiptId", receipt.receiptId],
    ["checkId", receipt.checkId]
  ] as const) {
    if (typeof value !== "string" || value.length < 1 || value.length > 128) {
      add(errors, "receipt_invalid_shape", field, `${field} must contain 1 to 128 characters`);
    }
  }
  for (const [field, value] of [
    ["request", receipt.request],
    ["terms", receipt.terms],
    ["evidence", receipt.evidence],
    ["policy", receipt.policy],
    ["providerDecision", receipt.providerDecision],
    ["decision", receipt.decision],
    ["authorization", receipt.authorization],
    ["settlement", receipt.settlement],
    ["anchor", receipt.anchor]
  ] as const) {
    if (!isRecord(value)) add(errors, "receipt_invalid_shape", field, `${field} must be an object`);
  }
  if (!isRecord(receipt.response)) {
    add(errors, "receipt_invalid_shape", "response", "A completed receipt must include response metadata");
  }
  if (!isCanonicalTimestamp(receipt.createdAt)) {
    add(errors, "receipt_invalid_shape", "createdAt", "Receipt creation time must be a canonical ISO timestamp");
  }
  if (!isHash(receipt.receiptHash)) {
    add(errors, "receipt_invalid_shape", "receiptHash", "Receipt hash must be lowercase hexadecimal");
  }
}

function verifyArtifactHashes(receipt: PurchaseReceipt, errors: ReceiptVerificationError[]): void {
  const { requestHash: _requestHash, ...requestContent } = receipt.request;
  equalHash(errors, "request_hash_mismatch", "request.requestHash", receipt.request.requestHash, artifactHash(requestContent));

  equalHash(
    errors,
    "terms_hash_mismatch",
    "terms.requirementHash",
    receipt.terms.requirementHash,
    paymentTermsHash(receipt.terms)
  );

  const { evidenceHash: _evidenceHash, ...evidenceContent } = receipt.evidence;
  equalHash(
    errors,
    "evidence_hash_mismatch",
    "evidence.evidenceHash",
    receipt.evidence.evidenceHash,
    artifactHash(evidenceContent)
  );

  equalHash(
    errors,
    "policy_hash_mismatch",
    "policy.policyHash",
    receipt.policy.policyHash,
    operatorPolicyHash(receipt.policy)
  );
  equalHash(
    errors,
    "provider_hash_mismatch",
    "providerDecision.decisionHash",
    receipt.providerDecision.decisionHash,
    providerDecisionHash(receipt.providerDecision)
  );

  const { decisionHash: _decisionHash, ...decisionContent } = receipt.decision;
  equalHash(
    errors,
    "decision_hash_mismatch",
    "decision.decisionHash",
    receipt.decision.decisionHash,
    artifactHash(decisionContent)
  );

  equalHash(
    errors,
    "authorization_digest_mismatch",
    "authorization.digest",
    receipt.authorization.digest,
    authorizationDigest(receipt.authorization)
  );

  const { proofHash: _proofHash, ...proofContent } = receipt.settlement;
  equalHash(
    errors,
    "settlement_hash_mismatch",
    "settlement.proofHash",
    receipt.settlement.proofHash,
    artifactHash(proofContent)
  );
}

function verifySignedControls(receipt: PurchaseReceipt, errors: ReceiptVerificationError[]): void {
  verifySignedControl(
    receipt.policy,
    "policy_revision",
    receipt.policy.policyHash,
    "policy",
    errors
  );
  verifySignedControl(
    receipt.providerDecision,
    "provider_decision",
    receipt.providerDecision.decisionHash,
    "providerDecision",
    errors
  );
}

function verifySignedControl(
  artifact: OperatorPolicy | ProviderDecision,
  actionKind: "policy_revision" | "provider_decision",
  expectedHash: string,
  field: string,
  errors: ReceiptVerificationError[]
): void {
  const message = artifact.signatureMessage;
  if (typeof message !== "string" || !message.startsWith(OPERATOR_MESSAGE_PREFIX)) {
    add(errors, "operator_message_invalid", `${field}.signatureMessage`, "Signed operator message has an unsupported format");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message.slice(OPERATOR_MESSAGE_PREFIX.length));
  } catch {
    add(errors, "operator_message_invalid", `${field}.signatureMessage`, "Signed operator message is not valid JSON");
    return;
  }
  if (!isRecord(payload) || operatorActionMessage(payload) !== message) {
    add(errors, "operator_message_invalid", `${field}.signatureMessage`, "Signed operator message is not canonical");
    return;
  }

  const requestedAction = isRecord(payload.requestedAction) ? payload.requestedAction : null;
  const origin = typeof payload.origin === "string" ? safeUrl(payload.origin) : null;
  const exactPayloadKeys = [
    "challengeId",
    "domain",
    "expiresAt",
    "issuedAt",
    "kind",
    "network",
    "nonce",
    "operatorPublicKey",
    "origin",
    "purpose",
    "requestedAction",
    "version"
  ];
  const payloadValid =
    canonicalJson(Object.keys(payload).sort()) === canonicalJson(exactPayloadKeys) &&
    payload.kind === "agentpay_auth_challenge" &&
    payload.version === 1 &&
    payload.network === "casper:casper-test" &&
    payload.purpose === "operator_action" &&
    payload.operatorPublicKey === artifact.operatorPublicKey &&
    typeof payload.challengeId === "string" && payload.challengeId.length > 0 &&
    typeof payload.nonce === "string" && isHash(payload.nonce) &&
    isCanonicalTimestamp(payload.issuedAt) &&
    isCanonicalTimestamp(payload.expiresAt) &&
    Date.parse(payload.expiresAt as string) > Date.parse(payload.issuedAt as string) &&
    origin !== null && origin.origin === payload.origin &&
    payload.domain === origin.host &&
    requestedAction !== null &&
    canonicalJson(Object.keys(requestedAction).sort()) === canonicalJson(["artifactHash", "kind", "revision"]) &&
    requestedAction.kind === actionKind &&
    requestedAction.artifactHash === expectedHash &&
    requestedAction.revision === artifact.revision;
  if (!payloadValid) {
    add(errors, "operator_message_invalid", `${field}.signatureMessage`, "Signed operator message does not bind this exact artifact");
  }

  if (!verifyCasperMessageSignature({
    message,
    publicKeyHex: artifact.operatorPublicKey,
    signatureHex: artifact.signature
  })) {
    add(errors, "operator_signature_invalid", `${field}.signature`, "Operator signature does not verify");
  }
}

function verifyBindings(receipt: PurchaseReceipt, errors: ReceiptVerificationError[]): void {
  const { request, terms, evidence, policy, providerDecision, decision, authorization } = receipt;
  const requestUrl = safeUrl(request.url);
  const resourceUrl = safeUrl(terms.resource.url);
  if (!requestUrl || !resourceUrl) {
    add(errors, "receipt_binding_mismatch", "request.url", "Request and resource URLs must be valid HTTP(S) URLs");
  } else {
    compare(errors, "request.scheme", request.scheme, requestUrl.protocol.slice(0, -1));
    compare(errors, "request.origin", request.origin, requestUrl.origin);
    compare(errors, "request.path", request.path, `${requestUrl.pathname}${requestUrl.search}`);
    compare(errors, "terms.resourceComparison.sameHost", terms.resourceComparison.sameHost, requestUrl.host === resourceUrl.host);
    compare(errors, "terms.resourceComparison.sameScheme", terms.resourceComparison.sameScheme, requestUrl.protocol === resourceUrl.protocol);
    compare(
      errors,
      "terms.resourceComparison.samePath",
      terms.resourceComparison.samePath,
      `${requestUrl.pathname}${requestUrl.search}` === `${resourceUrl.pathname}${resourceUrl.search}`
    );
  }

  compare(errors, "decision.checkId", decision.checkId, receipt.checkId);
  compare(errors, "settlement.checkId", receipt.settlement.checkId, receipt.checkId);
  compare(errors, "decision.verdict", decision.verdict, "pay");
  compare(errors, "decision.basis", decision.basis, "operator_pinned");
  compare(errors, "decision.policyHash", decision.policyHash, policy.policyHash);
  compare(errors, "decision.authorizationDigest", decision.authorizationDigest, authorization.digest);
  compare(errors, "decision.reservation.amount", decision.reservation?.amount, terms.amount);
  if (decision.reasons.length !== 0) {
    add(errors, "receipt_binding_mismatch", "decision.reasons", "A PAY decision cannot contain blocking or review reasons");
  }

  compare(errors, "policy.operatorPublicKey", policy.operatorPublicKey, providerDecision.operatorPublicKey);
  includes(errors, "policy.allowedNetworks", policy.allowedNetworks, terms.network);
  includes(errors, "policy.allowedPayerPublicKeys", policy.allowedPayerPublicKeys, authorization.payerPublicKey);
  compare(errors, "providerDecision.kind", providerDecision.kind, "pin");
  compare(errors, "providerDecision.origin", providerDecision.origin, request.origin);
  compare(errors, "providerDecision.payee", providerDecision.payee, terms.payTo);
  compare(errors, "providerDecision.asset", providerDecision.asset, terms.asset);
  compare(errors, "providerDecision.network", providerDecision.network, terms.network);
  if (providerDecision.resourcePathPrefix !== null && !request.path.startsWith(providerDecision.resourcePathPrefix)) {
    add(errors, "receipt_binding_mismatch", "providerDecision.resourcePathPrefix", "Provider pin does not cover the request path");
  }
  if (!decimalAtLeast(providerDecision.perCallCeiling, terms.amount)) {
    add(errors, "receipt_binding_mismatch", "providerDecision.perCallCeiling", "Payment exceeds the signed provider ceiling");
  }
  const dailyCap = policy.assetDailyCaps[terms.asset];
  if (dailyCap === undefined || !decimalAtLeast(dailyCap, terms.amount)) {
    add(errors, "receipt_binding_mismatch", "policy.assetDailyCaps", "Payment is not covered by the signed asset cap");
  }

  compare(errors, "authorization.from", authorization.from, publicKeyToAccountAddress(authorization.payerPublicKey));
  compare(errors, "authorization.to", authorization.to, terms.payTo);
  compare(errors, "authorization.amount", authorization.amount, terms.amount);
  compare(errors, "authorization.network", authorization.network, terms.network);
  compare(errors, "authorization.asset", authorization.asset, terms.asset);
  compare(errors, "authorization.tokenName", authorization.tokenName, terms.extra.name);
  compare(errors, "authorization.tokenVersion", authorization.tokenVersion, terms.extra.version);

  compare(errors, "evidence.network", evidence.network, terms.network);
  compare(errors, "evidence.packageHash", evidence.packageHash, terms.asset);
  compare(errors, "evidence.packageExists", evidence.packageExists, true);
  compare(errors, "evidence.authorizationEntrypoint", evidence.authorizationEntrypoint, true);
  compare(errors, "evidence.name", evidence.name, terms.extra.name);
  if (terms.extra.decimals !== null) compare(errors, "evidence.decimals", evidence.decimals, Number(terms.extra.decimals));

  const decidedAt = Date.parse(decision.decidedAt);
  if (!Number.isFinite(decidedAt)) {
    add(errors, "receipt_binding_mismatch", "decision.decidedAt", "Decision timestamp is invalid");
  } else {
    if (Date.parse(policy.effectiveAt) > decidedAt) {
      add(errors, "receipt_binding_mismatch", "policy.effectiveAt", "Policy was not effective when the decision was made");
    }
    if (Date.parse(providerDecision.expiresAt) <= decidedAt) {
      add(errors, "receipt_binding_mismatch", "providerDecision.expiresAt", "Provider pin had expired before the decision");
    }
    const decisionSeconds = Math.floor(decidedAt / 1_000);
    const validAfter = Number(authorization.validAfter);
    const validBefore = Number(authorization.validBefore);
    if (
      !Number.isSafeInteger(validAfter) ||
      !Number.isSafeInteger(validBefore) ||
      validAfter > decisionSeconds ||
      validBefore <= decisionSeconds ||
      validBefore - validAfter > policy.maximumAuthorizationWindowSeconds ||
      validBefore - decisionSeconds > terms.maxTimeoutSeconds
    ) {
      add(errors, "receipt_binding_mismatch", "authorization.validBefore", "Authorization validity window does not cover the PAY decision");
    }
  }
}

function verifySettlement(receipt: PurchaseReceipt, errors: ReceiptVerificationError[]): void {
  const { settlement, authorization } = receipt;
  compare(errors, "settlement.verdict", settlement.verdict, "match");
  if (settlement.reasons.length !== 0) {
    add(errors, "settlement_binding_mismatch", "settlement.reasons", "A matching settlement cannot contain mismatch reasons");
  }
  if (!isHash(settlement.transactionHash)) {
    add(errors, "settlement_binding_mismatch", "settlement.transactionHash", "Settlement transaction hash is malformed");
  }
  if (!isHash(settlement.blockHash) || !Number.isSafeInteger(settlement.blockHeight) || (settlement.blockHeight ?? -1) < 0) {
    add(errors, "settlement_binding_mismatch", "settlement.blockHash", "Matching settlement must include finalized block data");
  }
  if (!isRecord(settlement.decoded)) {
    add(errors, "settlement_binding_mismatch", "settlement.decoded", "Matching settlement must include decoded transaction fields");
    return;
  }

  const decoded = settlement.decoded;
  compare(errors, "settlement.decoded.transactionHash", decoded.transactionHash, settlement.transactionHash);
  compare(errors, "settlement.decoded.chainName", decoded.chainName, "casper-test");
  compare(errors, "settlement.decoded.packageHash", decoded.packageHash, authorization.asset);
  compare(errors, "settlement.decoded.entryPoint", decoded.entryPoint, "transfer_with_authorization");
  compare(errors, "settlement.decoded.from", decoded.from, authorization.from);
  compare(errors, "settlement.decoded.to", decoded.to, authorization.to);
  compare(errors, "settlement.decoded.amount", decoded.amount, authorization.amount);
  compare(errors, "settlement.decoded.validAfter", decoded.validAfter, authorization.validAfter);
  compare(errors, "settlement.decoded.validBefore", decoded.validBefore, authorization.validBefore);
  compare(errors, "settlement.decoded.nonce", decoded.nonce, authorization.nonce);
  compare(errors, "settlement.decoded.publicKey", decoded.publicKey, authorization.payerPublicKey);
  compare(errors, "settlement.decoded.executionError", decoded.executionError, null);
  if (typeof decoded.signature !== "string" || !verifyAuthorizationSignature(authorization, decoded.signature)) {
    add(errors, "settlement_signature_invalid", "settlement.decoded.signature", "Settlement authorization signature does not verify");
  }
}

function verifyResponseAndAnchor(receipt: PurchaseReceipt, errors: ReceiptVerificationError[]): void {
  const response = receipt.response;
  if (!response) return;
  if (typeof response.observerVersion !== "string" || response.observerVersion.length < 1 || response.observerVersion.length > 128) {
    add(errors, "receipt_response_invalid", "response.observerVersion", "Response observer version is invalid");
  }
  if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
    add(errors, "receipt_response_invalid", "response.status", "Response status is outside the HTTP range");
  }
  if (response.contentType !== null && (typeof response.contentType !== "string" || response.contentType.length > 256)) {
    add(errors, "receipt_response_invalid", "response.contentType", "Response content type is invalid");
  }
  if (!Number.isSafeInteger(response.bodyBytes) || response.bodyBytes < 0) {
    add(errors, "receipt_response_invalid", "response.bodyBytes", "Response body length is invalid");
  }
  if (!isHash(response.bodyHash)) {
    add(errors, "receipt_response_invalid", "response.bodyHash", "Response body hash is malformed");
  }
  if (!isCanonicalTimestamp(response.observedAt)) {
    add(errors, "receipt_response_invalid", "response.observedAt", "Response observation time is invalid");
  }
  if (
    isCanonicalTimestamp(receipt.createdAt) &&
    isCanonicalTimestamp(response.observedAt) &&
    Date.parse(response.observedAt) > Date.parse(receipt.createdAt)
  ) {
    add(errors, "receipt_response_invalid", "response.observedAt", "Response observation cannot occur after receipt creation");
  }
  if (
    isCanonicalTimestamp(receipt.settlement.observedAt) &&
    isCanonicalTimestamp(receipt.createdAt) &&
    Date.parse(receipt.settlement.observedAt) > Date.parse(receipt.createdAt)
  ) {
    add(errors, "settlement_binding_mismatch", "settlement.observedAt", "Settlement observation cannot occur after receipt creation");
  }

  const { anchor } = receipt;
  if (!isRecord(anchor)) return;
  if (anchor.status === "anchored") {
    if (!isHash(anchor.transactionHash)) {
      add(errors, "receipt_anchor_invalid", "anchor.transactionHash", "Anchored receipt must include a transaction hash");
    }
  } else if (!["off_chain_verified", "pending", "failed"].includes(anchor.status)) {
    add(errors, "receipt_anchor_invalid", "anchor.status", "Receipt anchor status is unsupported");
  } else if (anchor.status === "off_chain_verified" && anchor.transactionHash !== null) {
    add(errors, "receipt_anchor_invalid", "anchor.transactionHash", "Off-chain receipt cannot claim an anchor transaction");
  } else if (anchor.transactionHash !== null && !isHash(anchor.transactionHash)) {
    add(errors, "receipt_anchor_invalid", "anchor.transactionHash", "Receipt anchor transaction hash is malformed");
  }
}

function verifyOuterHash(receipt: PurchaseReceipt, errors: ReceiptVerificationError[]): void {
  const { receiptHash: _receiptHash, ...content } = receipt;
  equalHash(errors, "receipt_hash_mismatch", "receiptHash", receipt.receiptHash, artifactHash(content));
}

function paymentTermsHash(terms: PaymentTerms): string {
  const {
    x402Version,
    acceptanceIndex,
    resource,
    resourceComparison: _resourceComparison,
    requirementHash: _requirementHash,
    ...requirement
  } = terms;
  return artifactHash({ x402Version, acceptanceIndex, requirement, resource });
}

function compare(
  errors: ReceiptVerificationError[],
  field: string,
  received: unknown,
  expected: unknown
): void {
  if (canonicalJson(received) !== canonicalJson(expected)) {
    add(errors, "receipt_binding_mismatch", field, `${field} does not match the approved purchase`);
  }
}

function includes(
  errors: ReceiptVerificationError[],
  field: string,
  values: unknown,
  expected: unknown
): void {
  if (!Array.isArray(values) || !values.includes(expected)) {
    add(errors, "receipt_binding_mismatch", field, `${field} does not include the approved value`);
  }
}

function equalHash(
  errors: ReceiptVerificationError[],
  code: string,
  field: string,
  received: unknown,
  expected: string
): void {
  if (received !== expected) add(errors, code, field, `${field} does not match its canonical content`);
}

function decimalAtLeast(limit: unknown, amount: unknown): boolean {
  if (typeof limit !== "string" || typeof amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(limit) || !/^(0|[1-9][0-9]*)$/.test(amount)) {
    return false;
  }
  return BigInt(limit) >= BigInt(amount);
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(
  errors: ReceiptVerificationError[],
  code: string,
  field: string,
  message: string
): void {
  errors.push({ code, field, message });
}

function invalidShape(field: string, message: string): ReceiptVerificationResult {
  return {
    verified: false,
    errors: [{ code: "receipt_invalid_shape", field, message }]
  };
}
