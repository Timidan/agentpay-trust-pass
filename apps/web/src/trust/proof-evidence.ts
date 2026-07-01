/**
 * Real, public on-chain evidence for the AgentPay Trust Signal — the same
 * Casper Testnet artifacts captured in the submission. These are public
 * identifiers (transaction + contract-package hashes), not secrets, and are
 * meant to be re-checked by anyone on the explorer.
 *
 * Provenance, stated plainly: settlement went through a self-hosted x402
 * facilitator (casper-x402), not the hosted CSPR.cloud path.
 */

export const EXPLORER_BASE = "https://testnet.cspr.live";
export const PROOF_NETWORK = "Casper Testnet";
export const PROOF_PROVENANCE = "Real evidence on Casper Testnet · settled via a self-hosted x402 facilitator (casper-x402).";

const SETTLEMENT_TX = "36cec4739b3576b86c694cc710f54b7d00eb7403779e593b927ead053e939236";
const DECISION_TX = "da99d2cd3f23fbd9e9369c57d9a7442219ea746812a143e29fdbd28b7b43216b";
const REGISTRY_PACKAGE = "73ce206e78b8bc6d5c4ada857c629cd0b9c0dda320d091cd6bdd7c3fa7651d97";
const ASSET_PACKAGE = "a7888ddfbc31455396f3c57583547962a28bcb3b20e60d6be2dea3a8f2991d4d";

export type ProofEdge = {
  label: string;
  /** What this artifact proves, in one line. */
  detail: string;
  hash: string;
  href: string;
};

export const PROOF_EDGES: ProofEdge[] = [
  {
    label: "x402 settlement",
    detail: "The agent paid for evidence — confirmed on Casper",
    hash: SETTLEMENT_TX,
    href: `${EXPLORER_BASE}/transaction/${SETTLEMENT_TX}`
  },
  {
    label: "Verdict recorded",
    detail: "The decision was stamped to the trust registry",
    hash: DECISION_TX,
    href: `${EXPLORER_BASE}/transaction/${DECISION_TX}`
  },
  {
    label: "Trust registry",
    detail: "The on-chain contract that stores verdicts",
    hash: REGISTRY_PACKAGE,
    href: `${EXPLORER_BASE}/contract-package/${REGISTRY_PACKAGE}`
  },
  {
    label: "Payment asset",
    detail: "The CEP-18 token used to settle over x402",
    hash: ASSET_PACKAGE,
    href: `${EXPLORER_BASE}/contract-package/${ASSET_PACKAGE}`
  }
];

/** Short, readable form of a hash (strips a `hash-` prefix). */
export function shortHash(hash: string): string {
  const hex = hash.replace(/^hash-/, "");
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
