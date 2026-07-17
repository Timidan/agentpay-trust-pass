import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnvFile } from "../submission-readiness";
import {
  deployAndCaptureAgentPayRegistry,
  extractRegistryContractHash,
  extractRegistryPackageHash,
  extractSubmittedHash,
  parseRegistryDeployCliArgs
} from "../submission-deploy-registry";

const DEPLOY_HASH = "a".repeat(64);
const PACKAGE_HASH = "b".repeat(64);
const CONTRACT_HASH = "c".repeat(64);
const RECORDER_ACCOUNT_HASH = `account-hash-${"e".repeat(64)}`;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("AgentPay registry deploy evidence capture", () => {
  it("parses deploy and transaction hashes from Casper client output", () => {
    expect(extractSubmittedHash(JSON.stringify({
      jsonrpc: "2.0",
      result: {
        deploy_hash: DEPLOY_HASH
      }
    }))).toBe(DEPLOY_HASH);

    expect(extractSubmittedHash(JSON.stringify({
      result: {
        transaction_hash: {
          Version1: DEPLOY_HASH.toUpperCase()
        }
      }
    }))).toBe(DEPLOY_HASH);

    expect(extractSubmittedHash(`Deploy hash: ${DEPLOY_HASH}`)).toBe(DEPLOY_HASH);
  });

  it("extracts only the AgentPayRegistry v2 hashes from Casper account named keys", () => {
    expect(extractRegistryPackageHash({
      result: {
        account: {
          named_keys: [
            {
              name: "agentpay_registry",
              key: `hash-${"c".repeat(64)}`
            },
            {
              name: "agentpay_registry_package",
              key: `hash-${"d".repeat(64)}`
            },
            {
              name: "agentpay_registry_v2_package",
              key: `hash-${PACKAGE_HASH.toUpperCase()}`
            }
          ]
        }
      }
    })).toBe(`hash-${PACKAGE_HASH}`);

    expect(extractRegistryContractHash({
      result: {
        account: {
          named_keys: [
            { name: "agentpay_registry", key: `hash-${"d".repeat(64)}` },
            { name: "agentpay_registry_v2", key: `hash-${CONTRACT_HASH.toUpperCase()}` }
          ]
        }
      }
    })).toBe(`hash-${CONTRACT_HASH}`);

    expect(extractRegistryPackageHash({
      result: {
        account: {
          named_keys: {
            agentpay_registry_v2_package: PACKAGE_HASH
          }
        }
      }
    })).toBe(`hash-${PACKAGE_HASH}`);

    expect(extractRegistryPackageHash({
      result: {
        account: {
          named_keys: [
            { name: "agentpay_registry_package", key: `hash-${PACKAGE_HASH}` },
            { name: "agentpay_registry", key: `hash-${CONTRACT_HASH}` }
          ]
        }
      }
    })).toBeNull();
  });

  it("parses CLI flags while accepting argument separators", () => {
    expect(parseRegistryDeployCliArgs([
      "--",
      "--env-file",
      ".env.submission.local",
      "--deploy-script",
      "contracts/agent-pay-registry/scripts/deploy-testnet.sh",
      "--max-attempts",
      "2",
      "--poll-ms",
      "5"
    ])).toEqual({
      envFile: ".env.submission.local",
      deployScript: "contracts/agent-pay-registry/scripts/deploy-testnet.sh",
      maxAttempts: 2,
      pollIntervalMs: 5
    });
  });

  it("deploys, confirms execution, captures the package named key, and writes evidence", async () => {
    const fixture = await createRegistryDeployFixture();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          execution_info: [{}]
        }
      })
    })) as unknown as typeof fetch;

    try {
      const result = await deployAndCaptureAgentPayRegistry({
        envFile: fixture.envFile,
        deployScript: fixture.deployScriptPath,
        maxAttempts: 1,
        pollIntervalMs: 1
      }, {
        CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
        CASPER_CLIENT_COMMAND: fixture.clientPath,
        CASPER_SECRET_KEY_PATH: fixture.secretKeyPath,
        CASPER_ACCOUNT_IDENTIFIER: `account-hash-${"d".repeat(64)}`,
        AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH: RECORDER_ACCOUNT_HASH
      });

      const env = parseEnvFile(await readFile(fixture.envFile, "utf8"));

      expect(result.registryInstallHash).toBe(DEPLOY_HASH);
      expect(result.registryPackageHash).toBe(`hash-${PACKAGE_HASH}`);
      expect(result.registryContractHash).toBe(`hash-${CONTRACT_HASH}`);
      expect(result.updatedKeys).toEqual([
        "AGENT_PAY_REGISTRY_CONTRACT_HASH",
        "AGENT_PAY_REGISTRY_INSTALL_HASH",
        "AGENT_PAY_REGISTRY_PACKAGE_HASH"
      ]);
      expect(env.AGENT_PAY_REGISTRY_CONTRACT_HASH).toBe(`hash-${CONTRACT_HASH}`);
      expect(env.AGENT_PAY_REGISTRY_INSTALL_HASH).toBe(DEPLOY_HASH);
      expect(env.AGENT_PAY_REGISTRY_PACKAGE_HASH).toBe(`hash-${PACKAGE_HASH}`);
      expect((await readFile(fixture.deployCapturePath, "utf8")).trim()).toBe(RECORDER_ACCOUNT_HASH);
      expect(globalThis.fetch).toHaveBeenCalledWith("https://node.testnet.casper.network/rpc", expect.objectContaining({
        method: "POST"
      }));
    } finally {
      await fixture.close();
    }
  });

  it("rejects reusing the deploying owner as the receipt recorder", async () => {
    const fixture = await createRegistryDeployFixture();
    const owner = `account-hash-${"d".repeat(64)}`;
    try {
      await expect(deployAndCaptureAgentPayRegistry({
        envFile: fixture.envFile,
        deployScript: fixture.deployScriptPath,
        maxAttempts: 1,
        pollIntervalMs: 1
      }, {
        CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
        CASPER_CLIENT_COMMAND: fixture.clientPath,
        CASPER_SECRET_KEY_PATH: fixture.secretKeyPath,
        CASPER_ACCOUNT_IDENTIFIER: owner,
        AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH: owner
      })).rejects.toThrow("must be separate from the deploying owner");
    } finally {
      await fixture.close();
    }
  });

  it("stops on a failed Casper execution without writing deployment evidence", async () => {
    const fixture = await createRegistryDeployFixture();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          execution_info: {
            execution_result: {
              Version2: {
                error_message: "ApiError::InvalidArgument [3]"
              }
            }
          }
        }
      })
    })) as unknown as typeof fetch;

    try {
      await expect(deployAndCaptureAgentPayRegistry({
        envFile: fixture.envFile,
        deployScript: fixture.deployScriptPath,
        maxAttempts: 3,
        pollIntervalMs: 1
      }, {
        CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
        CASPER_CLIENT_COMMAND: fixture.clientPath,
        CASPER_SECRET_KEY_PATH: fixture.secretKeyPath,
        CASPER_ACCOUNT_IDENTIFIER: `account-hash-${"d".repeat(64)}`,
        AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH: RECORDER_ACCOUNT_HASH
      })).rejects.toThrow("Registry install failed on Casper");

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(parseEnvFile(await readFile(fixture.envFile, "utf8"))).toEqual({
        CSPR_CLOUD_ACCESS_TOKEN: "configured"
      });
    } finally {
      await fixture.close();
    }
  });
});

