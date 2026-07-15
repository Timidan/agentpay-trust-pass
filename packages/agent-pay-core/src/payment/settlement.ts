import { artifactHash } from "./canonical.js";
import { publicKeyToAccountAddress } from "./casperSignature.js";
import { verifyAuthorizationSignature } from "./authorization.js";
import type {
  AuthorizationIntent,
  Reason,
  ReasonCode,
  SettlementProof,
  SettlementVerdict
} from "./types.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const ACCOUNT_HASH = /^account-hash-([0-9a-f]{64})$/;
const EXPECTED_ARGUMENTS = [
  "amount",
  "from",
  "nonce",
  "public_key",
  "signature",
  "to",
  "valid_after",
  "valid_before"
] as const;

export type DecodedCasperX402Transaction = {
  transactionHash: string;
  chainName: string;
  packageHash: string;
  entryPoint: string;
  from: string;
  to: string;
  amount: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  publicKey: string;
  signature: string;
  executionError: string | null;
};

export type DecodeSettlementResult =
  | {
      ok: true;
      finality: "pending" | "finalized";
      transaction: DecodedCasperX402Transaction;
      blockHash: string | null;
      blockHeight: number | null;
    }
  | {
      ok: false;
      code: "settlement_rpc_unavailable" | "settlement_shape_unsupported";
      message: string;
    };

export function decodeCasperX402Transaction(rpcEnvelope: unknown): DecodeSettlementResult {
  try {
    const envelope = requireRecord(rpcEnvelope, "RPC envelope");
    if (envelope.error !== undefined && envelope.error !== null) {
      return { ok: false, code: "settlement_rpc_unavailable", message: "Casper RPC returned an error" };
    }
    const initialResult = requireRecord(envelope.result, "RPC result");
    const result = asRecord(initialResult.value) ?? initialResult;
    const transaction = requireRecord(result.transaction, "transaction");
    const version1 = requireRecord(transaction.Version1, "transaction.Version1");
    const transactionHash = requireHex64(version1.hash, "transaction hash");
    const payload = requireRecord(version1.payload, "transaction payload");
    const chainName = requireString(payload.chain_name, "chain name");
    const fields = requireRecord(payload.fields, "transaction fields");
    const packageHash = parsePackageHash(fields.target);
    const entryPoint = parseEntryPoint(fields.entry_point);
    const named = parseNamedArguments(fields.args);
    const from = parseAccountKey(named.get("from"), "from");
    const to = parseAccountKey(named.get("to"), "to");
    const amount = parseInteger(named.get("amount"), "amount");
    const validAfter = parseInteger(named.get("valid_after"), "valid_after");
    const validBefore = parseInteger(named.get("valid_before"), "valid_before");
    const nonce = parseByteList(named.get("nonce"), "nonce", 32);
    const publicKey = parsePublicKey(named.get("public_key"));
    const signature = parseByteList(named.get("signature"), "signature", 65);
    const executionInfo = asRecord(result.execution_info);
    const finality = executionInfo ? "finalized" : "pending";
    const executionError = executionInfo ? parseExecutionError(executionInfo) : null;
    const blockHash = executionInfo ? optionalHex64(executionInfo.block_hash) : null;
    const blockHeight = executionInfo ? optionalSafeInteger(executionInfo.block_height) : null;

    return {
      ok: true,
      finality,
      transaction: {
        transactionHash,
        chainName,
        packageHash,
        entryPoint,
        from,
        to,
        amount,
        validAfter,
        validBefore,
        nonce,
        publicKey,
        signature,
        executionError
      },
      blockHash,
      blockHeight
    };
  } catch (error) {
    return {
      ok: false,
      code: "settlement_shape_unsupported",
      message: error instanceof Error ? error.message : "Unsupported Casper transaction shape"
    };
  }
}

