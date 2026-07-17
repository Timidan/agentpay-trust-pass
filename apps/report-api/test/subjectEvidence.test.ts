import { describe, it, expect } from "vitest";
import { buildSubjectEvidence } from "../src/subjectEvidence.js";
import { extractSignals } from "@agent-pay/core";

const subject = { kind: "token" as const, packageHash: "a".repeat(64), raw: "a".repeat(64) };

describe("buildSubjectEvidence", () => {
  it("builds a Merkle dataset of the mandatory signal records", async () => {
    const ds = await buildSubjectEvidence(subject, {
      fetchTokenState: async () => ({ mintBurnEnabled: true,
        holderCount: 1, topHolderPct: 100, installBlock: 100, latestBlock: 130,
        authoritySourceUrl: "https://node.testnet.example/rpc",
        holdersSourceUrl: `https://api.testnet.example/contract-packages/${subject.packageHash}/ft-token-ownership`,
        ageSourceUrl: `https://api.testnet.example/contract-packages/${subject.packageHash}/contracts` }),
    });
    expect(ds.root).toMatch(/^[0-9a-f]+$/);
    const signals = extractSignals(ds.reports.map((r) => r.record));
    expect(signals.mintBurnEnabled).toBe(true);
    expect(signals.contractAgeBlocks).toBe(30);
    expect(signals.lpHolderCount).toBeNull(); // not checked on Testnet
    expect(signals.holderCount).toBe(1);
    expect(signals.topHolderPct).toBe(100);
    expect(signals.liquidityDepth).toBeNull(); // not checked on Testnet

    expect(ds.reports.map((report) => [report.record.subject, report.record.sourceUrl])).toEqual([
      ["token_authority", "https://node.testnet.example/rpc"],
      ["token_holders", `https://api.testnet.example/contract-packages/${subject.packageHash}/ft-token-ownership`],
      ["token_age", `https://api.testnet.example/contract-packages/${subject.packageHash}/contracts`]
    ]);
    expect(ds.sourceSummary.map((source) => source.sourceUrl)).toEqual(
      ds.reports.map((report) => report.record.sourceUrl)
    );
  });

  it("does not emit a negative contract age when source heights are inconsistent", async () => {
    const ds = await buildSubjectEvidence(subject, {
      fetchTokenState: async () => ({
        mintBurnEnabled: false,
        holderCount: 10,
        topHolderPct: 25,
        installBlock: 200,
        latestBlock: 130
      })
    });

    expect(extractSignals(ds.reports.map((report) => report.record)).contractAgeBlocks).toBeNull();
  });

  it("labels and scopes Mainnet evidence independently of payment configuration", async () => {
    const ds = await buildSubjectEvidence(subject, {
      network: "casper-mainnet",
      fetchTradeMarket: async () => ({
        listedOnCsprTrade: true,
        pairCount: 2,
        pricedPairCount: 1,
        pricedLiquidityUsd: 125.5,
        sourceUrl: "https://mcp.cspr.trade/mcp",
        rawHash: "b".repeat(64)
      }),
      fetchTokenState: async () => ({
        mintBurnEnabled: false,
        holderCount: 10,
        topHolderPct: 25,
        installBlock: 100,
        latestBlock: 1_500
      })
    });

    expect(ds.datasetId).toMatch(/^trust-casper-mainnet-/);
    expect(ds.sourceSummary.every((source) => source.network === "casper-mainnet")).toBe(true);
    expect(ds.sourceSummary).toContainEqual(expect.objectContaining({
      product: "CSPR.trade Market",
      sourceUrl: "https://mcp.cspr.trade/mcp",
      facts: expect.objectContaining({
        listedOnCsprTrade: true,
        pairCount: 2,
        pricedLiquidityUsd: 125.5
      })
    }));
    expect(extractSignals(ds.reports.map((report) => report.record)).liquidityDepth).toBe(125.5);
  });

  it("does not mix Mainnet CSPR.trade observations into a Testnet check", async () => {
    let tradeCalls = 0;
    await buildSubjectEvidence(subject, {
      network: "casper-testnet",
      fetchTradeMarket: async () => {
        tradeCalls += 1;
        throw new Error("must not be called");
      },
      fetchTokenState: async () => ({
        mintBurnEnabled: false,
        publicMintEntrypoint: false,
        holderCount: 2,
        topHolderPct: 60,
        installBlock: 1,
        latestBlock: 2_000
      })
    });

    expect(tradeCalls).toBe(0);
  });

  it("gives concurrent checks distinct registry dataset ids even at the same block", async () => {
    const fetchTokenState = async () => ({
      mintBurnEnabled: false,
      publicMintEntrypoint: false,
      holderCount: 20,
      topHolderPct: 12,
      installBlock: 100,
      latestBlock: 2_000
    });

    const [first, second] = await Promise.all([
      buildSubjectEvidence(subject, { fetchTokenState }),
      buildSubjectEvidence(subject, { fetchTokenState })
    ]);

    expect(first.datasetId).not.toBe(second.datasetId);
  });
});
