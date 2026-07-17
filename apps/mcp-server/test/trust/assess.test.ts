import { describe, expect, it, vi } from "vitest";
import { hashJson } from "@agent-pay/core";
import type { AssessSubjectDeps } from "../../src/trust/assess.js";
import { assessSubject } from "../../src/trust/assess.js";

// ---------------------------------------------------------------------------
// Shared fake helpers
// ---------------------------------------------------------------------------

const FAKE_DATASET_ROOT = "a".repeat(64);
const FAKE_DATASET_ID = "dataset-fake-001";
const FAKE_PAYMENT_RECEIPT_HASH = "1".repeat(64);
const FAKE_SETTLEMENT_TX_HASH = "2".repeat(64);
const FAKE_DECISION_TX_HASH = "3".repeat(64);
const FAKE_SUBJECT = "f".repeat(64);

/** Build a fake EvidenceRecord with the given facts. */
function fakeRecord(id: string, facts: Record<string, unknown>, subject = "token_authority") {
  return {
    id,
    product: "FakeProduct",
    network: "casper-testnet",
    subject,
    observedAt: "2026-01-01T00:00:00.000Z",
    sourceUrl: "https://example.com",
    facts,
    rawHash: "0".repeat(64),
  };
}

/** Build a fake proof step array (single leaf → empty proof is fine for fakes). */
const FAKE_PROOF: { position: "left" | "right"; hash: string }[] = [];

/** Build a fake ReportProof leaf. */
function fakeLeaf(id: string, facts: Record<string, unknown>, subject: string) {
  const record = fakeRecord(id, facts, subject);
  return {
    datasetId: FAKE_DATASET_ID,
    record,
    reportHash: hashJson(record),
    proof: FAKE_PROOF,
  };
}

