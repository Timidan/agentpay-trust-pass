import { createServer, type IncomingMessage } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getRegistryStatus, recordAgentPayDecision } from "../src/casperClient";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("AgentPay registry recorder", () => {
  it("reports missing registry configuration without submitting a transaction", async () => {
    delete process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH;
    delete process.env.CASPER_RPC_URL;
    delete process.env.CASPER_SECRET_KEY_PATH;

    await expect(getRegistryStatus()).resolves.toMatchObject({
      status: "configuration_required",
      reason: "agent_pay_registry_package_hash_required",
      receiptAnchors: {
        status: "configuration_required",
        reason: "registry_recorder_key_required"
      },
      checks: expect.arrayContaining([
        {
          name: "registry_package",
          status: "missing",
          message: "AGENT_PAY_REGISTRY_PACKAGE_HASH is required"
        }
      ])
    });
  });

  it("reports registry readiness after confirming the Casper RPC boundary", async () => {
    const rpc = await withRpcServer(async (requestBody) => {
      expect(requestBody.method).toBe("info_get_status");
      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          name: "info_get_status_result",
          api_version: "2.0.0",
          chainspec_name: "casper-test",
          last_added_block_info: {
            height: 8135000,
            hash: "6".repeat(64)
          }
        }
      };
    });

    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"a".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = await createExecutableScript();
    process.env.CASPER_SECRET_KEY_PATH = await createSecretKeyFile();
    process.env.CASPER_RPC_URL = rpc.url;

    try {
      await expect(getRegistryStatus()).resolves.toMatchObject({
        status: "ready",
        reason: null,
        rpc: {
          url: rpc.url,
          chainspecName: "casper-test",
          latestBlockHeight: 8135000
        }
      });
    } finally {
      await rpc.close();
      await rm(process.env.AGENT_PAY_RECORD_SCRIPT, { force: true });
      await rm(process.env.CASPER_SECRET_KEY_PATH, { force: true });
    }
  });

  it("reports missing Casper secret key before treating the registry recorder as ready", async () => {
    const rpc = await withRpcServer(async () => {
      throw new Error("Registry status should not query Casper RPC while the secret key path is missing");
    });

    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"a".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = await createExecutableScript();
    delete process.env.CASPER_SECRET_KEY_PATH;
    process.env.CASPER_RPC_URL = rpc.url;

    try {
      await expect(getRegistryStatus()).resolves.toMatchObject({
        status: "configuration_required",
        reason: "casper_secret_key_required",
        checks: expect.arrayContaining([
          {
            name: "casper_secret_key",
            status: "missing",
            message: "CASPER_SECRET_KEY_PATH is required to submit registry decisions"
          }
        ])
      });
    } finally {
      await rpc.close();
      await rm(process.env.AGENT_PAY_RECORD_SCRIPT, { force: true });
    }
  });

  it("reports Mainnet write configuration as unavailable without querying the RPC", async () => {
    const script = await createExecutableScript();
    const secretKeyPath = await createSecretKeyFile();
    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"a".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = script;
    process.env.CASPER_SECRET_KEY_PATH = secretKeyPath;
    process.env.CASPER_RPC_URL = "http://127.0.0.1:1";
    process.env.CASPER_CHAIN_NAME = "casper";
    process.env.CASPER_NETWORK = "casper-mainnet";

    try {
      await expect(getRegistryStatus()).resolves.toMatchObject({
        status: "configuration_required",
        reason: "casper_write_network_not_testnet",
        checks: expect.arrayContaining([
          {
            name: "write_network",
            status: "fail",
            message: "AgentPay writes are restricted to Casper Testnet"
          }
        ])
      });
    } finally {
      await rm(script, { force: true });
      await rm(secretKeyPath, { force: true });
    }
  });

  it("rejects malformed registry package hashes before treating the registry path as ready", async () => {
    const rpc = await withRpcServer(async () => {
      throw new Error("Registry status should not query Casper RPC when the package hash is malformed");
    });

    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = "not-a-casper-package-hash";
    process.env.AGENT_PAY_RECORD_SCRIPT = await createExecutableScript();
    process.env.CASPER_RPC_URL = rpc.url;

    try {
      await expect(getRegistryStatus()).resolves.toMatchObject({
        status: "configuration_required",
        reason: "agent_pay_registry_package_hash_invalid",
        checks: expect.arrayContaining([
          {
            name: "registry_package",
            status: "fail",
            message: "AGENT_PAY_REGISTRY_PACKAGE_HASH must be hash-<64 hex chars> or 64 hex chars"
          }
        ])
      });
    } finally {
      await rpc.close();
      await rm(process.env.AGENT_PAY_RECORD_SCRIPT, { force: true });
    }
  });

  it("requires explicit operator opt-in before using a custom record script", async () => {
    const script = await createExecutableScript();
    const secretKeyPath = await createSecretKeyFile();
    delete process.env.AGENT_PAY_ALLOW_CUSTOM_RECORD_SCRIPTS;
    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"a".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = script;
    process.env.CASPER_SECRET_KEY_PATH = secretKeyPath;
    process.env.CASPER_RPC_URL = "https://node.testnet.casper.network/rpc";

    try {
      await expect(getRegistryStatus()).resolves.toMatchObject({
        status: "configuration_required",
        checks: expect.arrayContaining([
          {
            name: "record_script",
            status: "missing",
            message: "custom record scripts require AGENT_PAY_ALLOW_CUSTOM_RECORD_SCRIPTS=1"
          }
        ])
      });
      await expect(recordAgentPayDecision({
        datasetId: "agent-pay-live-runtime",
        datasetRoot: "a".repeat(64),
        reportHash: "b".repeat(64),
        paymentReceiptHash: "c".repeat(64),
        decision: "approved"
      })).rejects.toThrow("AGENT_PAY_ALLOW_CUSTOM_RECORD_SCRIPTS=1");
    } finally {
      await rm(script, { force: true });
      await rm(secretKeyPath, { force: true });
    }
  });

  it("refuses Mainnet configuration before invoking the registry recorder", async () => {
    const submitter = await createSubmitter(`TRANSACTION_HASH=${"7".repeat(64)}`);
    const secretKeyPath = await createSecretKeyFile();
    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"d".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = submitter.path;
    process.env.CASPER_RPC_URL = "http://127.0.0.1:1";
    process.env.CASPER_CHAIN_NAME = "casper";
    process.env.CASPER_NETWORK = "casper-mainnet";
    process.env.CASPER_SECRET_KEY_PATH = secretKeyPath;
    process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
    process.env.CASPER_CONFIRMATION_DELAY_MS = "0";

    try {
      await expect(recordAgentPayDecision({
        datasetId: "agent-pay-mainnet-refusal",
        datasetRoot: "a".repeat(64),
        reportHash: "b".repeat(64),
        paymentReceiptHash: "c".repeat(64),
        decision: "approved"
      })).rejects.toThrow("AgentPay writes are restricted to Casper Testnet");
      await expect(readFile(submitter.capturePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await submitter.close();
      await rm(secretKeyPath, { force: true });
    }
  });

  it("confirms a submitted transaction hash through Casper JSON-RPC", async () => {
    const transactionHash = "7".repeat(64);
    const blockHash = "8".repeat(64);
    const submitter = await createSubmitter(`TRANSACTION_HASH=${transactionHash}`);
    const secretKeyPath = await createSecretKeyFile();
    const rpc = await withRpcServer(async (requestBody) => {
      expect(requestBody.method).toBe("info_get_transaction");
      expect(requestBody.params).toMatchObject({
        transaction_hash: { Version1: transactionHash }
      });

      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          api_version: "2.0.0",
          transaction: version1DecisionTransaction({
            transactionHash,
            packageHash: "d".repeat(64),
            decision: "approved"
          }),
          execution_info: {
            block_hash: blockHash,
            block_height: 8135708,
            execution_result: { Version2: { error_message: null } }
          }
        }
      };
    });

    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"d".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = submitter.path;
    process.env.CASPER_RPC_URL = rpc.url;
    process.env.CASPER_SECRET_KEY_PATH = secretKeyPath;
    process.env.AGENT_PAY_API_TOKEN = "must-not-cross-the-registry-subprocess-boundary";
    process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
    process.env.CASPER_CONFIRMATION_DELAY_MS = "0";

    try {
      const receipt = await recordAgentPayDecision({
        datasetId: "agent-pay-live-runtime",
        datasetRoot: "a".repeat(64),
        reportHash: "b".repeat(64),
        paymentReceiptHash: "c".repeat(64),
        decision: "approved"
      });

      expect(receipt).toMatchObject({
        mode: "submitted",
        txHash: transactionHash,
        hashKind: "transaction",
        confirmation: {
          rpcUrl: rpc.url,
          method: "info_get_transaction",
          apiVersion: "2.0.0",
          executionState: "executed",
          blockHash,
          attempts: 1
        }
      });
      expect(await readFile(submitter.capturePath, "utf8")).toBe("unset");
    } finally {
      await rpc.close();
      await submitter.close();
      await rm(secretKeyPath, { force: true });
    }
  });

  it("falls back to legacy deploy lookup when the submitter returns a deploy hash", async () => {
    const deployHash = "9".repeat(64);
    const blockHash = "8".repeat(64);
    const submitter = await createSubmitter(`DEPLOY_HASH=${deployHash}`);
    const secretKeyPath = await createSecretKeyFile();
    const rpc = await withRpcServer(async (requestBody) => {
      expect(requestBody.method).toBe("info_get_transaction");
      expect(requestBody.params).toMatchObject({
        transaction_hash: { Deploy: deployHash }
      });

      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          api_version: "2.0.0",
          transaction: {
            Deploy: decisionDeploy({
              deployHash,
              packageHash: "e".repeat(64),
              decision: "needs_review"
            })
          },
          execution_info: {
            block_hash: blockHash,
            block_height: 8135708,
            execution_result: { Version2: { error_message: null } }
          }
        }
      };
    });

    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"e".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = submitter.path;
    process.env.CASPER_RPC_URL = rpc.url;
    process.env.CASPER_SECRET_KEY_PATH = secretKeyPath;
    process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
    process.env.CASPER_CONFIRMATION_DELAY_MS = "0";

    try {
      const receipt = await recordAgentPayDecision({
        datasetId: "agent-pay-live-runtime",
        datasetRoot: "a".repeat(64),
        reportHash: "b".repeat(64),
        paymentReceiptHash: "c".repeat(64),
        decision: "needs_review"
      });

      expect(receipt).toMatchObject({
        txHash: deployHash,
        hashKind: "deploy",
        confirmation: {
          method: "info_get_transaction",
          executionState: "executed",
          blockHash,
          attempts: 1
        }
      });
    } finally {
      await rpc.close();
      await submitter.close();
      await rm(secretKeyPath, { force: true });
    }
  });

  it("rejects an executed hash whose registry arguments do not match the decision", async () => {
    const deployHash = "4".repeat(64);
    const submitter = await createSubmitter(`DEPLOY_HASH=${deployHash}`);
    const secretKeyPath = await createSecretKeyFile();
    const rpc = await withRpcServer(async (requestBody) => ({
      jsonrpc: "2.0",
      id: requestBody.id,
      result: {
        api_version: "2.0.0",
        deploy: decisionDeploy({
          deployHash,
          packageHash: "d".repeat(64),
          decision: "approved",
          reportHash: "f".repeat(64)
        }),
        execution_info: {
          block_hash: "8".repeat(64),
          block_height: 8135708,
          execution_result: { Version2: { error_message: null } }
        }
      }
    }));

    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"d".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = submitter.path;
    process.env.CASPER_RPC_URL = rpc.url;
    process.env.CASPER_SECRET_KEY_PATH = secretKeyPath;
    process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
    process.env.CASPER_CONFIRMATION_DELAY_MS = "0";

    try {
      await expect(recordAgentPayDecision({
        datasetId: "agent-pay-live-runtime",
        datasetRoot: "a".repeat(64),
        reportHash: "b".repeat(64),
        paymentReceiptHash: "c".repeat(64),
        decision: "approved"
      })).rejects.toThrow(/arguments do not match/i);
    } finally {
      await rpc.close();
      await submitter.close();
      await rm(secretKeyPath, { force: true });
    }
  });

  it("does not return an AgentPay registry receipt while the submission is still pending", async () => {
    const transactionHash = "1".repeat(64);
    const submitter = await createSubmitter(`TRANSACTION_HASH=${transactionHash}`);
    const secretKeyPath = await createSecretKeyFile();
    const rpc = await withRpcServer(async (requestBody) => {
      if (requestBody.method === "info_get_deploy") {
        return {
          jsonrpc: "2.0",
          id: requestBody.id,
          error: {
            code: -32001,
            message: "deploy not found"
          }
        };
      }

      expect(requestBody.method).toBe("info_get_transaction");

      // Casper 2.0: a found-but-not-yet-executed transaction has null execution_info.
      return {
        jsonrpc: "2.0",
        id: requestBody.id,
        result: {
          api_version: "2.0.0",
          transaction: { hash: { Version1: transactionHash } },
          execution_info: null
        }
      };
    });

    process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH = `hash-${"a".repeat(64)}`;
    process.env.AGENT_PAY_RECORD_SCRIPT = submitter.path;
    process.env.CASPER_RPC_URL = rpc.url;
    process.env.CASPER_SECRET_KEY_PATH = secretKeyPath;
    process.env.CASPER_CONFIRMATION_ATTEMPTS = "1";
    process.env.CASPER_CONFIRMATION_DELAY_MS = "0";

    try {
      await expect(
        recordAgentPayDecision({
          datasetId: "agent-pay-live-runtime",
          datasetRoot: "a".repeat(64),
          reportHash: "b".repeat(64),
          paymentReceiptHash: "c".repeat(64),
          decision: "approved"
        })
      ).rejects.toThrow("not executed");
    } finally {
      await rpc.close();
      await submitter.close();
      await rm(secretKeyPath, { force: true });
    }
  });
});

