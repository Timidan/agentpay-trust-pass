import { describe, expect, it } from "vitest";
import {
  csprCloudEndpoints,
  defaultEvidenceNetwork,
  evidenceRpcUrl,
  parseEvidenceNetwork
} from "../src/evidenceNetwork.js";

describe("evidence network configuration", () => {
  it("accepts only explicit Casper evidence networks", () => {
    expect(parseEvidenceNetwork("casper-mainnet")).toBe("casper-mainnet");
    expect(parseEvidenceNetwork("casper-testnet")).toBe("casper-testnet");
    expect(parseEvidenceNetwork("casper:casper-test")).toBeNull();
  });

  it("keeps evidence RPC selection separate from the x402 payment RPC", () => {
    const env = {
      CASPER_RPC_URL: "https://payment-testnet.example/rpc",
      AGENTPAY_MAINNET_RPC_URL: "https://mainnet.example/rpc",
      AGENTPAY_TESTNET_RPC_URL: "https://evidence-testnet.example/rpc"
    };

    expect(evidenceRpcUrl("casper-mainnet", env)).toBe("https://mainnet.example/rpc");
    expect(evidenceRpcUrl("casper-testnet", env)).toBe(
      "https://evidence-testnet.example/rpc"
    );
  });

  it("selects matching CSPR.cloud endpoints for each evidence network", () => {
    expect(csprCloudEndpoints("casper-mainnet", {})).toEqual({
      restBase: "https://api.cspr.cloud",
      nodeRpcUrl: "https://node.cspr.cloud/rpc"
    });
    expect(csprCloudEndpoints("casper-testnet", {})).toEqual({
      restBase: "https://api.testnet.cspr.cloud",
      nodeRpcUrl: "https://node.testnet.cspr.cloud/rpc"
    });
  });

  it("defaults to Testnet for backward-compatible CLI calls and rejects bad configuration", () => {
    expect(defaultEvidenceNetwork({})).toBe("casper-testnet");
    expect(() =>
      defaultEvidenceNetwork({ AGENTPAY_DEFAULT_EVIDENCE_NETWORK: "wrong" })
    ).toThrow(/casper-mainnet or casper-testnet/);
  });
});
