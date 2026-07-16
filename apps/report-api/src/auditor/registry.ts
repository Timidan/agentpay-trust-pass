import { execFile } from "node:child_process";
import { constants, accessSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PurchaseReceipt } from "@agent-pay/core";
import { NodeRpcClient } from "./casperRpc.js";
import type { AnchorJob, AuditorRepository } from "./repository.js";

const execFileAsync = promisify(execFile);
const HASH = /^[0-9a-f]{64}$/;
const FORMATTED_HASH = /^(?:hash-)?([0-9a-f]{64})$/;
const DEFAULT_SCRIPT = "contracts/agent-pay-registry/scripts/record-receipt-testnet.sh";
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_INTERVAL_MS = 15_000;
const BATCH_SIZE = 20;
const MAX_RETRY_MS = 5 * 60 * 1_000;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export type ReceiptAnchorInput = {
  receiptHash: string;
  policyHash: string;
  settlementTransactionHash: string;
  outcome: "settlement_matched";
};

export interface ReceiptAnchorTransport {
  submit(input: ReceiptAnchorInput): Promise<string>;
  confirm(transactionHash: string): Promise<boolean>;
  readReceiptHash(receiptHash: string): Promise<string | null>;
}

export class ReceiptAnchorExecutionError extends Error {
  override readonly name = "ReceiptAnchorExecutionError";
}

export type ReceiptAnchorPublisherOptions = {
  repository: AuditorRepository;
  transport: ReceiptAnchorTransport;
  now?: () => Date;
  maxAttempts?: number;
  retryBaseMs?: number;
  intervalMs?: number;
  autoStart?: boolean;
};

export class ReceiptAnchorPublisher {
  private readonly repository: AuditorRepository;
  private readonly transport: ReceiptAnchorTransport;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly autoStart: boolean;
  private interval: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: ReceiptAnchorPublisherOptions) {
    this.repository = options.repository;
    this.transport = options.transport;
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = positiveInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, "maxAttempts");
    this.retryBaseMs = nonNegativeInteger(options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS, "retryBaseMs");
    this.autoStart = options.autoStart ?? true;
    if (this.autoStart) {
      const intervalMs = positiveInteger(options.intervalMs ?? DEFAULT_INTERVAL_MS, "intervalMs");
      this.interval = setInterval(() => void this.processDue(), intervalMs);
      this.interval.unref();
      this.wake();
    }
  }

  enqueue(receipt: PurchaseReceipt): AnchorJob {
    const job = createReceiptAnchorJob(receipt, this.nowDate());
    if (!this.repository.saveAnchorJob(job)) {
      const existing = this.repository.getAnchorJob(job.id);
      const storedReceipt = existing ? this.repository.getReceipt(existing.receiptId) : null;
      if (
        !existing
        || existing.receiptId !== receipt.receiptId
        || !storedReceipt
        || storedReceipt.receiptHash !== receipt.receiptHash
      ) {
        throw new Error("Receipt anchor job conflicts with an existing record");
      }
      if (existing.status === "failed") {
        const retried: AnchorJob = {
          ...existing,
          status: "pending",
          attempts: 0,
          nextAttemptAt: job.nextAttemptAt,
          transactionHash: null,
          lastError: null,
          updatedAt: job.updatedAt
        };
        if (!this.repository.updateAnchorJob(retried)) {
          throw new Error("Receipt anchor retry was not persisted");
        }
        this.wake();
        return retried;
      }
      return existing;
    }
    this.wake();
    return job;
  }

  wake(): void {
    if (!this.autoStart || this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.processDue();
    }, 0);
    this.wakeTimer.unref();
  }

  async processDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const jobs = this.repository.listDueAnchorJobs(this.nowDate().toISOString(), BATCH_SIZE);
      for (const job of jobs) await this.processJob(job);
      return jobs.length;
    } finally {
      this.running = false;
    }
  }

  close(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.interval = null;
    this.wakeTimer = null;
  }

  private async processJob(job: AnchorJob): Promise<void> {
    const receipt = this.repository.getReceipt(job.receiptId);
    if (!receipt) {
      this.failJob(job, null, "Finalized receipt was not found");
      return;
    }

    let transactionHash = job.transactionHash;
    try {
      if (!transactionHash) {
        transactionHash = normalizeHash(await this.transport.submit(anchorInput(receipt)), "registry transaction hash");
        const submitted: AnchorJob = {
          ...job,
          status: "submitted",
          transactionHash,
          updatedAt: this.nowDate().toISOString()
        };
        if (!this.repository.updateAnchorJob(submitted)) throw new Error("Receipt anchor job was not persisted");
        job = submitted;
      }

      if (!(await this.transport.confirm(transactionHash))) {
        throw new Error("Registry transaction is not executed yet");
      }
      const storedReceiptHash = await this.transport.readReceiptHash(receipt.receiptHash);
      if (storedReceiptHash !== receipt.receiptHash) {
        throw new Error("Registry receipt hash did not match the finalized receipt");
      }

      const updatedAt = this.nowDate().toISOString();
      const confirmed: AnchorJob = {
        ...job,
        status: "confirmed",
        attempts: job.attempts + 1,
        nextAttemptAt: updatedAt,
        transactionHash,
        lastError: null,
        updatedAt
      };
      if (!this.repository.updateAnchorJob(confirmed)) throw new Error("Receipt anchor confirmation was not persisted");
    } catch (error) {
      this.failJob(
        job,
        transactionHash,
        safeError(error),
        error instanceof ReceiptAnchorExecutionError
      );
    }
  }

  private failJob(
    job: AnchorJob,
    transactionHash: string | null,
    message: string,
    forceTerminal = false
  ): void {
    const attempts = job.attempts + 1;
    const updatedAt = this.nowDate();
    const terminal = forceTerminal || attempts >= this.maxAttempts;
    const failed: AnchorJob = {
      ...job,
      status: terminal ? "failed" : transactionHash ? "submitted" : "pending",
      attempts,
      nextAttemptAt: new Date(updatedAt.getTime() + retryDelay(this.retryBaseMs, attempts)).toISOString(),
      transactionHash,
      lastError: message,
      updatedAt: updatedAt.toISOString()
    };
    if (!this.repository.updateAnchorJob(failed)) {
      throw new Error("Receipt anchor failure state was not persisted");
    }
  }

  private nowDate(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError("Receipt anchor publisher clock returned an invalid date");
    }
    return value;
  }
}