export function compareSettlement(input: {
  checkId: string;
  transactionHash: string;
  approved: AuthorizationIntent;
  rpcEnvelope: unknown;
  rpcEndpoint: string;
  observedAt: string;
}): SettlementProof {
  const decoded = decodeCasperX402Transaction(input.rpcEnvelope);
  if (!decoded.ok) {
    return buildProof({
      input,
      verdict: "unverifiable",
      reasons: [reason(decoded.code, "advisory", decoded.message, "transaction", "supported finalized Version1 transaction", null)],
      decoded: null,
      blockHash: null,
      blockHeight: null
    });
  }

  if (decoded.finality === "pending") {
    return buildProof({
      input,
      verdict: "pending",
      reasons: [reason("settlement_pending", "advisory", "Casper transaction is not finalized", "execution_info", "finalized execution", null)],
      decoded: decoded.transaction,
      blockHash: decoded.blockHash,
      blockHeight: decoded.blockHeight
    });
  }

  const reasons: Reason[] = [];
  const transaction = decoded.transaction;
  if (transaction.executionError !== null) {
    reasons.push(
      reason(
        "settlement_execution_failed",
        "block",
        "Casper finalized the transaction with an execution error",
        "execution_result.error_message",
        null,
        transaction.executionError
      )
    );
  }

  compare(reasons, "transaction.hash", input.transactionHash.toLowerCase(), transaction.transactionHash);
  compare(reasons, "transaction.chain_name", chainNameFor(input.approved.network), transaction.chainName);
  compare(reasons, "transaction.target.package", input.approved.asset.toLowerCase(), transaction.packageHash);
  compare(reasons, "transaction.entry_point", "transfer_with_authorization", transaction.entryPoint);
  compare(reasons, "transaction.args.from", input.approved.from.toLowerCase(), transaction.from);
  compare(reasons, "transaction.args.to", input.approved.to.toLowerCase(), transaction.to);
  compare(reasons, "transaction.args.amount", input.approved.amount, transaction.amount);
  compare(reasons, "transaction.args.valid_after", input.approved.validAfter, transaction.validAfter);
  compare(reasons, "transaction.args.valid_before", input.approved.validBefore, transaction.validBefore);
  compare(reasons, "transaction.args.nonce", input.approved.nonce.toLowerCase(), transaction.nonce);
  compare(reasons, "transaction.args.public_key", input.approved.payerPublicKey.toLowerCase(), transaction.publicKey);
  compare(reasons, "transaction.args.from_public_key", publicKeyToAccountAddress(transaction.publicKey), transaction.from);
  if (!verifyAuthorizationSignature(input.approved, transaction.signature)) {
    reasons.push(
      reason(
        "settlement_field_mismatch",
        "block",
        "On-chain authorization signature does not verify for the approved digest",
        "transaction.args.signature",
        "valid signature for approved authorization",
        transaction.signature
      )
    );
  }

  return buildProof({
    input,
    verdict: reasons.length === 0 ? "match" : "mismatch",
    reasons,
    decoded: transaction,
    blockHash: decoded.blockHash,
    blockHeight: decoded.blockHeight
  });
}

function buildProof(args: {
  input: {
    checkId: string;
    transactionHash: string;
    rpcEndpoint: string;
    observedAt: string;
  };
  verdict: SettlementVerdict;
  reasons: Reason[];
  decoded: DecodedCasperX402Transaction | null;
  blockHash: string | null;
  blockHeight: number | null;
}): SettlementProof {
  const proofWithoutHash = {
    checkId: args.input.checkId,
    transactionHash: args.input.transactionHash.toLowerCase(),
    verdict: args.verdict,
    reasons: args.reasons,
    rpcEndpoint: args.input.rpcEndpoint,
    blockHash: args.blockHash,
    blockHeight: args.blockHeight,
    observedAt: new Date(args.input.observedAt).toISOString(),
    decoded: args.decoded
  };
  return {
    ...proofWithoutHash,
    proofHash: artifactHash(proofWithoutHash)
  };
}

function parsePackageHash(value: unknown): string {
  const target = requireRecord(value, "transaction target");
  const stored = requireRecord(target.Stored, "transaction target Stored");
  const id = requireRecord(stored.id, "transaction target id");
  const packageHash = requireRecord(id.ByPackageHash, "transaction target ByPackageHash");
  return requireHex64(packageHash.addr, "transaction package hash");
}

function parseEntryPoint(value: unknown): string {
  const entryPoint = requireRecord(value, "transaction entry point");
  return requireString(entryPoint.Custom, "custom entry point");
}

