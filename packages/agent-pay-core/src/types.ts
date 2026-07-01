export type EvidenceFactValue = string | number | boolean | null;

export type EvidenceRecord = {
  id: string;
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  facts: Record<string, EvidenceFactValue>;
  rawHash: string;
};

export type ProofStep = {
  position: "left" | "right";
  hash: string;
};

export type ReportProof = {
  datasetId: string;
  record: EvidenceRecord;
  reportHash: string;
  proof: ProofStep[];
};

export type Dataset = {
  datasetId: string;
  root: string;
  reports: ReportProof[];
};
