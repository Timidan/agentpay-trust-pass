import { describe, expect, it } from "vitest";
import { formatDemoInputs, getDemoInputs } from "../demo-inputs";

const MAINNET_WCSPR = "hash-8df5d26790e18cf0404502c62ce5dc9025800ad6975c97466e20506c39c505b6";
const TESTNET_WCSPR = "3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e";
const FRESH_ENDPOINT =
  "https://agentpay.timidan.xyz/api/reports/buy/trust-casper-mainnet-8df5d267-demo";

describe("one-take demo inputs", () => {
  it("prints a fresh real x402 endpoint and the fixed public demo inputs", async () => {
    const inputs = await getDemoInputs({
      now: new Date("2026-07-20T01:00:00.000Z"),
      fetchImpl: mockFetch()
    });
    const output = formatDemoInputs(inputs);

    expect(inputs.payment.endpoint).toBe(FRESH_ENDPOINT);
    expect(inputs.payment.challengeStatus).toBe(402);
    expect(inputs.payment.method).toBe("POST");
    expect(inputs.payment.body).toEqual({});
    expect(inputs.token).toEqual({
      input: "WCSPR",
      packageHash: MAINNET_WCSPR,
      evidenceNetwork: "casper-mainnet"
    });
    expect(inputs.wallet.input).toBe(
      "account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785"
    );
    expect(output).toContain("Charge: 0.00001 WCSPR (10000 base units)");
    expect(output).toContain("Challenge: HTTP 402 verified");
    expect(output).toContain(`Payment token: hash-${TESTNET_WCSPR}`);
    expect(output).toContain("https://agentpay.timidan.xyz/bridge/tools/payment_status");
  });

  it("refuses to print an expired endpoint", async () => {
    await expect(getDemoInputs({
      now: new Date("2026-07-20T01:06:00.000Z"),
      fetchImpl: mockFetch()
    })).rejects.toThrow("already expired");
  });
});

function mockFetch(): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(input instanceof URL ? input : String(input));
    if (url.pathname === "/api/resolve") {
      return Response.json({ symbol: "WCSPR", packageHash: MAINNET_WCSPR, network: "casper-mainnet" });
    }
    if (url.pathname === "/api/reports/quote") {
      return Response.json({
        amountDisplay: "0.00001",
        asset: "WCSPR",
        assetPackageHash: TESTNET_WCSPR,
        expiresAt: "2026-07-20T01:05:00.000Z",
        paymentReadiness: { status: "ready" },
        paymentResource: { url: FRESH_ENDPOINT },
        paymentRequirements: [{
          amount: "10000",
          network: "casper:casper-test",
          payTo: "000bd3af0768fc1303f5bd0c67777e83b168e66aec2fa0e024f15737a30541d2fe"
        }]
      });
    }
    if (url.toString() === FRESH_ENDPOINT) {
      return new Response(JSON.stringify({ error: "payment_required" }), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "payment-required": "encoded-x402-requirement"
        }
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