async function createRegistryDeployFixture(): Promise<{
  dir: string;
  clientPath: string;
  deployScriptPath: string;
  envFile: string;
  secretKeyPath: string;
  publicKeyPath: string;
  deployCapturePath: string;
  close: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-registry-deploy-"));
  const clientPath = join(dir, "casper-client");
  const deployScriptPath = join(dir, "deploy-testnet.sh");
  const envFile = join(dir, ".env.submission.local");
  const secretKeyPath = join(dir, "secret_key.pem");
  const publicKeyPath = join(dir, "public_key_hex");
  const deployCapturePath = join(dir, "recorder-account.txt");

  await writeFile(secretKeyPath, "fixture signing key material");
  await writeFile(publicKeyPath, "fixture public key material");
  await writeFile(envFile, "CSPR_CLOUD_ACCESS_TOKEN=configured\n");
  await writeFile(
    clientPath,
    `#!/usr/bin/env sh
case "$1" in
  account-address)
    printf '%s' 'account-hash-${"d".repeat(64)}'
    ;;
  query-balance)
    printf '%s' '{"result":{"balance":"155000000000"}}'
    ;;
  get-account)
    printf '%s' '{"result":{"account":{"named_keys":[{"name":"agentpay_registry_v2_package","key":"hash-${PACKAGE_HASH}"},{"name":"agentpay_registry_v2","key":"hash-${CONTRACT_HASH}"}]}}}'
    ;;
  *)
    printf '%s\n' 'unsupported casper-client command' >&2
    exit 2
    ;;
esac
`
  );
  await writeFile(
    deployScriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH" > ${JSON.stringify(deployCapturePath)}
echo '{"jsonrpc":"2.0","result":{"deploy_hash":"${DEPLOY_HASH}"}}'
`
  );
  await chmod(clientPath, 0o700);
  await chmod(deployScriptPath, 0o700);

  return {
    dir,
    clientPath,
    deployScriptPath,
    envFile,
    secretKeyPath,
    publicKeyPath,
    deployCapturePath,
    close: () => rm(dir, { recursive: true, force: true })
  };
}
