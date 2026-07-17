const HEX_64 = /^[0-9a-f]{64}$/i;
const DATASET_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export type DecisionRecordProof = {
  hashKind: "deploy" | "transaction";
  transactionHash: string;
  datasetId: string;
  datasetRoot: string;
  reportHash: string;
  paymentReceiptHash: string;
  decision: "approved" | "needs_review" | "rejected";
};

export type DecisionRecordVerification =
  | { verified: true; blockHeight: number }
  | {
      verified: false;
      reason:
        | "invalid_record_proof"
        | "unsupported_hash_kind"
        | "record_not_found"
        | "record_verification_unavailable"
        | "record_pending"
        | "record_execution_failed"
        | "record_chain_mismatch"
        | "record_contract_mismatch"
        | "record_arguments_mismatch";
    };

export function verifyDecisionRecordRpcResult(
  proof: DecisionRecordProof,
  registryPackageHash: string,
  result: unknown
): DecisionRecordVerification {
  if (!validProof(proof)) return { verified: false, reason: "invalid_record_proof" };

  const packageHash = normalizePackageHash(registryPackageHash);
  if (!packageHash) return { verified: false, reason: "record_contract_mismatch" };

  const root = asRecord(result);
  const call = proof.hashKind === "deploy"
    ? readDeployCall(root, proof.transactionHash, packageHash)
    : readVersion1Call(root, proof.transactionHash, packageHash);
  if (call.error) return { verified: false, reason: call.error };

  const executionInfo = asRecord(root?.execution_info);
  const executionResult = asRecord(executionInfo?.execution_result);
  if (!executionResult) return { verified: false, reason: "record_pending" };
  if (failedExecution(executionResult)) {
    return { verified: false, reason: "record_execution_failed" };
  }

  const args = stringArguments(call.args);
  const expected = new Map<string, string>([
    ["dataset_id", proof.datasetId],
    ["dataset_root", proof.datasetRoot.toLowerCase()],
    ["report_hash", proof.reportHash.toLowerCase()],
    ["payment_receipt_hash", proof.paymentReceiptHash.toLowerCase()],
    ["decision", proof.decision]
  ]);
  if (
    args.size !== expected.size ||
    [...expected].some(([name, value]) => args.get(name) !== value)
  ) {
    return { verified: false, reason: "record_arguments_mismatch" };
  }

  const blockHeight = executionInfo?.block_height;
  if (!Number.isSafeInteger(blockHeight) || (blockHeight as number) < 0) {
    return { verified: false, reason: "record_pending" };
  }
  return { verified: true, blockHeight: blockHeight as number };
}

type CallShape = {
  args: unknown;
  error: null | "record_not_found" | "record_chain_mismatch" | "record_contract_mismatch";
};

function readDeployCall(
  root: Record<string, unknown> | null,
  transactionHash: string,
  packageHash: string
): CallShape {
  const deploy = asRecord(asRecord(root?.transaction)?.Deploy);
  if (!deploy || lowerHex(deploy.hash) !== transactionHash.toLowerCase()) {
    return { args: null, error: "record_not_found" };
  }
  if (asRecord(deploy.header)?.chain_name !== "casper-test") {
    return { args: null, error: "record_chain_mismatch" };
  }

  const session = asRecord(asRecord(deploy.session)?.StoredVersionedContractByHash);
  if (
    !session ||
    lowerHex(session.hash) !== packageHash ||
    session.entry_point !== "record_decision_with_root"
  ) {
    return { args: null, error: "record_contract_mismatch" };
  }
  return { args: session.args, error: null };
}

function readVersion1Call(
  root: Record<string, unknown> | null,
  transactionHash: string,
  packageHash: string
): CallShape {
  const transaction = asRecord(asRecord(root?.transaction)?.Version1);
  if (!transaction || lowerHex(transaction.hash) !== transactionHash.toLowerCase()) {
    return { args: null, error: "record_not_found" };
  }
  const payload = asRecord(transaction.payload);
  if (payload?.chain_name !== "casper-test") {
    return { args: null, error: "record_chain_mismatch" };
  }

  const fields = asRecord(payload.fields);
  const entryPoint = asRecord(fields?.entry_point);
  const target = asRecord(asRecord(asRecord(fields?.target)?.Stored)?.id);
  const byPackageHash = asRecord(target?.ByPackageHash);
  if (
    entryPoint?.Custom !== "record_decision_with_root" ||
    lowerHex(byPackageHash?.addr) !== packageHash
  ) {
    return { args: null, error: "record_contract_mismatch" };
  }
  return { args: asRecord(fields?.args)?.Named, error: null };
}

function validProof(value: DecisionRecordProof): boolean {
  return (
    (value.hashKind === "deploy" || value.hashKind === "transaction") &&
    HEX_64.test(value.transactionHash) &&
    DATASET_ID.test(value.datasetId) &&
    HEX_64.test(value.datasetRoot) &&
    HEX_64.test(value.reportHash) &&
    HEX_64.test(value.paymentReceiptHash) &&
    (value.decision === "approved" ||
      value.decision === "needs_review" ||
      value.decision === "rejected")
  );
}

function normalizePackageHash(value: string): string | null {
  const normalized = value.replace(/^hash-/i, "").toLowerCase();
  return HEX_64.test(normalized) ? normalized : null;
}

function stringArguments(value: unknown): Map<string, string> {
  const args = new Map<string, string>();
  if (!Array.isArray(value)) return args;
  for (const candidate of value) {
    if (!Array.isArray(candidate) || candidate.length !== 2) continue;
    const [name, raw] = candidate;
    const clValue = asRecord(raw);
    if (
      typeof name !== "string" ||
      clValue?.cl_type !== "String" ||
      typeof clValue.parsed !== "string" ||
      args.has(name)
    ) {
      continue;
    }
    args.set(name, clValue.parsed);
  }
  return args;
}

function failedExecution(value: Record<string, unknown>): boolean {
  const version = asRecord(value.Version2) ?? asRecord(value.Version1) ?? value;
  if (typeof version.error_message === "string" && version.error_message.length > 0) return true;
  return findKey(version, "Failure") !== undefined;
}

function findKey(value: unknown, key: string): unknown {
  const record = asRecord(value);
  if (!record) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  for (const child of Object.values(record)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function lowerHex(value: unknown): string | null {
  return typeof value === "string" && HEX_64.test(value) ? value.toLowerCase() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
