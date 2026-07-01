import { describe, expect, it } from "vitest";
import {
  buildDemoProofBundle,
  formatDemoProofBundleMarkdown,
  type DemoProofBundle
} from "../submission-proof";

const REGISTRY_PACKAGE_HASH = `hash-${"a".repeat(64)}`;
const REGISTRY_INSTALL_HASH = "b".repeat(64);
const SETTLEMENT_HASH = "c".repeat(64);
const DECISION_HASH = "d".repeat(64);
const DATASET_ROOT = "e".repeat(64);

describe("AgentPay demo proof bundle", () => {
  it("assembles a pass/fail proof dossier from submission env evidence", () => {
    const bundle = buildDemoProofBundle({
      env: {
        CASPER_CHAIN_NAME: "casper-test",
        X402_FACILITATOR_URL: "http://127.0.0.1:4022",
        AGENT_PAY_REGISTRY_PACKAGE_HASH: REGISTRY_PACKAGE_HASH,
        AGENT_PAY_REGISTRY_INSTALL_HASH: REGISTRY_INSTALL_HASH,
        AGENT_PAY_SETTLEMENT_TX_HASH: SETTLEMENT_HASH,
        AGENT_PAY_DECISION_TX_HASH: DECISION_HASH,
        AGENT_PAY_QUOTE_ID: "agent-pay-live-8174134-c1129a92d1394e32",
        AGENT_PAY_DATASET_ROOT: DATASET_ROOT
      },
      confirmations: {
        registryInstall: "executed",
        x402Settlement: "executed",
        decisionRecord: "executed"
      },
      generatedAt: "2026-06-29T12:00:00.000Z"
    });

    expect(bundle.status).toBe("pass");
    expect(bundle.facilitator).toEqual({
      url: "http://127.0.0.1:4022",
      kind: "self-hosted"
    });
    expect(bundle.run).toEqual({
      quoteId: "agent-pay-live-8174134-c1129a92d1394e32",
      datasetRoot: DATASET_ROOT
    });
    expect(edge(bundle, "registryPackage")).toMatchObject({
      status: "pass",
      value: REGISTRY_PACKAGE_HASH,
      explorerUrl: `https://testnet.cspr.live/contract-package/${REGISTRY_PACKAGE_HASH}`
    });
    expect(edge(bundle, "registryInstall")).toMatchObject({
      status: "pass",
      value: REGISTRY_INSTALL_HASH,
      explorerUrl: `https://testnet.cspr.live/deploy/${REGISTRY_INSTALL_HASH}`
    });
    expect(edge(bundle, "x402Settlement")).toMatchObject({
      status: "pass",
      value: SETTLEMENT_HASH,
      explorerUrl: `https://testnet.cspr.live/transaction/${SETTLEMENT_HASH}`
    });
    expect(edge(bundle, "decisionRecord")).toMatchObject({
      status: "pass",
      value: DECISION_HASH,
      explorerUrl: `https://testnet.cspr.live/deploy/${DECISION_HASH}`
    });
  });

  it("marks missing or unconfirmed proof edges as fail without hiding the captured hashes", () => {
    const bundle = buildDemoProofBundle({
      env: {
        X402_FACILITATOR_URL: "https://x402-facilitator.cspr.cloud",
        AGENT_PAY_REGISTRY_PACKAGE_HASH: "not-a-package-hash",
        AGENT_PAY_REGISTRY_INSTALL_HASH: REGISTRY_INSTALL_HASH,
        AGENT_PAY_SETTLEMENT_TX_HASH: SETTLEMENT_HASH
      },
      confirmations: {
        registryInstall: "pending",
        x402Settlement: "unverified",
        decisionRecord: "missing"
      },
      generatedAt: "2026-06-29T12:00:00.000Z"
    });

    expect(bundle.status).toBe("fail");
    expect(bundle.facilitator.kind).toBe("hosted");
    expect(edge(bundle, "registryPackage")).toMatchObject({
      status: "fail",
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars"
    });
    expect(edge(bundle, "registryInstall")).toMatchObject({
      status: "fail",
      value: REGISTRY_INSTALL_HASH,
      message: "AGENT_PAY_REGISTRY_INSTALL_HASH is still pending on Casper"
    });
    expect(edge(bundle, "x402Settlement")).toMatchObject({
      status: "fail",
      value: SETTLEMENT_HASH,
      message: "AGENT_PAY_SETTLEMENT_TX_HASH was not confirmed as executed on Casper"
    });
    expect(edge(bundle, "decisionRecord")).toMatchObject({
      status: "fail",
      value: null,
      message: "AGENT_PAY_DECISION_TX_HASH is required"
    });
  });

  it("formats a replayable markdown bundle with explorer links and run metadata", () => {
    const bundle = buildDemoProofBundle({
      env: {
        CASPER_CHAIN_NAME: "casper-test",
        X402_FACILITATOR_URL: "http://127.0.0.1:4022",
        AGENT_PAY_REGISTRY_PACKAGE_HASH: REGISTRY_PACKAGE_HASH,
        AGENT_PAY_REGISTRY_INSTALL_HASH: REGISTRY_INSTALL_HASH,
        AGENT_PAY_SETTLEMENT_TX_HASH: SETTLEMENT_HASH,
        AGENT_PAY_DECISION_TX_HASH: DECISION_HASH,
        AGENT_PAY_QUOTE_ID: "agent-pay-live-8174134-c1129a92d1394e32",
        AGENT_PAY_DATASET_ROOT: DATASET_ROOT
      },
      confirmations: {
        registryInstall: "executed",
        x402Settlement: "executed",
        decisionRecord: "executed"
      },
      generatedAt: "2026-06-29T12:00:00.000Z"
    });

    const markdown = formatDemoProofBundleMarkdown(bundle);

    expect(markdown).toContain("# Demo Proof Bundle");
    expect(markdown).toContain("Status: PASS");
    expect(markdown).toContain("Facilitator: self-hosted (`http://127.0.0.1:4022`)");
    expect(markdown).toContain("Quote ID: `agent-pay-live-8174134-c1129a92d1394e32`");
    expect(markdown).toContain(`Dataset/Merkle root: \`${DATASET_ROOT}\``);
    expect(markdown).toContain(`| Registry install | PASS | \`${REGISTRY_INSTALL_HASH}\` | AGENT_PAY_REGISTRY_INSTALL_HASH is confirmed executed on Casper | [cspr.live](https://testnet.cspr.live/deploy/${REGISTRY_INSTALL_HASH}) |`);
    expect(markdown).toContain(`| x402 settlement | PASS | \`${SETTLEMENT_HASH}\` | AGENT_PAY_SETTLEMENT_TX_HASH is confirmed executed on Casper | [cspr.live](https://testnet.cspr.live/transaction/${SETTLEMENT_HASH}) |`);
  });
});

function edge(bundle: DemoProofBundle, id: string) {
  const found = bundle.edges.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing proof edge ${id}`);
  return found;
}
