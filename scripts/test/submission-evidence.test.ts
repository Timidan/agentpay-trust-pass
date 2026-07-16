import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvFile } from "../submission-readiness";
import { parseEvidenceCliArgs, writeSubmissionEvidence } from "../submission-evidence";

describe("AgentPay submission evidence writer", () => {
  it("accepts an argument separator before evidence flags", () => {
    expect(parseEvidenceCliArgs([
      "--",
      "--env-file",
      ".env.submission.local",
      "--registry-install-hash",
      "a".repeat(64)
    ])).toEqual({
      envFile: ".env.submission.local",
      updates: {
        AGENT_PAY_REGISTRY_INSTALL_HASH: "a".repeat(64)
      }
    });
  });

  it("writes validated evidence into an ignored local env file while preserving existing values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpay-submission-evidence-"));
    const envFile = join(dir, ".env.submission.local");
    const secretKeyPath = join(dir, "secret_key.pem");
    const recorderKeyPath = join(dir, "registry_secret_key.pem");
    const publicKeyPath = join(dir, "public_key_hex");

    try {
      await writeFile(secretKeyPath, "fixture signing key material");
      await writeFile(recorderKeyPath, "fixture recorder key material");
      await writeFile(publicKeyPath, "fixture public key material");
      await writeFile(envFile, "CSPR_CLOUD_ACCESS_TOKEN=already-configured\n");

      const result = await writeSubmissionEvidence(parseEvidenceCliArgs([
        "--env-file",
        envFile,
        "--casper-rpc-url",
        "https://node.testnet.casper.network/rpc",
        "--casper-secret-key-path",
        secretKeyPath,
        "--casper-public-key-path",
        publicKeyPath,
        "--casper-account-identifier",
        `account-hash-${"9".repeat(64)}`,
        "--registry-package-hash",
        `hash-${"a".repeat(64)}`,
        "--registry-contract-hash",
        `hash-${"1".repeat(64)}`,
        "--registry-recorder-account-hash",
        `account-hash-${"2".repeat(64)}`,
        "--registry-recorder-key-path",
        recorderKeyPath,
        "--registry-install-hash",
        "b".repeat(64),
        "--receipt-anchor-hash",
        "3".repeat(64),
        "--x402-asset-package-hash",
        "c".repeat(64),
        "--payee-address",
        `00${"d".repeat(64)}`,
        "--settlement-tx-hash",
        "e".repeat(64),
        "--decision-tx-hash",
        "f".repeat(64),
        "--github-url",
        "https://github.com/agentpay/protocol",
        "--demo-video-url",
        "https://video.example/agentpay-demo"
      ]));

      const env = parseEnvFile(await readFile(envFile, "utf8"));

      expect(result.updatedKeys).toContain("AGENT_PAY_DECISION_TX_HASH");
      expect(env.CASPER_RPC_URL).toBe("https://node.testnet.casper.network/rpc");
      expect(env.CASPER_SECRET_KEY_PATH).toBe(secretKeyPath);
      expect(env.CASPER_PUBLIC_KEY_PATH).toBe(publicKeyPath);
      expect(env.CASPER_ACCOUNT_IDENTIFIER).toBe(`account-hash-${"9".repeat(64)}`);
      expect(env.AGENT_PAY_REGISTRY_PACKAGE_HASH).toBe(`hash-${"a".repeat(64)}`);
      expect(env.AGENT_PAY_REGISTRY_CONTRACT_HASH).toBe(`hash-${"1".repeat(64)}`);
      expect(env.AGENT_PAY_REGISTRY_RECORDER_ACCOUNT_HASH).toBe(`account-hash-${"2".repeat(64)}`);
      expect(env.AGENT_PAY_REGISTRY_RECORDER_KEY_PATH).toBe(recorderKeyPath);
      expect(env.AGENT_PAY_REGISTRY_INSTALL_HASH).toBe("b".repeat(64));
      expect(env.AGENT_PAY_RECEIPT_ANCHOR_HASH).toBe("3".repeat(64));
      expect(env.X402_ASSET_PACKAGE_HASH).toBe("c".repeat(64));
      expect(env.PAYEE_ADDRESS).toBe(`00${"d".repeat(64)}`);
      expect(env.AGENT_PAY_SETTLEMENT_TX_HASH).toBe("e".repeat(64));
      expect(env.AGENT_PAY_DECISION_TX_HASH).toBe("f".repeat(64));
      expect(env.SUBMISSION_GITHUB_URL).toBe("https://github.com/agentpay/protocol");
      expect(env.SUBMISSION_DEMO_VIDEO_URL).toBe("https://video.example/agentpay-demo");
      expect(env.CSPR_CLOUD_ACCESS_TOKEN).toBe("already-configured");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed evidence before writing the env file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpay-submission-evidence-"));
    const envFile = join(dir, ".env.submission.local");

    try {
      await expect(writeSubmissionEvidence(parseEvidenceCliArgs([
        "--env-file",
        envFile,
        "--registry-install-hash",
        "not-a-hash"
      ]))).rejects.toThrow("AGENT_PAY_REGISTRY_INSTALL_HASH must be 64 hex chars");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects reuse of the owner key as the registry recorder key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpay-submission-evidence-"));
    const envFile = join(dir, ".env.submission.local");
    const keyPath = join(dir, "secret_key.pem");

    try {
      await writeFile(keyPath, "fixture signing key material");
      await expect(writeSubmissionEvidence(parseEvidenceCliArgs([
        "--env-file",
        envFile,
        "--casper-secret-key-path",
        keyPath,
        "--registry-recorder-key-path",
        keyPath
      ]))).rejects.toThrow("must be separate");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