function version1DecisionTransaction(input: {
  transactionHash: string;
  packageHash: string;
  decision: "approved" | "needs_review" | "rejected";
}) {
  return {
    Version1: {
      hash: input.transactionHash,
      payload: {
        chain_name: "casper-test",
        fields: {
          args: { Named: decisionArguments(input.decision) },
          entry_point: { Custom: "record_decision_with_root" },
          target: {
            Stored: {
              id: { ByPackageHash: { addr: input.packageHash, version: null } },
              runtime: "VmCasperV1"
            }
          }
        }
      }
    }
  };
}

function decisionDeploy(input: {
  deployHash: string;
  packageHash: string;
  decision: "approved" | "needs_review" | "rejected";
  reportHash?: string;
}) {
  return {
    hash: input.deployHash,
    header: { chain_name: "casper-test" },
    session: {
      StoredVersionedContractByHash: {
        hash: input.packageHash,
        entry_point: "record_decision_with_root",
        args: decisionArguments(input.decision, input.reportHash)
      }
    }
  };
}

function decisionArguments(
  decision: "approved" | "needs_review" | "rejected",
  reportHash = "b".repeat(64)
) {
  return [
    ["dataset_id", { cl_type: "String", parsed: "agent-pay-live-runtime" }],
    ["dataset_root", { cl_type: "String", parsed: "a".repeat(64) }],
    ["report_hash", { cl_type: "String", parsed: reportHash }],
    ["payment_receipt_hash", { cl_type: "String", parsed: "c".repeat(64) }],
    ["decision", { cl_type: "String", parsed: decision }]
  ];
}

