import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");
const originalEnv = { ...process.env };

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
          AGENT_PAY_REGISTRY_WASM: wasmPath,
          AGENT_PAY_INSTALL_PAYMENT_AMOUNT: "25000000000",
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
        "25000000000",
        "--session-path",
        wasmPath
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
          AGENT_PAY_INSTALL_PAYMENT_AMOUNT: "25000000000",
          CASPER_NODE_ADDRESS: "https://node.testnet.casper.network/rpc",
          CASPER_CHAIN_NAME: "casper-test"
        }
      });

      const args = JSON.parse(await readFile(fixture.capturePath, "utf8")) as string[];
      expect(args).toContain("--session-path");
      expect(args.at(-1)).toMatch(/contracts\/agent-pay-registry\/target\/wasm32-unknown-unknown\/release\/agent_pay_registry_contract\.wasm$/);
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
            AGENT_PAY_RECORD_PAYMENT_AMOUNT: "100000000",
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
        "100000000",
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
