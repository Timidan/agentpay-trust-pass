import { hashJson, sha256Hex } from "./hash.js";
import type { Dataset, EvidenceRecord, ProofStep } from "./types.js";

type Leaf = {
  id: string;
  hash: string;
};

export function hashReport(record: EvidenceRecord): string {
  return hashJson(record);
}

export function buildDataset(datasetId: string, records: EvidenceRecord[]): Dataset {
  if (records.length === 0) {
    throw new Error("Cannot build Merkle tree without rows");
  }

  const leaves = records.map((record) => ({
    id: record.id,
    hash: hashReport(record)
  }));

  const levels = buildLevels(leaves.map((leaf) => leaf.hash));
  const root = levels[levels.length - 1][0];

  return {
    datasetId,
    root,
    reports: records.map((record, index) => ({
      datasetId,
      record,
      reportHash: leaves[index].hash,
      proof: buildProof(index, levels)
    }))
  };
}

export function verifyReportProof(record: EvidenceRecord, proof: ProofStep[], root: string): boolean {
  let current = hashReport(record);

  for (const step of proof) {
    current =
      step.position === "left"
        ? hashPair(step.hash, current)
        : hashPair(current, step.hash);
  }

  return current === root;
}

function buildLevels(leafHashes: string[]): string[][] {
  const levels = [leafHashes];

  while (levels[levels.length - 1].length > 1) {
    const previous = levels[levels.length - 1];
    const next: string[] = [];

    for (let index = 0; index < previous.length; index += 2) {
      const left = previous[index];
      const right = previous[index + 1] ?? left;
      next.push(hashPair(left, right));
    }

    levels.push(next);
  }

  return levels;
}

function buildProof(leafIndex: number, levels: string[][]): ProofStep[] {
  const proof: ProofStep[] = [];
  let index = leafIndex;

  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const level = levels[levelIndex];
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = level[siblingIndex] ?? level[index];

    proof.push({
      position: index % 2 === 0 ? "right" : "left",
      hash: sibling
    });

    index = Math.floor(index / 2);
  }

  return proof;
}

function hashPair(left: string, right: string): string {
  return sha256Hex(`${left}:${right}`);
}

export function findReport(dataset: Dataset, recordId: string) {
  const report = dataset.reports.find((candidate) => candidate.record.id === recordId);
  if (!report) {
    throw new Error(`Unknown leaf id: ${recordId}`);
  }
  return report;
}

export function leafHashes(records: EvidenceRecord[]): Leaf[] {
  return records.map((record) => ({ id: record.id, hash: hashReport(record) }));
}
