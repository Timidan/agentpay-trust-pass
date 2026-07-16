import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");
const originalEnv = { ...process.env };
const RECORDER_ACCOUNT_HASH = `account-hash-${"e".repeat(64)}`;

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("AgentPay Casper Testnet scripts", () => {
  it("deploys the registry wasm through casper-client put-deploy", async () => {
    const fixture = await createCasperClientFixture();
    const wasmPath = join(fixture.dir, "agent_pay_registry.wasm");
    const secretKeyPath = join(fixture.dir, "secret_key.pem");
    await writeFile(wasmPath, "wasm-bytes");
    await writeFile(secretKeyPath, "fixture signing key material");

    try {
      await execFileAsync("bash", ["contracts/agent-pay-registry/scripts/deploy-testnet.sh"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          CASPER_CLIENT_COMMAND: fixture.clientPath,
          CASPER_SECRET_KEY_PATH: secretKeyPath,
          AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH: RECORDER_ACCOUNT_HASH,
          AGENT_PAY_REGISTRY_WASM: wasmPath,
          AGENT_PAY_INSTALL_PAYMENT_AMOUNT: "150000000000",
          CASPER_NODE_ADDRESS: "https://node.testnet.casper.network/rpc",
          CASPER_CHAIN_NAME: "casper-test"
        }
      });

      const args = JSON.parse(await readFile(fixture.capturePath, "utf8")) as string[];
      expect(args).toEqual([
        "put-deploy",
        "--node-address",
        "https://node.testnet.casper.network/rpc",
        "--chain-name",
        "casper-test",
        "--secret-key",
        secretKeyPath,
        "--payment-amount",
        "150000000000",
        "--session-path",
        wasmPath,
        "--session-arg",
        `recorder:account_hash='${RECORDER_ACCOUNT_HASH}'`
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("builds the default registry wasm before deploying when no wasm override is provided", async () => {
    const fixture = await createCasperClientFixture();
    const secretKeyPath = join(fixture.dir, "secret_key.pem");
    await writeFile(secretKeyPath, "fixture signing key material");

    try {
      await execFileAsync("bash", ["contracts/agent-pay-registry/scripts/deploy-testnet.sh"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          CASPER_CLIENT_COMMAND: fixture.clientPath,
          CASPER_SECRET_KEY_PATH: secretKeyPath,
          AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH: RECORDER_ACCOUNT_HASH,
          AGENT_PAY_INSTALL_PAYMENT_AMOUNT: "150000000000",
          CASPER_NODE_ADDRESS: "https://node.testnet.casper.network/rpc",
          CASPER_CHAIN_NAME: "casper-test"
        }
      });

      const args = JSON.parse(await readFile(fixture.capturePath, "utf8")) as string[];
      const sessionPathIndex = args.indexOf("--session-path");
      expect(sessionPathIndex).toBeGreaterThan(-1);
      expect(args[sessionPathIndex + 1]).toMatch(/contracts\/agent-pay-registry\/target\/wasm32-unknown-unknown\/release\/agent_pay_registry_contract\.wasm$/);
      expect(args).toContain(`recorder:account_hash='${RECORDER_ACCOUNT_HASH}'`);
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it("records a decision by calling the deployed package entry point", async () => {
    const fixture = await createCasperClientFixture();
    const secretKeyPath = join(fixture.dir, "secret_key.pem");
    await writeFile(secretKeyPath, "fixture signing key material");

    try {
      await execFileAsync(
        "bash",
        [
          "contracts/agent-pay-registry/scripts/record-decision-testnet.sh",
          "agent-pay-live-100",
          "a".repeat(64),
          "b".repeat(64),
          "c".repeat(64),
          "approved"
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CASPER_CLIENT_COMMAND: fixture.clientPath,
            CASPER_SECRET_KEY_PATH: secretKeyPath,
            CASPER_NODE_ADDRESS: "https://node.testnet.casper.network/rpc",
            CASPER_CHAIN_NAME: "casper-test",
            AGENT_PAY_RECORD_PAYMENT_AMOUNT: "5000000000",
            AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"d".repeat(64)}`
          }
        }
      );

      const args = JSON.parse(await readFile(fixture.capturePath, "utf8")) as string[];
      expect(args).toEqual([
        "put-deploy",
        "--node-address",
        "https://node.testnet.casper.network/rpc",
        "--chain-name",
        "casper-test",
        "--secret-key",
        secretKeyPath,
        "--payment-amount",
        "5000000000",
        "--session-package-hash",
        `hash-${"d".repeat(64)}`,
        "--session-entry-point",
        "record_decision_with_root",
        "--session-arg",
        "dataset_id:string='agent-pay-live-100'",
        "--session-arg",
        `dataset_root:string='${"a".repeat(64)}'`,
        "--session-arg",
        `report_hash:string='${"b".repeat(64)}'`,
        "--session-arg",
        `payment_receipt_hash:string='${"c".repeat(64)}'`,
        "--session-arg",
        "decision:string='approved'"
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("records a purchase receipt with only the dedicated recorder key", async () => {
    const fixture = await createCasperClientFixture();
    const recorderKeyPath = join(fixture.dir, "recorder_secret_key.pem");
    await writeFile(recorderKeyPath, "fixture recorder key material");

    try {
      await execFileAsync(
        "bash",
        [
          "contracts/agent-pay-registry/scripts/record-receipt-testnet.sh",
          "a".repeat(64),
          "b".repeat(64),
          "c".repeat(64),
          "settlement_matched"
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CASPER_CLIENT_COMMAND: fixture.clientPath,
            CASPER_SECRET_KEY_PATH: "/buyer-key-must-not-be-used.pem",
            AGENT_PAY_REGISTRY_RECORDER_KEY_PATH: recorderKeyPath,
            CASPER_NODE_ADDRESS: "https://node.testnet.casper.network/rpc",
            CASPER_CHAIN_NAME: "casper-test",
            AGENT_PAY_RECEIPT_RECORD_PAYMENT_AMOUNT: "5000000000",
            AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"d".repeat(64)}`
          }
        }
      );

      const args = JSON.parse(await readFile(fixture.capturePath, "utf8")) as string[];
      expect(args).toEqual([
        "put-deploy",
        "--node-address",
        "https://node.testnet.casper.network/rpc",
        "--chain-name",
        "casper-test",
        "--secret-key",
        recorderKeyPath,
        "--payment-amount",
        "5000000000",
        "--session-package-hash",
        `hash-${"d".repeat(64)}`,
        "--session-entry-point",
        "record_purchase_receipt",
        "--session-arg",
        `receipt_hash:string='${"a".repeat(64)}'`,
        "--session-arg",
        `policy_hash:string='${"b".repeat(64)}'`,
        "--session-arg",
        `settlement_tx_hash:string='${"c".repeat(64)}'`,
        "--session-arg",
        "outcome:string='settlement_matched'"
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("does not fall back to a buyer key when the registry recorder key is absent", async () => {
    const fixture = await createCasperClientFixture();
    const buyerKeyPath = join(fixture.dir, "buyer_secret_key.pem");
    await writeFile(buyerKeyPath, "fixture buyer key material");

    try {
      await expect(execFileAsync(
        "bash",
        [
          "contracts/agent-pay-registry/scripts/record-receipt-testnet.sh",
          "a".repeat(64),
          "b".repeat(64),
          "c".repeat(64),
          "settlement_matched"
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CASPER_CLIENT_COMMAND: fixture.clientPath,
            CASPER_SECRET_KEY_PATH: buyerKeyPath,
            AGENT_PAY_REGISTRY_RECORDER_KEY_PATH: "",
            AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"d".repeat(64)}`
          }
        }
      )).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining("AGENT_PAY_REGISTRY_RECORDER_KEY_PATH")
      });
    } finally {
      await fixture.close();
    }
  });

  it("rejects non-canonical purchase receipt hashes before invoking Casper", async () => {
    const fixture = await createCasperClientFixture();
    const recorderKeyPath = join(fixture.dir, "recorder_secret_key.pem");
    await writeFile(recorderKeyPath, "fixture recorder key material");

    try {
      await expect(execFileAsync(
        "bash",
        [
          "contracts/agent-pay-registry/scripts/record-receipt-testnet.sh",
          "A".repeat(64),
          "b".repeat(64),
          "c".repeat(64),
          "settlement_matched"
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CASPER_CLIENT_COMMAND: fixture.clientPath,
            AGENT_PAY_REGISTRY_RECORDER_KEY_PATH: recorderKeyPath,
            AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"d".repeat(64)}`
          }
        }
      )).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining("64 lowercase hex chars")
      });
    } finally {
      await fixture.close();
    }
  });
});

async function createCasperClientFixture(): Promise<{
  dir: string;
  clientPath: string;
  capturePath: string;
  close: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-casper-client-"));
  const clientPath = join(dir, "casper-client");
  const capturePath = join(dir, "args.json");
  await writeFile(
    clientPath,
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ jsonrpc: "2.0", result: { deploy_hash: "${"f".repeat(64)}" } }));
`
  );
  await chmod(clientPath, 0o700);
  return {
    dir,
    clientPath,
    capturePath,
    close: () => rm(dir, { recursive: true, force: true })
  };
}
