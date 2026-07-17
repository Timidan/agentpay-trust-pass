import { buildX402PaymentSignature, createCasperSigner } from "@agent-pay/client";
import type { PaymentAssetEvidence } from "@agent-pay/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configuredFacilitatorUrl,
  checkPaymentReadiness,
  formatTokenAmount,
  PaymentConfigurationError,
  PaymentRejectedError,
  settleX402Payment,
  type PaymentRequirement,
  type PaymentResource
} from "../src/payment.js";

const originalFacilitatorUrl = process.env.X402_FACILITATOR_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalFacilitatorUrl === undefined) {
    delete process.env.X402_FACILITATOR_URL;
  } else {
    process.env.X402_FACILITATOR_URL = originalFacilitatorUrl;
  }
});

describe("facilitator configuration", () => {
  it.each([
    ["10000", "9", "0.00001"],
    ["12500000000", "9", "12.5"],
    ["100", "2", "1"],
    ["7", "0", "7"]
  ] as const)("formats %s base units with %s decimals", (amount, decimals, expected) => {
    expect(formatTokenAmount(amount, decimals)).toBe(expected);
  });

  it("allows plain HTTP only for loopback development and normalizes the base URL", () => {
    process.env.X402_FACILITATOR_URL = "http://127.0.0.1:4022///";

    expect(configuredFacilitatorUrl()).toBe("http://127.0.0.1:4022");
  });

  it("rejects an ambiguous verify body without calling settlement", async () => {
    process.env.X402_FACILITATOR_URL = "https://facilitator.example";
    let settleCalls = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (rawUrl) => {
      if (String(rawUrl).endsWith("/verify")) return Response.json({});
      settleCalls += 1;
      return Response.json({ success: false });
    }));
    const requirement: PaymentRequirement = {
      scheme: "exact",
      network: "casper:casper-test",
      asset: "9".repeat(64),
      amount: "10000",
      payTo: `00${"8".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Cep18x402", version: "1", symbol: "CSPR" }
    };
    const resource: PaymentResource = {
      url: "https://agentpay.example/reports/buy/test-quote",
      description: "AgentPay test report",
      mimeType: "application/json"
    };
    const paymentPayload = buildX402PaymentSignature({
      requirement,
      resource,
      signer: createCasperSigner("secp256k1", new Uint8Array(32).fill(7)),
      now: Math.floor(Date.now() / 1_000),
      nonce: new Uint8Array(32).fill(4)
    }).paymentPayload;

    await expect(settleX402Payment({ paymentPayload, requirement, resource })).rejects.toEqual(
      expect.objectContaining<Partial<PaymentRejectedError>>({
        name: "PaymentRejectedError",
        settlementResponse: {}
      })
    );
    expect(settleCalls).toBe(0);
  });

  it("requires HTTPS for remote facilitators", () => {
    process.env.X402_FACILITATOR_URL = "http://facilitator.example";

    expect(() => configuredFacilitatorUrl()).toThrow(PaymentConfigurationError);
  });

  it("fails readiness before contacting the facilitator when fee-token metadata differs from Casper", async () => {
    process.env.X402_FACILITATOR_URL = "https://facilitator.example";
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    const requirement: PaymentRequirement = {
      scheme: "exact",
      network: "casper:casper-test",
      asset: "9".repeat(64),
      amount: "10000",
      payTo: `00${"8".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "X402" }
    };
    const evidence: PaymentAssetEvidence = {
      network: "casper:casper-test",
      packageHash: requirement.asset,
      packageExists: true,
      activeContractHash: "4".repeat(64),
      authorizationEntrypoint: true,
      name: requirement.extra.name,
      symbol: "WRONG",
      decimals: 9,
      mintBurnEnabled: false,
      publicMintEntrypoint: false,
      holderConcentrationPct: null,
      contractAgeBlocks: null,
      apiVersion: "2.0.0",
      observedBlockHash: "7".repeat(64),
      observedBlockHeight: 8_449_100,
      observedAt: "2026-07-17T00:00:00.000Z",
      missing: [],
      sourceErrors: [],
      evidenceHash: "a".repeat(64)
    };

    await expect(checkPaymentReadiness({
      requirement,
      configurationReason: null,
      assetEvidence: evidence,
      assetEvidenceError: null
    })).resolves.toMatchObject({
      status: "configuration_required",
      reason: "x402_asset_metadata_mismatch"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports an RPC timeout as unavailable rather than claiming the package is absent", async () => {
    process.env.X402_FACILITATOR_URL = "https://facilitator.example";
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    const requirement: PaymentRequirement = {
      scheme: "exact",
      network: "casper:casper-test",
      asset: "9".repeat(64),
      amount: "10000",
      payTo: `00${"8".repeat(64)}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Cep18x402", version: "1", decimals: "9", symbol: "X402" }
    };
    const evidence: PaymentAssetEvidence = {
      network: "casper:casper-test",
      packageHash: requirement.asset,
      packageExists: false,
      activeContractHash: null,
      authorizationEntrypoint: false,
      name: null,
      symbol: null,
      decimals: null,
      mintBurnEnabled: null,
      publicMintEntrypoint: null,
      holderConcentrationPct: null,
      contractAgeBlocks: null,
      apiVersion: null,
      observedBlockHash: null,
      observedBlockHeight: null,
      observedAt: "2026-07-17T00:00:00.000Z",
      missing: ["package", "activeContractHash", "authorizationEntrypoint", "name", "symbol", "decimals"],
      sourceErrors: ["package: Casper RPC query_global_state timed out after 5000ms"],
      evidenceHash: "a".repeat(64)
    };

    await expect(checkPaymentReadiness({
      requirement,
      configurationReason: null,
      assetEvidence: evidence,
      assetEvidenceError: null
    })).resolves.toMatchObject({
      status: "configuration_required",
      reason: "x402_asset_evidence_unavailable"
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "https://user:secret@facilitator.example",
    "https://facilitator.example?token=secret",
    "https://facilitator.example/#fragment"
  ])("rejects facilitator URLs containing credentials, query data, or fragments", (url) => {
    process.env.X402_FACILITATOR_URL = url;

    expect(() => configuredFacilitatorUrl()).toThrow(PaymentConfigurationError);
  });
});
