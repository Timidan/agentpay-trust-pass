import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  authorizationDigest,
  compareSettlement,
  decodeCasperX402Transaction,
  type AuthorizationIntent
} from "../../src/payment/index.js";

const TRANSACTION_HASH = "2458f77bcd56ae960c02d0dfba616c63f3008c7ee7e87bcfd861c4da87e774b4";
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/tab402-transaction.json", import.meta.url)), "utf8")
) as unknown;

const approvedWithoutDigest = {
  payerPublicKey: "01aff8a88e9d562dad2befec259a8818371d6d092328e8490bb6fc9644041c7c03",
  from: "00e27bfb95afa9b87a76e76d993928d8d4a1d119aea0f202cf4bf2cc036d534b28",
  to: "00b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8",
  amount: "100000000",
  validAfter: "1783613540",
  validBefore: "1783614440",
  nonce: "c611162ab90e14f33f6593f83674d4438285999b9f68fa33bcd8d69ea784b333",
  network: "casper:casper-test" as const,
  asset: "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf",
  tokenName: "Casper X402 Token",
  tokenVersion: "1"
};
const approved: AuthorizationIntent = {
  ...approvedWithoutDigest,
  digest: authorizationDigest(approvedWithoutDigest)
};

describe("Casper x402 settlement decoding", () => {
  it("decodes every authorization field from the captured Version1 transaction", () => {
    const decoded = decodeCasperX402Transaction(fixture);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.finality).toBe("finalized");
    expect(decoded.transaction).toMatchObject({
      transactionHash: TRANSACTION_HASH,
      chainName: "casper-test",
      packageHash: approved.asset,
      entryPoint: "transfer_with_authorization",
      from: approved.from,
      to: approved.to,
      amount: approved.amount,
      validAfter: approved.validAfter,
      validBefore: approved.validBefore,
      nonce: approved.nonce,
      publicKey: approved.payerPublicKey
    });
    expect(decoded.transaction.signature).toMatch(/^01[0-9a-f]{128}$/);
  });

  it("returns MATCH for the real Tab402 settlement", () => {
    const proof = compare(fixture);

    expect(proof).toMatchObject({
      transactionHash: TRANSACTION_HASH,
      verdict: "match",
      reasons: [],
      blockHash: "300867a5dfecc546b09f07ec22e8cd4aa81596035b9cd2ed4321b9608a0561ec",
      blockHeight: 8449194
    });
    expect(proof.proofHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["chain", (copy: RpcFixture) => setChain(copy, "casper")],
    ["package", (copy: RpcFixture) => setPackage(copy, "f".repeat(64))],
    ["entry point", (copy: RpcFixture) => setEntryPoint(copy, "transfer")],
    ["from", (copy: RpcFixture) => setNamedParsed(copy, "from", `account-hash-${"1".repeat(64)}`)],
    ["to", (copy: RpcFixture) => setNamedParsed(copy, "to", `account-hash-${"2".repeat(64)}`)],
    ["amount", (copy: RpcFixture) => setNamedParsed(copy, "amount", "100000001")],
    ["valid_after", (copy: RpcFixture) => setNamedParsed(copy, "valid_after", 1783613541)],
    ["valid_before", (copy: RpcFixture) => setNamedParsed(copy, "valid_before", 1783614441)],
    ["nonce", (copy: RpcFixture) => setNamedParsed(copy, "nonce", new Array(32).fill(1))],
    ["public key", (copy: RpcFixture) => setNamedParsed(copy, "public_key", `01${"3".repeat(64)}`)],
    ["signature", (copy: RpcFixture) => setNamedParsed(copy, "signature", [1, ...new Array(64).fill(4)])]
  ])("returns MISMATCH when %s differs", (_label, mutate) => {
    const changed = structuredClone(fixture) as RpcFixture;
    mutate(changed);

    const proof = compare(changed);

    expect(proof.verdict).toBe("mismatch");
    expect(proof.reasons.map((reason) => reason.code)).toContain("settlement_field_mismatch");
  });

  it("returns MISMATCH when execution finalized with an error", () => {
    const changed = structuredClone(fixture) as RpcFixture;
    changed.result.execution_info.execution_result.Version2.error_message = "User error: 1";

    const proof = compare(changed);

    expect(proof.verdict).toBe("mismatch");
    expect(proof.reasons.map((reason) => reason.code)).toContain("settlement_execution_failed");
  });

  it("returns PENDING when the transaction exists without execution info", () => {
    const changed = structuredClone(fixture) as RpcFixture;
    changed.result.execution_info = null as unknown as RpcFixture["result"]["execution_info"];

    const proof = compare(changed);

    expect(proof.verdict).toBe("pending");
    expect(proof.reasons.map((reason) => reason.code)).toEqual(["settlement_pending"]);
  });

  it("returns UNVERIFIABLE for an unsupported transaction shape", () => {
    const changed = structuredClone(fixture) as RpcFixture;
    changed.result.transaction = { Deploy: {} } as unknown as RpcFixture["result"]["transaction"];

    const proof = compare(changed);

    expect(proof.verdict).toBe("unverifiable");
    expect(proof.reasons.map((reason) => reason.code)).toEqual(["settlement_shape_unsupported"]);
  });

  it("does not infer the payer from the transaction initiator", () => {
    const changed = structuredClone(fixture) as RpcFixture;
    changed.result.transaction.Version1.payload.initiator_addr.PublicKey = `01${"5".repeat(64)}`;

    expect(compare(changed).verdict).toBe("match");
  });
});

function compare(rpcEnvelope: unknown) {
  return compareSettlement({
    checkId: "check-tab402",
    transactionHash: TRANSACTION_HASH,
    approved,
    rpcEnvelope,
    rpcEndpoint: "https://node.testnet.casper.network/rpc",
    observedAt: "2026-07-15T21:10:00.000Z"
  });
}

type RpcFixture = {
  result: {
    transaction: {
      Version1: {
        payload: {
          initiator_addr: { PublicKey: string };
          chain_name: string;
          fields: {
            args: { Named: Array<[string, { parsed: unknown }]> };
            entry_point: { Custom: string };
            target: { Stored: { id: { ByPackageHash: { addr: string } } } };
          };
        };
      };
    };
    execution_info: {
      execution_result: { Version2: { error_message: string | null } };
    };
  };
};

function setChain(copy: RpcFixture, value: string): void {
  copy.result.transaction.Version1.payload.chain_name = value;
}

function setPackage(copy: RpcFixture, value: string): void {
  copy.result.transaction.Version1.payload.fields.target.Stored.id.ByPackageHash.addr = value;
}

function setEntryPoint(copy: RpcFixture, value: string): void {
  copy.result.transaction.Version1.payload.fields.entry_point.Custom = value;
}

function setNamedParsed(copy: RpcFixture, name: string, value: unknown): void {
  const entry = copy.result.transaction.Version1.payload.fields.args.Named.find(([candidate]) => candidate === name);
  if (!entry) throw new Error(`Missing fixture argument ${name}`);
  entry[1].parsed = value;
}
