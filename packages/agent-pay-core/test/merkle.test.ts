import { describe, expect, it } from "vitest";
import { buildDataset, hashReport, sha256Hex, verifyReportProof, type EvidenceRecord } from "../src/index";

function record(index: number): EvidenceRecord {
  const rawHash = sha256Hex(`raw-${index}`);
  return {
    id: `record-${index}-${rawHash.slice(0, 8)}`,
    product: "runtime-source",
    network: "casper-runtime",
    subject: `subject-${index}`,
    observedAt: new Date(index * 1000).toISOString(),
    sourceUrl: `https://source.invalid/${index}`,
    facts: {
      height: index,
      sourceHash: rawHash
    },
    rawHash
  };
}

describe("AgentPay core Merkle proofs", () => {
  it("builds a deterministic dataset root and verifies an included report", () => {
    const dataset = buildDataset("dataset-runtime", [record(1), record(2), record(3)]);
    const report = dataset.reports[1];

    expect(dataset.root).toMatch(/^[0-9a-f]{64}$/);
    expect(report.proof.length).toBeGreaterThan(0);
    expect(verifyReportProof(report.record, report.proof, dataset.root)).toBe(true);
  });

  it("rejects a report when a fact changes after proof generation", () => {
    const dataset = buildDataset("dataset-runtime", [record(1), record(2), record(3)]);
    const report = dataset.reports[0];

    const changed: EvidenceRecord = {
      ...report.record,
      facts: { ...report.record.facts, height: 99 }
    };

    expect(verifyReportProof(changed, report.proof, dataset.root)).toBe(false);
  });

  it("hashes records independent of object insertion order", () => {
    const left = record(4);
    const right: EvidenceRecord = {
      rawHash: left.rawHash,
      facts: left.facts,
      sourceUrl: left.sourceUrl,
      observedAt: left.observedAt,
      subject: left.subject,
      network: left.network,
      product: left.product,
      id: left.id
    };

    expect(hashReport(left)).toBe(hashReport(right));
  });
});
