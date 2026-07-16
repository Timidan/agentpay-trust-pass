import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmCasperHashExecution,
  evaluateSubmissionReadiness,
  formatSubmissionReadinessMarkdown,
  loadSubmissionEnv,
  parseEnvFile,
  type SubmissionReadinessInput
} from "../submission-readiness";

const TEST_GITHUB_URL = "https://github.com/agentpay/protocol";
const TEST_VIDEO_URL = "https://media.agentpay.dev/walkthrough";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("AgentPay submission readiness evaluator", () => {
  it("keeps the submission not ready when external proof is missing", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      files: {
        readmeExists: true,
        liveCapabilitiesExists: true,
        registryWasmExists: true
      },
      commands: {
        casperClientAvailable: false
      },
      env: {
        CASPER_RPC_URL: "https://node.testnet.casper.network/rpc"
      }
    }));

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual({
      id: "registry_wasm",
      label: "AgentPayRegistry Wasm artifact",
      status: "pass",
      message: "agent_pay_registry_contract.wasm is present"
    });
    expect(report.checks).toContainEqual({
      id: "registry_package_hash",
      label: "Deployed registry package hash",
      status: "missing",
      message: "AGENT_PAY_REGISTRY_PACKAGE_HASH is required"
    });
    expect(report.checks).toContainEqual({
      id: "casper_client",
      label: "Casper client",
      status: "missing",
      message: "casper-client is required for Testnet deploys"
    });
    expect(report.blockers).toContain("Deploy AgentPayRegistry v2 and configure its package, contract, and dedicated recorder values.");
  });

  it("requires executed Casper confirmations rather than formatted hashes alone", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      env: {
        AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"a".repeat(64)}`,
        AGENT_PAY_REGISTRY_INSTALL_HASH: "b".repeat(64),
        AGENT_PAY_DECISION_TX_HASH: "c".repeat(64),
        AGENT_PAY_SETTLEMENT_TX_HASH: "d".repeat(64)
      },
      confirmations: {
        registryInstall: "unverified",
        receiptAnchor: "missing",
        decisionRecord: "pending",
        x402Settlement: "executed"
      }
    }));

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual({
      id: "registry_install_confirmation",
      label: "Registry install confirmation",
      status: "fail",
      message: "AGENT_PAY_REGISTRY_INSTALL_HASH was not confirmed as executed on Casper"
    });
    expect(report.checks).toContainEqual({
      id: "decision_confirmation",
      label: "Decision record confirmation",
      status: "fail",
      message: "AGENT_PAY_DECISION_TX_HASH is still pending on Casper"
    });
  });

  it("reports Casper 2.0 execution errors as failed", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          transaction: { hash: "a".repeat(64) },
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

    await expect(confirmCasperHashExecution(
      "https://node.testnet.casper.network/rpc",
      "a".repeat(64)
    )).resolves.toBe("failed");
  });

  it("reports legacy execution failures as failed", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          deploy: { hash: "a".repeat(64) },
          execution_info: [
            {
              result: {
                Failure: {
                  error_message: "Contract reverted"
                }
              }
            }
          ]
        }
      })
    })) as unknown as typeof fetch;

    await expect(confirmCasperHashExecution(
      "https://node.testnet.casper.network/rpc",
      "a".repeat(64)
    )).resolves.toBe("failed");
  });

  it("surfaces a failed confirmation distinctly in readiness output", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      env: {
        AGENT_PAY_REGISTRY_INSTALL_HASH: "b".repeat(64)
      },
      confirmations: {
        registryInstall: "failed"
      }
    }));

    expect(report.checks).toContainEqual({
      id: "registry_install_confirmation",
      label: "Registry install confirmation",
      status: "fail",
      message: "AGENT_PAY_REGISTRY_INSTALL_HASH failed during Casper execution"
    });
  });

  it("requires public GitHub and demo links to be reachable", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      env: {
        SUBMISSION_GITHUB_URL: TEST_GITHUB_URL,
        SUBMISSION_DEMO_VIDEO_URL: TEST_VIDEO_URL
      },
      links: {
        githubRepository: "unreachable",
        demoVideo: "unchecked"
      }
    }));

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual({
      id: "github_repository",
      label: "Open-source GitHub repository",
      status: "fail",
      message: "SUBMISSION_GITHUB_URL was not reachable as a public URL"
    });
    expect(report.checks).toContainEqual({
      id: "demo_video",
      label: "Public demo video",
      status: "fail",
      message: "SUBMISSION_DEMO_VIDEO_URL was not verified as reachable"
    });
  });

  it("marks the package ready only when every hackathon submission gate has evidence", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      files: {
        readmeExists: true,
        liveCapabilitiesExists: true,
        registryWasmExists: true
      },
      commands: {
        casperClientAvailable: true
      },
      env: {
        CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
        CASPER_SECRET_KEY_PATH: "/home/user/.casper/secret_key.pem",
        CASPER_PUBLIC_KEY_PATH: "/home/user/.casper/public_key_hex",
        AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"a".repeat(64)}`,
        AGENT_PAY_REGISTRY_CONTRACT_HASH: `hash-${"1".repeat(64)}`,
        AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH: `account-hash-${"2".repeat(64)}`,
        AGENT_PAY_REGISTRY_RECORDER_KEY_PATH: "/home/user/.casper/registry_secret_key.pem",
        AGENT_PAY_REGISTRY_INSTALL_HASH: "b".repeat(64),
        AGENT_PAY_RECEIPT_ANCHOR_HASH: "3".repeat(64),
        AGENT_PAY_DECISION_TX_HASH: "c".repeat(64),
        AGENT_PAY_SETTLEMENT_TX_HASH: "d".repeat(64),
        X402_ASSET_PACKAGE_HASH: "e".repeat(64),
        PAYEE_ADDRESS: `00${"f".repeat(64)}`,
        CSPR_CLOUD_ACCESS_TOKEN: "configured",
        SUBMISSION_GITHUB_URL: TEST_GITHUB_URL,
        SUBMISSION_DEMO_VIDEO_URL: TEST_VIDEO_URL
      },
      secrets: {
        casperSecretKeyReadable: true,
        registryRecorderKeyReadable: true
      },
      funding: {
        casperAccount: {
          status: "sufficient",
          balanceMotes: "30000000000",
          minimumMotes: "25100000000",
          message: null
        }
      },
      confirmations: {
        registryInstall: "executed",
        receiptAnchor: "executed",
        decisionRecord: "executed",
        x402Settlement: "executed"
      },
      links: {
        githubRepository: "reachable",
        demoVideo: "reachable"
      }
    }));

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("formats a human-readable evidence report from the same readiness data", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      files: {
        readmeExists: true,
        liveCapabilitiesExists: true,
        registryWasmExists: true
      },
      env: {
        CASPER_RPC_URL: "https://node.testnet.casper.network/rpc"
      }
    }));

    const markdown = formatSubmissionReadinessMarkdown(report);

    expect(markdown).toContain("# AgentPay Submission Readiness");
    expect(markdown).toContain("Status: NOT READY");
    expect(markdown).toContain("| README documentation | pass | README.md is present |");
    expect(markdown).toContain("- Deploy AgentPayRegistry v2 and configure its package, contract, and dedicated recorder values.");
  });

  it("requires the live capability ledger to stay in the submission gate", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      files: {
        readmeExists: true,
        liveCapabilitiesExists: false,
        registryWasmExists: true
      }
    }));

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual({
      id: "live_capabilities",
      label: "Live capability ledger",
      status: "missing",
      message: "docs/live-capabilities.md is required"
    });
  });

  it("fails readiness when runtime-facing source files contain fake evidence markers", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      sourceIntegrity: {
        prohibitedSignals: ["apps/web/src/App.tsx:10 fake receipt marker"]
      }
    }));

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual({
      id: "source_integrity",
      label: "No fake runtime evidence markers",
      status: "fail",
      message: "Remove prohibited fake evidence markers: apps/web/src/App.tsx:10 fake receipt marker"
    });
    expect(report.blockers).toContain("Remove fake/manual runtime evidence markers from submission-facing files.");
  });

  it("requires a funded Casper account for Testnet deploys", () => {
    const report = evaluateSubmissionReadiness(baseInput({
      env: {
        CASPER_PUBLIC_KEY_PATH: "/home/user/.casper/public_key_hex"
      },
      funding: {
        casperAccount: {
          status: "insufficient",
          balanceMotes: "1000",
          minimumMotes: "25100000000",
          message: null
        }
      }
    }));

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual({
      id: "casper_account_funding",
      label: "Casper account funding",
      status: "fail",
      message: "account balance 1000 motes is below required 25100000000 motes"
    });
    expect(report.blockers).toContain("Fund the Casper Testnet account and set CASPER_PUBLIC_KEY_PATH.");
  });

  it("parses local env files without accepting comments as values", () => {
    expect(parseEnvFile(`
      # local only
      CASPER_RPC_URL=https://node.testnet.casper.network/rpc
      export AGENT_PAY_REGISTRY_PACKAGE_HASH="hash-${"a".repeat(64)}"
      X402_TOKEN_SYMBOL='CSPR'
      PAYEE_ADDRESS=00${"b".repeat(64)} # account hash
    `)).toEqual({
      CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
      AGENT_PAY_REGISTRY_PACKAGE_HASH: `hash-${"a".repeat(64)}`,
      X402_TOKEN_SYMBOL: "CSPR",
      PAYEE_ADDRESS: `00${"b".repeat(64)}`
    });
  });

  it("loads env files while keeping explicitly exported env values authoritative", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpay-readiness-env-"));
    const envFile = join(dir, ".env.submission.local");

    try {
      await writeFile(envFile, [
        "CASPER_RPC_URL=https://file.example/rpc",
        `AGENT_PAY_REGISTRY_PACKAGE_HASH=hash-${"a".repeat(64)}`,
        `SUBMISSION_GITHUB_URL=${TEST_GITHUB_URL}`
      ].join("\n"));

      const env = await loadSubmissionEnv({
        CASPER_RPC_URL: "https://shell.example/rpc"
      }, [envFile]);

      expect(env.CASPER_RPC_URL).toBe("https://shell.example/rpc");
      expect(env.AGENT_PAY_REGISTRY_PACKAGE_HASH).toBe(`hash-${"a".repeat(64)}`);
      expect(env.SUBMISSION_GITHUB_URL).toBe(TEST_GITHUB_URL);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function baseInput(overrides: Partial<SubmissionReadinessInput> = {}): SubmissionReadinessInput {
  return {
    files: {
      readmeExists: false,
      liveCapabilitiesExists: false,
      registryWasmExists: false,
      ...overrides.files
    },
    commands: {
      casperClientAvailable: false,
      ...overrides.commands
    },
    env: {
      ...overrides.env
    },
    secrets: {
      casperSecretKeyReadable: false,
      ...overrides.secrets
    },
    funding: {
      casperAccount: {
        status: "missing",
        balanceMotes: null,
        minimumMotes: "25100000000",
        message: null
      },
      ...overrides.funding
    },
    confirmations: {
      registryInstall: "missing",
      receiptAnchor: "missing",
      decisionRecord: "missing",
      x402Settlement: "missing",
      ...overrides.confirmations
    },
    links: {
      githubRepository: "missing",
      demoVideo: "missing",
      ...overrides.links
    },
    sourceIntegrity: {
      prohibitedSignals: [],
      ...overrides.sourceIntegrity
    }
  };
}