function parseNamedArguments(value: unknown): Map<string, Record<string, unknown>> {
  const args = requireRecord(value, "transaction arguments");
  if (!Array.isArray(args.Named)) throw new TypeError("Transaction arguments must use the Named shape");
  const named = new Map<string, Record<string, unknown>>();
  for (const item of args.Named) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string") {
      throw new TypeError("Named transaction argument is malformed");
    }
    if (named.has(item[0])) throw new TypeError(`Named transaction argument ${item[0]} is duplicated`);
    named.set(item[0], requireRecord(item[1], `transaction argument ${item[0]}`));
  }
  const names = [...named.keys()].sort();
  if (names.length !== EXPECTED_ARGUMENTS.length || names.some((name, index) => name !== EXPECTED_ARGUMENTS[index])) {
    throw new TypeError("Transaction arguments do not match transfer_with_authorization");
  }
  return named;
}

function parseAccountKey(value: Record<string, unknown> | undefined, label: string): string {
  if (!value) throw new TypeError(`Transaction argument ${label} is missing`);
  if (value.cl_type !== "Key") throw new TypeError(`Transaction argument ${label} must be Key`);
  const parsed = requireString(value.parsed, `transaction argument ${label} parsed value`).toLowerCase();
  const match = ACCOUNT_HASH.exec(parsed);
  if (!match) throw new TypeError(`Transaction argument ${label} must be an account hash`);
  return `00${match[1]}`;
}

function parseInteger(value: Record<string, unknown> | undefined, label: string): string {
  if (!value) throw new TypeError(`Transaction argument ${label} is missing`);
  const parsed = value.parsed;
  if (typeof parsed !== "string" && typeof parsed !== "number") {
    throw new TypeError(`Transaction argument ${label} must be an integer`);
  }
  const normalized = String(parsed);
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) throw new TypeError(`Transaction argument ${label} must be non-negative`);
  return normalized;
}

function parseByteList(value: Record<string, unknown> | undefined, label: string, expectedLength: number): string {
  if (!value || !Array.isArray(value.parsed)) throw new TypeError(`Transaction argument ${label} must be a byte list`);
  if (value.parsed.length !== expectedLength) throw new TypeError(`Transaction argument ${label} must contain ${expectedLength} bytes`);
  const bytes = value.parsed.map((item) => {
    if (!Number.isInteger(item) || item < 0 || item > 255) throw new TypeError(`Transaction argument ${label} contains a non-byte value`);
    return item;
  });
  return Buffer.from(bytes).toString("hex");
}

function parsePublicKey(value: Record<string, unknown> | undefined): string {
  if (!value || value.cl_type !== "PublicKey") throw new TypeError("Transaction public_key argument must be PublicKey");
  const parsed = requireString(value.parsed, "transaction public_key parsed value").toLowerCase();
  publicKeyToAccountAddress(parsed);
  return parsed;
}

function parseExecutionError(executionInfo: Record<string, unknown>): string | null {
  const result = requireRecord(executionInfo.execution_result, "execution result");
  const version = asRecord(result.Version2) ?? asRecord(result.Version1);
  if (!version) throw new TypeError("Execution result version is unsupported");
  if (version.error_message === null || version.error_message === undefined) return null;
  return requireString(version.error_message, "execution error");
}

function compare(reasons: Reason[], field: string, expected: unknown, received: unknown): void {
  if (expected === received) return;
  reasons.push(
    reason(
      "settlement_field_mismatch",
      "block",
      "Finalized Casper transaction differs from the approved authorization",
      field,
      expected,
      received
    )
  );
}

function chainNameFor(network: AuthorizationIntent["network"]): string {
  if (network === "casper:casper-test") return "casper-test";
  throw new TypeError(`Unsupported Casper network ${network}`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new TypeError(`${label} must be an object`);
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function requireHex64(value: unknown, label: string): string {
  const normalized = requireString(value, label).toLowerCase().replace(/^(?:hash-|contract-)/, "");
  if (!HEX_64.test(normalized)) throw new TypeError(`${label} must be 64 hexadecimal characters`);
  return normalized;
}

function optionalHex64(value: unknown): string | null {
  return value === undefined || value === null ? null : requireHex64(value, "block hash");
}

function optionalSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function reason(
  code: ReasonCode,
  result: Reason["result"],
  message: string,
  field: string,
  expected: unknown,
  received: unknown
): Reason {
  return { code, result, message, field, expected, received };
}
