import { describe, expect, it } from "vitest";
import { formatDemoInputs, getDemoInputs } from "../demo-inputs";

const MAINNET_WCSPR = "hash-8df5d26790e18cf0404502c62ce5dc9025800ad6975c97466e20506c39c505b6";
const TAB402_ASSET = "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf";
const TAB402_ENDPOINT = "https://tab402.fly.dev/v1/speak";

describe("one-take demo inputs", () => {
  it("verifies and prints a third-party Casper Testnet x402 endpoint", async () => {
    const inputs = await getDemoInputs({
      now: new Date("2026-07-20T01:00:00.000Z"),
      fetchImpl: mockFetch()
    });
    const output = formatDemoInputs(inputs);

    expect(inputs.payment.service).toBe("Tab402");
    expect(inputs.payment.sourceRepository).toBe("https://github.com/Eienel/tab402");
    expect(inputs.payment.endpoint).toBe(TAB402_ENDPOINT);
    expect(inputs.payment.challengeStatus).toBe(402);
    expect(inputs.payment.method).toBe("POST");
    expect(inputs.payment.body).toEqual({ text: "AgentPay live final demo" });
    expect(inputs.payment.declaredResource).toBe("http://tab402.fly.dev/v1/speak");
    expect(inputs.token).toEqual({
      input: "WCSPR",
      packageHash: MAINNET_WCSPR,
      evidenceNetwork: "casper-mainnet"
    });
    expect(inputs.wallet.input).toBe(
      "account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785"
    );
    expect(output).toContain("Service: Tab402 (not operated by AgentPay)");
    expect(output).toContain("Charge: 0.1 X402 (100000000 base units)");
    expect(output).toContain("Challenge: HTTP 402 verified");
    expect(output).toContain(`Payment token: hash-${TAB402_ASSET}`);
    expect(output).toContain("https://agentpay.timidan.xyz/bridge/tools/payment_status");
  });

  it("refuses an external 402 that omits the standard payment header", async () => {
    const healthy = mockFetch();
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input : String(input));
      if (url.toString() === TAB402_ENDPOINT) {
        return Response.json({}, { status: 402 });
      }
      return healthy(input, init);
    }) as typeof fetch;

    await expect(getDemoInputs({
      now: new Date("2026-07-20T01:00:00.000Z"),
      fetchImpl
    })).rejects.toThrow("without a PAYMENT-REQUIRED header");
  });
});

function mockFetch(): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input : String(input));
    if (url.pathname === "/api/resolve") {
      return Response.json({ symbol: "WCSPR", packageHash: MAINNET_WCSPR, network: "casper-mainnet" });
    }
    if (url.toString() === TAB402_ENDPOINT) {
      expect(init).toMatchObject({
        method: "POST",
        body: JSON.stringify({ text: "AgentPay live final demo" })
      });
      return new Response(JSON.stringify({ error: "payment_required" }), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "payment-required": Buffer.from(JSON.stringify(tab402PaymentRequired()), "utf8").toString("base64")
        }
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function tab402PaymentRequired() {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "http://tab402.fly.dev/v1/speak",
      description: "Text-to-speech via Deepgram, paid per call over x402",
      mimeType: "audio/mpeg"
    },
    accepts: [{
      scheme: "exact",
      network: "casper:casper-test",
      amount: "100000000",
      asset: TAB402_ASSET,
      payTo: `00${"b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8"}`,
      maxTimeoutSeconds: 300,
      extra: { name: "Casper X402 Token", symbol: "X402", version: "1", decimals: "9" }
    }]
  };
}
