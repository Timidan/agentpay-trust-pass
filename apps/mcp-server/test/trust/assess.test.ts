import { describe, expect, it, vi } from "vitest";
import type { AssessSubjectDeps } from "../../src/trust/assess.js";
import { assessSubject } from "../../src/trust/assess.js";

// ---------------------------------------------------------------------------
// Shared fake helpers
// ---------------------------------------------------------------------------

const FAKE_DATASET_ROOT = "a".repeat(64);
const FAKE_DATASET_ID = "dataset-fake-001";
const FAKE_PAYMENT_RECEIPT_HASH = "r".repeat(64);
const FAKE_SETTLEMENT_TX_HASH = "s".repeat(64);
const FAKE_DECISION_TX_HASH = "d".repeat(64);
const FAKE_SUBJECT = "f".repeat(64);

/** Build a fake EvidenceRecord with the given facts. */
function fakeRecord(id: string, facts: Record<string, unknown>) {
  return {
    id,
    product: "FakeProduct",
    network: "casper:casper-test",
    subject: FAKE_SUBJECT,
    observedAt: "2026-01-01T00:00:00.000Z",
    sourceUrl: "https://example.com",
    facts,
    rawHash: "0".repeat(64),
  };
}

/** Build a fake proof step array (single leaf → empty proof is fine for fakes). */
const FAKE_PROOF: { position: "left" | "right"; hash: string }[] = [];

/** Build a fake ReportProof leaf. */
function fakeLeaf(id: string, facts: Record<string, unknown>) {
  return {
    datasetId: FAKE_DATASET_ID,
    record: fakeRecord(id, facts),
    reportHash: "0".repeat(64),
    proof: FAKE_PROOF,
  };
}

/** A quote result fake. */
const fakeQuoteResult = {
  quoteId: "agent-pay-live-fake-001",
  datasetId: FAKE_DATASET_ID,
  datasetRoot: FAKE_DATASET_ROOT,
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
      extra: { name: "Cep18x402", version: "1", symbol: "CSPR" },
    },
  ],
};

/** A paid result with mintAuthorityOpen=true (triggers DANGER / rejected). */
function fakePaidResultDanger() {
  return {
    datasetId: FAKE_DATASET_ID,
    datasetRoot: FAKE_DATASET_ROOT,
    reportId: "r-001",
    report: fakeRecord("r-001", { mintAuthorityOpen: true }),
    reportHash: "0".repeat(64),
    proof: FAKE_PROOF,
    evidence: [
      fakeLeaf("r-001", { mintAuthorityOpen: true }),
    ],
    paymentReceiptHash: FAKE_PAYMENT_RECEIPT_HASH,
    payment: {
      scheme: "x402",
      status: "settled",
      transactionHash: FAKE_SETTLEMENT_TX_HASH,
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

  it("returns aspect=DANGER and decision=rejected when mintAuthorityOpen=true", async () => {
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

  it("populates all Verdict fields including policyHash, datasetRoot, explorerUrl", async () => {
    const verdict = await assessSubject(
      { subject: FAKE_SUBJECT },
      buildDeps()
    );

    expect(verdict.subject).toMatchObject({ kind: "token", packageHash: FAKE_SUBJECT });
    expect(verdict.datasetRoot).toBe(FAKE_DATASET_ROOT);
    expect(verdict.paymentReceiptHash).toBe(FAKE_PAYMENT_RECEIPT_HASH);
    expect(verdict.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verdict.explorerUrl).toContain(FAKE_DECISION_TX_HASH);
    expect(verdict.explorerUrl).toMatch(/testnet\.cspr\.live\/(transaction|deploy)\//);
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

  it("includes flags in the verdict when mintAuthorityOpen=true", async () => {
    const verdict = await assessSubject(
      { subject: FAKE_SUBJECT },
      buildDeps()
    );

    expect(verdict.flags.length).toBeGreaterThan(0);
    expect(verdict.flags.some((f) => f.code === "mint_authority_open")).toBe(true);
  });
});
