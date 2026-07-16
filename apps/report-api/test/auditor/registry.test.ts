import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PurchaseReceipt } from "@agent-pay/core";
import {
  CommandReceiptAnchorTransport,
  ReceiptAnchorExecutionError,
  ReceiptAnchorPublisher,
  createReceiptAnchorPublisherFromEnv,
  type ReceiptAnchorTransport
} from "../../src/auditor/registry.js";
import type { NodeRpcClient } from "../../src/auditor/casperRpc.js";
import type { AnchorJob, AuditorRepository } from "../../src/auditor/repository.js";
import {
  AGENT_TOKEN,
  FINALIZED_TRANSACTION_RESULT,
  TRANSACTION_HASH as SETTLEMENT_HASH,
  createPayCheck,
  createPaymentAuditContext
} from "./payment-audit-fixture.js";

const NOW = "2026-07-15T22:00:00.000Z";
const TRANSACTION_HASH = "9".repeat(64);

describe("receipt anchor publisher", () => {
  it("submits, confirms, and reads back the exact receipt hash before completing a job", async () => {
    const receipt = receiptFixture();
    const repository = anchorRepository(receipt);
    const transport: ReceiptAnchorTransport = {
      submit: vi.fn(async () => TRANSACTION_HASH),
      confirm: vi.fn(async () => true),
      readReceiptHash: vi.fn(async () => receipt.receiptHash)
    };
    const publisher = new ReceiptAnchorPublisher({
      repository,
      transport,
      now: () => new Date(NOW),
      retryBaseMs: 0,
      autoStart: false
    });
    publisher.enqueue(receipt);

    await expect(publisher.processDue()).resolves.toBe(1);

    expect(repository.getAnchorJob(`anchor-${receipt.receiptId}`)).toMatchObject({
      status: "confirmed",
      attempts: 1,
      transactionHash: TRANSACTION_HASH,
      lastError: null
    });
    expect(transport.submit).toHaveBeenCalledWith({
      receiptHash: receipt.receiptHash,
      policyHash: receipt.policy.policyHash,
      settlementTransactionHash: receipt.settlement.transactionHash,
      outcome: "settlement_matched"
    });
    expect(transport.readReceiptHash).toHaveBeenCalledWith(receipt.receiptHash);
  });

  it("keeps a submitted job retryable when on-chain readback differs", async () => {
    const receipt = receiptFixture();
    const repository = anchorRepository(receipt);
    const transport: ReceiptAnchorTransport = {
      submit: vi.fn(async () => TRANSACTION_HASH),
      confirm: vi.fn(async () => true),
      readReceiptHash: vi.fn(async () => "8".repeat(64))
    };
    const publisher = new ReceiptAnchorPublisher({
      repository,
      transport,
      now: () => new Date(NOW),
      retryBaseMs: 0,
      maxAttempts: 3,
      autoStart: false
    });
    publisher.enqueue(receipt);

    await publisher.processDue();

    expect(repository.getAnchorJob(`anchor-${receipt.receiptId}`)).toMatchObject({
      status: "submitted",
      attempts: 1,
      transactionHash: TRANSACTION_HASH,
      lastError: "Registry receipt hash did not match the finalized receipt"
    });
  });

  it("marks a repeatedly unconfirmed transaction as failed at the retry limit", async () => {
    const receipt = receiptFixture();
    const repository = anchorRepository(receipt);
    const transport: ReceiptAnchorTransport = {
      submit: vi.fn(async () => TRANSACTION_HASH),
      confirm: vi.fn(async () => false),
      readReceiptHash: vi.fn(async () => receipt.receiptHash)
    };
    const publisher = new ReceiptAnchorPublisher({
      repository,
      transport,
      now: () => new Date(NOW),
      retryBaseMs: 0,
      maxAttempts: 2,
      autoStart: false
    });
    publisher.enqueue(receipt);

    await publisher.processDue();
    await publisher.processDue();

    expect(repository.getAnchorJob(`anchor-${receipt.receiptId}`)).toMatchObject({
      status: "failed",
      attempts: 2,
      transactionHash: TRANSACTION_HASH,
      lastError: "Registry transaction is not executed yet"
    });
    expect(transport.submit).toHaveBeenCalledOnce();
    expect(transport.confirm).toHaveBeenCalledTimes(2);
    expect(transport.readReceiptHash).not.toHaveBeenCalled();
  });

  it("fails terminal executions immediately and retries only after an explicit enqueue", async () => {
    const receipt = receiptFixture();
    const repository = anchorRepository(receipt);
    const replacementHash = "8".repeat(64);
    const submit = vi.fn()
      .mockResolvedValueOnce(TRANSACTION_HASH)
      .mockResolvedValueOnce(replacementHash);
    const confirm = vi.fn()
      .mockRejectedValueOnce(new ReceiptAnchorExecutionError("Casper receipt anchor transaction failed during execution"))
      .mockResolvedValueOnce(true);
    const transport: ReceiptAnchorTransport = {
      submit,
      confirm,
      readReceiptHash: vi.fn(async () => receipt.receiptHash)
    };
    const publisher = new ReceiptAnchorPublisher({
      repository,
      transport,
      now: () => new Date(NOW),
      retryBaseMs: 0,
      maxAttempts: 10,
      autoStart: false
    });
    publisher.enqueue(receipt);

    await publisher.processDue();

    expect(repository.getAnchorJob(`anchor-${receipt.receiptId}`)).toMatchObject({
      status: "failed",
      attempts: 1,
      transactionHash: TRANSACTION_HASH,
      lastError: "Casper receipt anchor transaction failed during execution"
    });
    await expect(publisher.processDue()).resolves.toBe(0);

    expect(publisher.enqueue(receipt)).toMatchObject({
      status: "pending",
      attempts: 0,
      transactionHash: null,
      lastError: null
    });
    await publisher.processDue();

    expect(repository.getAnchorJob(`anchor-${receipt.receiptId}`)).toMatchObject({
      status: "confirmed",
      attempts: 1,
      transactionHash: replacementHash,
      lastError: null
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("classifies an on-chain Casper execution error as terminal", async () => {
    const rpc = {
      call: vi.fn(async () => ({
        execution_info: {
          execution_result: {
            Version2: { error_message: "No such method: record_purchase_receipt" }
          }
        }
      }))
    } as unknown as NodeRpcClient;
    const transport = new CommandReceiptAnchorTransport({
      rpc,
      rpcUrl: "https://node.testnet.casper.network/rpc",
      contractHash: "6".repeat(64),
      script: "/unused",
      clientCommand: "/unused",
      env: {}
    });

    await expect(transport.confirm(TRANSACTION_HASH)).rejects.toBeInstanceOf(ReceiptAnchorExecutionError);
    expect(rpc.call).toHaveBeenCalledOnce();
  });

  it("uses the Casper command boundary to submit, confirm, and read back a receipt", async () => {
    const receipt = receiptFixture();
    const dir = await mkdtemp(join(tmpdir(), "agentpay-receipt-anchor-"));
    const submitScript = join(dir, "record-receipt");
    const clientCommand = join(dir, "casper-client");
    const submitCapture = join(dir, "submit.json");
    const clientCapture = join(dir, "client.jsonl");
    const stateRootHash = "5".repeat(64);
    const contractHash = "6".repeat(64);
    const dictionaryResult = JSON.stringify({
      jsonrpc: "2.0",
      result: {
        stored_value: {
          CLValue: {
            parsed: JSON.stringify({ receiptHash: receipt.receiptHash })
          }
        }
      }
    });
    await writeFile(
      submitScript,
      `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(submitCapture)}, JSON.stringify({
  args: process.argv.slice(2),
  env: {
    buyerKey: process.env.CASPER_SECRET_KEY_PATH ?? null,
    apiToken: process.env.AGENT_PAY_API_TOKEN ?? null,
    recorderKey: process.env.AGENT_PAY_REGISTRY_RECORDER_KEY_PATH ?? null,
    packageHash: process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH ?? null
  }
}));
console.log("TRANSACTION_HASH=${TRANSACTION_HASH}");
`
    );
    await writeFile(
      clientCommand,
      `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(clientCapture)}, JSON.stringify(args) + "\\n");
if (args[0] === "get-state-root-hash") {
  console.log("casper-client fixture");
  console.log(${JSON.stringify(JSON.stringify({ result: { state_root_hash: stateRootHash } }))});
} else if (args[0] === "get-dictionary-item") {
  console.log(${JSON.stringify(dictionaryResult)});
} else {
  process.exit(2);
}
`
    );
    await chmod(submitScript, 0o700);
    await chmod(clientCommand, 0o700);

    const rpc = {
      call: vi.fn(async () => ({ execution_info: { execution_result: { Success: {} } } }))
    } as unknown as NodeRpcClient;
    const transport = new CommandReceiptAnchorTransport({
      rpc,
      rpcUrl: "https://node.testnet.casper.network/rpc",
      contractHash,
      script: submitScript,
      clientCommand,
      env: {
        ...process.env,
        CASPER_SECRET_KEY_PATH: "/buyer-key-must-not-cross-the-boundary.pem",
        AGENT_PAY_API_TOKEN: "agent-token-must-not-cross-the-boundary",
        AGENT_PAY_REGISTRY_RECORDER_KEY_PATH: "/dedicated-recorder.pem",
        AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"7".repeat(64)}`
      }
    });

    try {
      await expect(transport.submit({
        receiptHash: receipt.receiptHash,
        policyHash: receipt.policy.policyHash,
        settlementTransactionHash: receipt.settlement.transactionHash,
        outcome: "settlement_matched"
      })).resolves.toBe(TRANSACTION_HASH);
      await expect(transport.confirm(TRANSACTION_HASH)).resolves.toBe(true);
      await expect(transport.readReceiptHash(receipt.receiptHash)).resolves.toBe(receipt.receiptHash);

      expect(JSON.parse(await readFile(submitCapture, "utf8"))).toEqual({
        args: [
          receipt.receiptHash,
          receipt.policy.policyHash,
          receipt.settlement.transactionHash,
          "settlement_matched"
        ],
        env: {
          buyerKey: null,
          apiToken: null,
          recorderKey: "/dedicated-recorder.pem",
          packageHash: `hash-${"7".repeat(64)}`
        }
      });
      expect(rpc.call).toHaveBeenCalledWith("info_get_transaction", {
        transaction_hash: { Version1: TRANSACTION_HASH }
      });
      const clientCalls = (await readFile(clientCapture, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(clientCalls).toEqual([
        ["get-state-root-hash", "--node-address", "https://node.testnet.casper.network/rpc"],
        [
          "get-dictionary-item",
          "--node-address",
          "https://node.testnet.casper.network/rpc",
          "--state-root-hash",
          stateRootHash,
          "--contract-hash",
          `hash-${contractHash}`,
          "--dictionary-name",
          "agentpay_registry_v2_purchase_receipts",
          "--dictionary-item-key",
          receipt.receiptHash
        ]
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stays off-chain when the dedicated recorder configuration is absent", () => {
    const repository = anchorRepository(receiptFixture());
    const publisher = createReceiptAnchorPublisherFromEnv({
      repository,
      rpcUrl: "https://node.testnet.casper.network/rpc",
      env: {
        AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"1".repeat(64)}`,
        AGENT_PAY_REGISTRY_CONTRACT_HASH: `hash-${"2".repeat(64)}`,
        CASPER_SECRET_KEY_PATH: "/buyer-key-must-not-be-used.pem"
      }
    });

    expect(publisher).toBeNull();
  });

  it("stays off-chain when buyer and recorder configuration resolve to the same key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpay-shared-registry-key-"));
    const keyPath = join(dir, "shared.pem");
    await writeFile(keyPath, "one key must not serve both roles");
    try {
      const publisher = createReceiptAnchorPublisherFromEnv({
        repository: anchorRepository(receiptFixture()),
        rpcUrl: "https://node.testnet.casper.network/rpc",
        env: {
          AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"1".repeat(64)}`,
          AGENT_PAY_REGISTRY_CONTRACT_HASH: `hash-${"2".repeat(64)}`,
          AGENT_PAY_REGISTRY_RECORDER_KEY_PATH: keyPath,
          CASPER_SECRET_KEY_PATH: keyPath
        }
      });

      expect(publisher).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists an anchor job atomically when a receipt is finalized", async () => {
    const wake = vi.fn();
    const context = createPaymentAuditContext(FINALIZED_TRANSACTION_RESULT, {
      enqueue: vi.fn(),
      wake
    });
    try {
      const checkId = await createPayCheck(context.app);
      await request(context.app)
        .post(`/v1/checks/${checkId}/verify-settlement`)
        .set("Authorization", `Bearer ${AGENT_TOKEN}`)
        .send({ transactionHash: SETTLEMENT_HASH })
        .expect(200);
      const observed = await request(context.app)
        .post(`/v1/checks/${checkId}/response-observations`)
        .set("Authorization", `Bearer ${AGENT_TOKEN}`)
        .send({
          observerVersion: "agent-pay-client/0.1.0",
          status: 200,
          contentType: "audio/mpeg",
          bodyBytes: 42_000,
          bodyHash: "8".repeat(64),
          observedAt: "2026-07-09T16:13:00.000Z"
        })
        .expect(201);

      const receiptId = observed.body.receipt.receiptId as string;
      expect(context.repository.getAnchorJob(`anchor-${receiptId}`)).toMatchObject({
        receiptId,
        status: "pending",
        attempts: 0
      });
      expect(wake).toHaveBeenCalledOnce();
      const fetched = await request(context.app)
        .get(`/v1/receipts/${receiptId}`)
        .set("Authorization", `Bearer ${AGENT_TOKEN}`)
        .expect(200);
      expect(fetched.body.anchorState).toEqual({ status: "pending", transactionHash: null });
      expect(fetched.body.receipt.anchor).toEqual({ status: "off_chain_verified", transactionHash: null });
    } finally {
      context.repository.close();
    }
  });
});

function anchorRepository(receipt: PurchaseReceipt): AuditorRepository {
  const jobs = new Map<string, AnchorJob>();
  return {
    saveAnchorJob(job: AnchorJob) {
      if (jobs.has(job.id)) return false;
      jobs.set(job.id, structuredClone(job));
      return true;
    },
    updateAnchorJob(job: AnchorJob) {
      if (!jobs.has(job.id)) return false;
      jobs.set(job.id, structuredClone(job));
      return true;
    },
    getAnchorJob(id: string) {
      return structuredClone(jobs.get(id) ?? null);
    },
    listDueAnchorJobs(now: string, limit: number) {
      return [...jobs.values()]
        .filter((job) => ["pending", "submitted"].includes(job.status) && job.nextAttemptAt <= now)
        .slice(0, limit)
        .map((job) => structuredClone(job));
    },
    getReceipt(id: string) {
      return id === receipt.receiptId ? structuredClone(receipt) : null;
    }
  } as unknown as AuditorRepository;
}

function receiptFixture(): PurchaseReceipt {
  return {
    receiptId: "receipt-check-1",
    receiptHash: "1".repeat(64),
    policy: { policyHash: "2".repeat(64) },
    settlement: { transactionHash: "3".repeat(64), verdict: "match" }
  } as PurchaseReceipt;
}
