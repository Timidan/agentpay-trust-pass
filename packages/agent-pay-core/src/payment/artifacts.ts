import { artifactHash } from "./canonical.js";
import type { OperatorPolicy, ProviderDecision } from "./types.js";

export function operatorPolicyHash(policy: OperatorPolicy): string {
  const {
    signature: _signature,
    signatureMessage: _signatureMessage,
    policyHash: _policyHash,
    ...content
  } = policy;
  return artifactHash(content);
}

export function providerDecisionHash(decision: ProviderDecision): string {
  const {
    signature: _signature,
    signatureMessage: _signatureMessage,
    decisionHash: _decisionHash,
    ...content
  } = decision;
  return artifactHash(content);
}