async function createSubmitter(output: string): Promise<{
  path: string;
  capturePath: string;
  close: () => Promise<void>;
}> {
  process.env.AGENT_PAY_ALLOW_CUSTOM_RECORD_SCRIPTS = "1";
  const dir = await mkdtemp(join(tmpdir(), "agent-pay-submitter-"));
  const scriptPath = join(dir, "submit.sh");
  const capturePath = join(dir, "inherited-token.txt");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s' "\${AGENT_PAY_API_TOKEN-unset}" > ${JSON.stringify(capturePath)}\necho "${output}"\n`
  );
  await chmod(scriptPath, 0o700);

  return {
    path: scriptPath,
    capturePath,
    close: () => rm(dir, { recursive: true, force: true })
  };
}

async function createExecutableScript(): Promise<string> {
  process.env.AGENT_PAY_ALLOW_CUSTOM_RECORD_SCRIPTS = "1";
  const dir = await mkdtemp(join(tmpdir(), "agent-pay-registry-status-"));
  const scriptPath = join(dir, "record.sh");
  await writeFile(scriptPath, "#!/usr/bin/env bash\nset -euo pipefail\n");
  await chmod(scriptPath, 0o700);
  return scriptPath;
}

async function createSecretKeyFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agent-pay-secret-key-"));
  const secretKeyPath = join(dir, "secret_key.pem");
  await writeFile(secretKeyPath, "fixture signing key material");
  return secretKeyPath;
}

async function withRpcServer(
  handler: (requestBody: Record<string, any>) => Promise<Record<string, unknown>>
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    const requestBody = JSON.parse(await readRequestBody(request));
    const responseBody = await handler(requestBody);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("AgentPay RPC test server did not bind to a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
