import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCasperFundingStatus, formatCasperFundingStatus, type CasperFundingStatus } from "../casper-funding-status";

describe("AgentPay Casper funding status", () => {
  it("formats the account hash, faucet URL, and required CSPR amount", () => {
    const status: CasperFundingStatus = {
      accountHash: `account-hash-${"a".repeat(64)}`,
      balanceMotes: "0",
      requiredMotes: "25100000000",
      funded: false,
      faucetUrl: "https://testnet.cspr.live/tools/faucet",
      publicKeyPath: ".agentpay-testnet-key/public_key_hex",
      rpcUrl: "https://node.testnet.casper.network/rpc",
      message: "Account is not funded on Casper Testnet yet"
    };

    expect(formatCasperFundingStatus(status)).toContain(`Account: account-hash-${"a".repeat(64)}`);
    expect(formatCasperFundingStatus(status)).toContain("Required: 25100000000 motes (25.1 CSPR)");
    expect(formatCasperFundingStatus(status)).toContain("Faucet: https://testnet.cspr.live/tools/faucet");
    expect(formatCasperFundingStatus(status)).toContain("Funded: no");
  });

  it("reports a missing configured public key file before calling Casper", async () => {
    const status = await createCasperFundingStatus({
      CASPER_PUBLIC_KEY_PATH: ".agentpay-testnet-key/missing_funded_public_key_hex",
      CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
      CASPER_CLIENT_COMMAND: "casper-client"
    });

    expect(status.funded).toBe(false);
    expect(status.message).toBe("CASPER_PUBLIC_KEY_PATH does not exist or is not readable: .agentpay-testnet-key/missing_funded_public_key_hex");
  });

  it("checks funding with a wallet account identifier when no public key file is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentpay-funding-identifier-"));
    const clientPath = join(dir, "casper-client");

    try {
      await writeFile(
        clientPath,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== "query-balance") process.exit(2);
console.log(JSON.stringify({ result: { balance: "25100000000" } }));
`
      );
      await chmod(clientPath, 0o700);

      const status = await createCasperFundingStatus({
        CASPER_ACCOUNT_IDENTIFIER: `account-hash-${"b".repeat(64)}`,
        CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
        CASPER_CLIENT_COMMAND: clientPath
      });

      expect(status.funded).toBe(true);
      expect(status.accountHash).toBe(`account-hash-${"b".repeat(64)}`);
      expect(status.publicKeyPath).toBe(null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
