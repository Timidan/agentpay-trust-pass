import { describe, expect, it } from "vitest";
import {
  verifyDecisionRecordOnChain,
  type DecisionRecordProof
} from "../src/decisionRecord.js";

const TRANSACTION_HASH = "1".repeat(64);
const PACKAGE_HASH = "2".repeat(64);

const proof: DecisionRecordProof = {
  hashKind: "deploy",
  transactionHash: TRANSACTION_HASH,
  datasetId: "trust-casper-mainnet-token-1",
  datasetRoot: "3".repeat(64),
  reportHash: "4".repeat(64),
  paymentReceiptHash: "5".repeat(64),
  decision: "approved"
};

describe("verifyDecisionRecordOnChain", () => {
  it("accepts only an executed Testnet registry call with the exact committed fields", async () => {
    const result = await verifyDecisionRecordOnChain(proof, {
      rpcUrl: "https://node.testnet.example/rpc",
      registryPackageHash: `hash-${PACKAGE_HASH}`,
      fetchImpl: rpcResponse(proof)
    });

    expect(result).toEqual({ verified: true, blockHeight: 8_500_000 });
  });

  it("accepts an executed Casper Version1 transaction with the exact registry call", async () => {
    const transactionProof: DecisionRecordProof = {
      ...proof,
      hashKind: "transaction"
    };
    const result = await verifyDecisionRecordOnChain(transactionProof, {
      rpcUrl: "https://node.testnet.example/rpc",
      registryPackageHash: `hash-${PACKAGE_HASH}`,
      fetchImpl: rpcTransactionResponse(transactionProof)
    });

    expect(result).toEqual({ verified: true, blockHeight: 8_500_000 });
  });

  it("rejects a registry call whose committed report hash differs", async () => {
    const result = await verifyDecisionRecordOnChain(proof, {
      rpcUrl: "https://node.testnet.example/rpc",
      registryPackageHash: PACKAGE_HASH,
      fetchImpl: rpcResponse({ ...proof, reportHash: "f".repeat(64) })
    });

    expect(result).toEqual({ verified: false, reason: "record_arguments_mismatch" });
  });

  it("rejects a failed registry execution", async () => {
    const result = await verifyDecisionRecordOnChain(proof, {
      rpcUrl: "https://node.testnet.example/rpc",
      registryPackageHash: PACKAGE_HASH,
      fetchImpl: rpcResponse(proof, "contract reverted")
    });

    expect(result).toEqual({ verified: false, reason: "record_execution_failed" });
  });

  it("reports an unavailable Casper RPC separately from a missing record", async () => {
    const result = await verifyDecisionRecordOnChain(proof, {
      rpcUrl: "https://node.testnet.example/rpc",
      registryPackageHash: PACKAGE_HASH,
      fetchImpl: (async () => {
        throw new Error("network unavailable");
      }) as typeof fetch
    });

    expect(result).toEqual({
      verified: false,
      reason: "record_verification_unavailable"
    });
  });

  it("reports a Casper RPC not-found response as a missing record", async () => {
    const result = await verifyDecisionRecordOnChain(proof, {
      rpcUrl: "https://node.testnet.example/rpc",
      registryPackageHash: PACKAGE_HASH,
      fetchImpl: (async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { id: unknown };
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32001, message: "transaction not found" }
        });
      }) as typeof fetch
    });

    expect(result).toEqual({ verified: false, reason: "record_not_found" });
  });
});

function rpcResponse(
  recorded: DecisionRecordProof,
  errorMessage: string | null = null
): typeof fetch {
  return (async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: unknown };
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        transaction: {
          Deploy: {
            hash: TRANSACTION_HASH,
            header: { chain_name: "casper-test" },
            session: {
              StoredVersionedContractByHash: {
                hash: PACKAGE_HASH,
                entry_point: "record_decision_with_root",
                args: decisionArgs(recorded)
              }
            }
          }
        },
        execution_info: {
          block_height: 8_500_000,
          execution_result: { Version2: { error_message: errorMessage } }
        }
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function rpcTransactionResponse(recorded: DecisionRecordProof): typeof fetch {
  return (async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: unknown };
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        transaction: {
          Version1: {
            hash: TRANSACTION_HASH,
            payload: {
              chain_name: "casper-test",
              fields: {
                args: { Named: decisionArgs(recorded) },
                entry_point: { Custom: "record_decision_with_root" },
                target: {
                  Stored: {
                    id: { ByPackageHash: { addr: PACKAGE_HASH, version: null } },
                    runtime: "VmCasperV1"
                  }
                }
              }
            }
          }
        },
        execution_info: {
          block_height: 8_500_000,
          execution_result: { Version2: { error_message: null } }
        }
      }
    });
  }) as typeof fetch;
}

function decisionArgs(value: DecisionRecordProof) {
  return [
    argument("dataset_id", value.datasetId),
    argument("dataset_root", value.datasetRoot),
    argument("report_hash", value.reportHash),
    argument("payment_receipt_hash", value.paymentReceiptHash),
    argument("decision", value.decision)
  ];
}

function argument(name: string, parsed: string) {
  return [name, { cl_type: "String", parsed }];
}