/** A quote result fake. */
const fakeQuoteResult = {
  quoteId: "agent-pay-live-fake-001",
  datasetId: FAKE_DATASET_ID,
  datasetRoot: FAKE_DATASET_ROOT,
  evidenceNetwork: "casper-testnet",
  asset: "CSPR",
  amountDisplay: "0.00001",
  assetDecimals: 9,
  reportHash: "0".repeat(64),
  paymentResource: { url: "http://example.com/buy/q1", description: "fake", mimeType: "application/json" },
  paymentRequirements: [
    {
      scheme: "exact",
      network: "casper:casper-test",
      asset: "9".repeat(64),
      amount: "10000",
      payTo: `00${"8".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "CSPR" },
    },
  ],
};

/** A paid result with CEP-18 mint/burn enabled (triggers DANGER / rejected). */
function fakePaidResultDanger() {
  return {
    datasetId: FAKE_DATASET_ID,
    datasetRoot: FAKE_DATASET_ROOT,
    evidenceNetwork: "casper-testnet",
    reportId: "r-001",
    report: fakeRecord("r-001", { mintBurnEnabled: true }),
    reportHash: "0".repeat(64),
    proof: FAKE_PROOF,
    evidence: [
      fakeLeaf("r-001", { mintBurnEnabled: true }, "token_authority"),
      fakeLeaf("r-002", { holderCount: 10, topHolderPct: 20 }, "token_holders"),
      fakeLeaf("r-003", { contractAgeBlocks: 100 }, "token_age"),
    ],
    paymentReceiptHash: FAKE_PAYMENT_RECEIPT_HASH,
    payment: {
      scheme: "x402",
      status: "settled",
      transactionHash: FAKE_SETTLEMENT_TX_HASH,
      amount: "10000",
      amountDisplay: "0.00001",
      asset: "9".repeat(64),
      assetSymbol: "CSPR",
      assetDecimals: 9,
      network: "casper:casper-test",
      confirmation: {
        rpcUrl: "https://rpc.casper-test.example",
        method: "info_get_transaction",
        apiVersion: "2.0",
        executionState: "executed",
        blockHash: "b".repeat(64),
        attempts: 1,
        observedAt: "2026-01-01T00:00:00.000Z",
      },
      facilitatorHash: "f".repeat(64),
    },
  };
}

/** Build a standard deps set with fakes. Override individual fakes per test. */
function buildDeps(overrides: Partial<AssessSubjectDeps> = {}): AssessSubjectDeps {
  return {
    quote: async (_subject: string) => ({ ...fakeQuoteResult }),
    settle: async (_args: { quote: any }) => ({ ...fakePaidResultDanger() }),
    verify: async (_args: { record: any; proof: any; datasetRoot: string }) => ({ verified: true }),
    record: async (_args: any) => ({ txHash: FAKE_DECISION_TX_HASH, hashKind: "transaction" as const }),
    narrate: async (_args: any) => ({ rationale: "This is fine.", notCheckedNote: "All checked." }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assessSubject", () => {
  it("rejects an empty subject string", async () => {
    await expect(
      assessSubject({ subject: "" }, buildDeps())
    ).rejects.toThrow("Invalid subject");
  });

  it("rejects a non-hex subject string", async () => {
    await expect(
      assessSubject({ subject: "not-a-hash" }, buildDeps())
    ).rejects.toThrow("Invalid subject");
  });

  it("returns aspect=DANGER and decision=rejected when CEP-18 mint/burn is enabled", async () => {
    const recordSpy = vi.fn().mockResolvedValue({ txHash: FAKE_DECISION_TX_HASH, hashKind: "transaction" as const });

    const verdict = await assessSubject(
      { subject: FAKE_SUBJECT },
      buildDeps({ record: recordSpy })
    );

    // scoreSubject drives the decision — must be DANGER/rejected
    expect(verdict.aspect).toBe("DANGER");
    expect(verdict.decision).toBe("rejected");

    // recordSpy received "rejected" as the decision
    expect(recordSpy).toHaveBeenCalledOnce();
    const recordArgs = recordSpy.mock.calls[0][0];
    expect(recordArgs.decision).toBe("rejected");

    // Both tx hashes are populated
    expect(verdict.settlementTxHash).toBe(FAKE_SETTLEMENT_TX_HASH);
    expect(verdict.decisionTxHash).toBe(FAKE_DECISION_TX_HASH);
  });

  it("narrator output (rationale) does NOT change Verdict.aspect — scoreSubject owns aspect", async () => {
    // Narrator tries to say "CLEAR" — but aspect must still be DANGER
    const narrrateThatSaysClear = vi.fn().mockResolvedValue({
      rationale: "Everything looks CLEAR and safe.",
      notCheckedNote: "Nothing to report.",
    });

    const verdict = await assessSubject(
      { subject: FAKE_SUBJECT },
      buildDeps({ narrate: narrrateThatSaysClear })
    );

    // aspect comes from scoreSubject, not from narrator
    expect(verdict.aspect).toBe("DANGER");
    expect(verdict.decision).toBe("rejected");

    // The rationale text itself is what the narrator returned (no re-scoring from rationale)
    expect(verdict.rationale).toContain("CLEAR");
  });

  it("throws and never calls record() when any verify() returns {verified:false}", async () => {
    const recordSpy = vi.fn();
    const failingVerify = vi.fn().mockResolvedValue({ verified: false });

    await expect(
      assessSubject(
        { subject: FAKE_SUBJECT },
        buildDeps({ verify: failingVerify, record: recordSpy })
      )
    ).rejects.toThrow(/[Vv]erif/);

    // record must NOT have been called — never stamp unverified evidence
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the paid response omits a required evidence family", async () => {
    const recordSpy = vi.fn();
    const paid = fakePaidResultDanger();
    paid.evidence = paid.evidence.filter((leaf) => leaf.record.subject !== "token_holders");

    await expect(
      assessSubject(
        { subject: FAKE_SUBJECT },
        buildDeps({ settle: async () => paid, record: recordSpy })
      )
    ).rejects.toThrow(/evidence family/i);

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the paid response does not match the quoted dataset", async () => {
    const recordSpy = vi.fn();
    const paid = fakePaidResultDanger();
    paid.datasetRoot = "b".repeat(64);

    await expect(
      assessSubject(
        { subject: FAKE_SUBJECT },
        buildDeps({ settle: async () => paid, record: recordSpy })
      )
    ).rejects.toThrow(/dataset root/i);

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("populates all Verdict fields including policyHash, datasetRoot, explorerUrl", async () => {
    const verdict = await assessSubject(
      { subject: FAKE_SUBJECT },
      buildDeps()
    );

    expect(verdict.subject).toMatchObject({ kind: "token", packageHash: FAKE_SUBJECT });
    expect(verdict.datasetRoot).toBe(FAKE_DATASET_ROOT);
    expect(verdict.evidenceNetwork).toBe("casper-testnet");
    expect(verdict.payment).toEqual({
      amount: "10000",
      amountDisplay: "0.00001",
      asset: "9".repeat(64),
      assetSymbol: "CSPR",
      assetDecimals: 9,
      network: "casper:casper-test"
    });
    expect(verdict.paymentReceiptHash).toBe(FAKE_PAYMENT_RECEIPT_HASH);
    expect(verdict.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verdict.explorerUrl).toContain(FAKE_DECISION_TX_HASH);
    expect(verdict.settlementExplorerUrl).toBe(
      `https://testnet.cspr.live/transaction/${FAKE_SETTLEMENT_TX_HASH}`
    );
    expect(verdict.explorerUrl).toMatch(/testnet\.cspr\.live\/(transaction|deploy)\//);
    expect(verdict.publicationProof).toMatchObject({
      hashKind: "transaction",
      datasetId: FAKE_DATASET_ID,
      datasetRoot: FAKE_DATASET_ROOT,
      paymentReceiptHash: FAKE_PAYMENT_RECEIPT_HASH
    });
    expect(hashJson(verdict.publicationProof.verdictReport)).toBe(
      verdict.publicationProof.reportHash
    );
  });

  it("uses deploy/ in explorerUrl when hashKind=deploy", async () => {
    const verdict = await assessSubject(
      { subject: FAKE_SUBJECT },
      buildDeps({
        record: async () => ({ txHash: FAKE_DECISION_TX_HASH, hashKind: "deploy" as const }),
      })
    );

    expect(verdict.explorerUrl).toBe(`https://testnet.cspr.live/deploy/${FAKE_DECISION_TX_HASH}`);
  });

  it("includes the CEP-18 supply-control flag when mint/burn is enabled", async () => {
    const verdict = await assessSubject(
      { subject: FAKE_SUBJECT },
      buildDeps()
    );

    expect(verdict.flags.length).toBeGreaterThan(0);
    expect(verdict.flags.some((f) => f.code === "cep18_mint_burn_enabled")).toBe(true);
  });

  it("fails closed when paid evidence comes from a different Casper network", async () => {
    const paid = fakePaidResultDanger();
    paid.evidence[0].record.network = "casper-mainnet";
    paid.evidence[0].reportHash = hashJson(paid.evidence[0].record);

    await expect(
      assessSubject(
        { subject: FAKE_SUBJECT },
        buildDeps({ settle: async () => paid })
      )
    ).rejects.toThrow(/different Casper network/);
  });

  it("fails closed when paid amount, asset, or network differs from the quote", async () => {
    const paid = fakePaidResultDanger();
    paid.payment.amount = "9999";

    await expect(
      assessSubject(
        { subject: FAKE_SUBJECT },
        buildDeps({ settle: async () => paid })
      )
    ).rejects.toThrow(/payment details/);
  });
});
