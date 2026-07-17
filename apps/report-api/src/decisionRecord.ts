import {
  verifyDecisionRecordRpcResult,
  type DecisionRecordProof,
  type DecisionRecordVerification
} from "@agent-pay/core";
import { NodeRpcClient, NodeRpcError } from "./auditor/casperRpc.js";

export type { DecisionRecordProof, DecisionRecordVerification } from "@agent-pay/core";

export type DecisionRecordVerifierOptions = {
  rpcUrl: string;
  registryPackageHash: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type DecisionRecordVerifier = (
  proof: DecisionRecordProof
) => Promise<DecisionRecordVerification>;

export function createDecisionRecordVerifier(
  options: DecisionRecordVerifierOptions
): DecisionRecordVerifier {
  return (proof) => verifyDecisionRecordOnChain(proof, options);
}

export async function verifyDecisionRecordOnChain(
  proof: DecisionRecordProof,
  options: DecisionRecordVerifierOptions
): Promise<DecisionRecordVerification> {
  let result: unknown;
  try {
    const rpc = new NodeRpcClient({
      rpcUrl: options.rpcUrl,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs ?? 15_000
    });
    result = await rpc.call("info_get_transaction", {
      transaction_hash: {
        [proof.hashKind === "transaction" ? "Version1" : "Deploy"]:
          proof.transactionHash.toLowerCase()
      }
    });
  } catch (error) {
    if (
      error instanceof NodeRpcError &&
      (error.code === -32001 || /(?:not found|no such)/i.test(error.message))
    ) {
      return { verified: false, reason: "record_not_found" };
    }
    return { verified: false, reason: "record_verification_unavailable" };
  }

  return verifyDecisionRecordRpcResult(
    proof,
    options.registryPackageHash,
    result
  );
}