export function createReceiptAnchorJob(receipt: PurchaseReceipt, now: Date): AnchorJob {
  requireReceiptFields(receipt);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Receipt anchor job time is invalid");
  }
  const timestamp = now.toISOString();
  return {
    id: `anchor-${receipt.receiptId}`,
    receiptId: receipt.receiptId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: timestamp,
    transactionHash: null,
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export type ReceiptAnchorFactoryOptions = {
  repository: AuditorRepository;
  rpcUrl: string;
  rpc?: NodeRpcClient;
  env?: NodeJS.ProcessEnv;
};

export function createReceiptAnchorPublisherFromEnv(
  options: ReceiptAnchorFactoryOptions
): ReceiptAnchorPublisher | null {
  const env = options.env ?? process.env;
  const packageHash = formattedHash(env.AGENT_PAY_REGISTRY_PACKAGE_HASH);
  const contractHash = formattedHash(env.AGENT_PAY_REGISTRY_CONTRACT_HASH);
  const recorderKeyValue = env.AGENT_PAY_REGISTRY_RECORDER_KEY_PATH?.trim();
  if (!packageHash || !contractHash || !recorderKeyValue) return null;

  const defaultRepoRoot = resolve(MODULE_DIR, "../../../..");
  const repoRoot = resolve(env.AGENT_PAY_REPO_ROOT?.trim() || defaultRepoRoot);
  if (repoRoot !== defaultRepoRoot && env.AGENT_PAY_ALLOW_CUSTOM_RECORD_SCRIPTS !== "1") return null;
  const recorderKeyPath = resolve(repoRoot, recorderKeyValue);
  const buyerKeyValue = env.CASPER_SECRET_KEY_PATH?.trim();
  if (buyerKeyValue && sameFile(recorderKeyPath, resolve(repoRoot, buyerKeyValue))) return null;

  const requestedScript = env.AGENT_PAY_RECEIPT_RECORD_SCRIPT?.trim();
  if (
    requestedScript &&
    requestedScript !== DEFAULT_SCRIPT &&
    env.AGENT_PAY_ALLOW_CUSTOM_RECORD_SCRIPTS !== "1"
  ) {
    return null;
  }
  const script = resolve(repoRoot, requestedScript || DEFAULT_SCRIPT);
  const requestedClient = env.CASPER_CLIENT_COMMAND?.trim() || "casper-client";
  if (requestedClient !== "casper-client" && env.AGENT_PAY_ALLOW_CUSTOM_CASPER_CLIENT !== "1") {
    return null;
  }
  try {
    accessSync(recorderKeyPath, constants.R_OK);
    accessSync(script, constants.X_OK);
  } catch {
    return null;
  }

  const rpc = options.rpc ?? new NodeRpcClient({ rpcUrl: options.rpcUrl });
  const transport = new CommandReceiptAnchorTransport({
    rpc,
    rpcUrl: options.rpcUrl,
    contractHash,
    script,
    clientCommand: requestedClient,
    env: {
      ...env,
      AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${packageHash}`,
      AGENT_PAY_REGISTRY_RECORDER_KEY_PATH: recorderKeyPath,
      CASPER_RPC_URL: options.rpcUrl
    }
  });
  return new ReceiptAnchorPublisher({ repository: options.repository, transport });
}

type CommandReceiptAnchorTransportOptions = {
  rpc: NodeRpcClient;
  rpcUrl: string;
  contractHash: string;
  script: string;
  clientCommand: string;
  env: NodeJS.ProcessEnv;
};

export class CommandReceiptAnchorTransport implements ReceiptAnchorTransport {
  private readonly rpc: NodeRpcClient;
  private readonly rpcUrl: string;
  private readonly contractHash: string;
  private readonly script: string;
  private readonly clientCommand: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: CommandReceiptAnchorTransportOptions) {
    this.rpc = options.rpc;
    this.rpcUrl = options.rpcUrl;
    this.contractHash = options.contractHash;
    this.script = options.script;
    this.clientCommand = options.clientCommand;
    this.env = receiptAnchorChildEnv(options.env);
  }

  async submit(input: ReceiptAnchorInput): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        this.script,
        [input.receiptHash, input.policyHash, input.settlementTransactionHash, input.outcome],
        { encoding: "utf8", env: this.env, timeout: 60_000, maxBuffer: 1024 * 1024 }
      );
      const hash = submittedHash(stdout);
      if (!hash) throw new Error();
      return hash;
    } catch {
      throw new Error("Casper receipt anchor submission failed");
    }
  }

  async confirm(transactionHash: string): Promise<boolean> {
    for (const variant of ["Version1", "Deploy"] as const) {
      try {
        const result = await this.rpc.call("info_get_transaction", {
          transaction_hash: { [variant]: transactionHash }
        });
        const state = executionState(result);
        if (state === "failed") {
          throw new ReceiptAnchorExecutionError("Casper receipt anchor transaction failed during execution");
        }
        if (state === "executed") return true;
      } catch (error) {
        if (error instanceof ReceiptAnchorExecutionError) throw error;
      }
    }
    return false;
  }

  async readReceiptHash(receiptHash: string): Promise<string | null> {
    try {
      const stateRootOutput = await execFileAsync(
        this.clientCommand,
        ["get-state-root-hash", "--node-address", this.rpcUrl],
        { encoding: "utf8", env: this.env, timeout: 30_000, maxBuffer: 1024 * 1024 }
      );
      const stateRootHash = findNamedString(parseCommandJson(stateRootOutput.stdout), "state_root_hash");
      if (!stateRootHash || !HASH.test(stateRootHash)) throw new Error();
      const dictionaryOutput = await execFileAsync(
        this.clientCommand,
        [
          "get-dictionary-item",
          "--node-address",
          this.rpcUrl,
          "--state-root-hash",
          stateRootHash,
          "--contract-hash",
          `hash-${this.contractHash}`,
          "--dictionary-name",
          "agentpay_registry_v2_purchase_receipts",
          "--dictionary-item-key",
          receiptHash
        ],
        { encoding: "utf8", env: this.env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
      );
      const parsed = findNamedValue(parseCommandJson(dictionaryOutput.stdout), "parsed");
      if (typeof parsed !== "string") return null;
      const anchor = asRecord(JSON.parse(parsed) as unknown);
      return typeof anchor?.receiptHash === "string" ? anchor.receiptHash : null;
    } catch {
      throw new Error("Casper receipt anchor readback failed");
    }
  }
}

function anchorInput(receipt: PurchaseReceipt): ReceiptAnchorInput {
  requireReceiptFields(receipt);
  return {
    receiptHash: receipt.receiptHash,
    policyHash: receipt.policy.policyHash,
    settlementTransactionHash: receipt.settlement.transactionHash,
    outcome: "settlement_matched"
  };
}

function requireReceiptFields(receipt: PurchaseReceipt): void {
  normalizeHash(receipt.receiptHash, "receipt hash");
  normalizeHash(receipt.policy.policyHash, "policy hash");
  normalizeHash(receipt.settlement.transactionHash, "settlement transaction hash");
  if (receipt.settlement.verdict !== "match") {
    throw new TypeError("Only a matching settlement can be anchored");
  }
}

function executionState(value: unknown): "executed" | "pending" | "failed" {
  const root = unwrapRpcValue(value);
  const executionInfo = root?.execution_info;
  if (executionInfo === null || executionInfo === undefined) return "pending";
  const info = asRecord(executionInfo);
  const result = asRecord(info?.execution_result);
  if (!result) return "pending";
  if ("Failure" in result) return "failed";
  if ("Success" in result) return "executed";
  const version2 = asRecord(result.Version2);
  if (version2) return version2.error_message === null ? "executed" : "failed";
  return "pending";
}

function unwrapRpcValue(value: unknown): Record<string, unknown> | null {
  const root = asRecord(value);
  return asRecord(root?.value) ?? root;
}

function submittedHash(value: string): string | null {
  const match =
    value.match(/TRANSACTION_HASH=([0-9a-fA-F]{64})/) ??
    value.match(/DEPLOY_HASH=([0-9a-fA-F]{64})/) ??
    value.match(/"deploy_hash"\s*:\s*"([0-9a-fA-F]{64})"/) ??
    value.match(/"transaction_hash"[\s\S]*?"([0-9a-fA-F]{64})"/);
  return match ? match[1].toLowerCase() : null;
}

function parseCommandJson(value: string): unknown {
  const start = value.indexOf("{");
  if (start < 0) throw new Error("Casper client did not return JSON");
  return JSON.parse(value.slice(start)) as unknown;
}

function findNamedString(value: unknown, name: string): string | null {
  const found = findNamedValue(value, name);
  return typeof found === "string" ? found : null;
}

function findNamedValue(value: unknown, name: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNamedValue(item, name);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  if (name in record) return record[name];
  for (const item of Object.values(record)) {
    const found = findNamedValue(item, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function retryDelay(base: number, attempts: number): number {
  return Math.min(MAX_RETRY_MS, base * (2 ** Math.max(0, attempts - 1)));
}

function formattedHash(value: string | undefined): string | null {
  const match = value?.trim().match(FORMATTED_HASH);
  return match?.[1] ?? null;
}

function normalizeHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return value;
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 500) : "Receipt anchor operation failed";
}

function receiptAnchorChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "CASPER_CLIENT_COMMAND",
    "CASPER_NODE_ADDRESS",
    "CASPER_RPC_URL",
    "CASPER_CHAIN_NAME",
    "AGENT_PAY_REGISTRY_PACKAGE_HASH",
    "AGENT_PAY_REGISTRY_RECORDER_KEY_PATH",
    "AGENT_PAY_RECEIPT_RECORD_PAYMENT_AMOUNT"
  ] as const;
  const child: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    if (env[name] !== undefined) child[name] = env[name];
  }
  return child;
}

function sameFile(left: string, right: string): boolean {
  if (resolve(left) === resolve(right)) return true;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
