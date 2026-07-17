import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createReportApp } from "../../src/app.js";
import { AuditorAuth, AuthError, hashBearerToken } from "../../src/auditor/auth.js";
import {
  X402Probe,
  type ProbeAddress,
  type ProbeTransport,
  type ProbeTransportResponse
} from "../../src/auditor/probe.js";
import { createAuditorRouter } from "../../src/auditor/routes.js";
import { openSqliteRepository } from "../../src/auditor/sqliteRepository.js";

const NOW = "2026-07-15T21:00:00.000Z";
const PUBLIC_ADDRESS: ProbeAddress = { address: "93.184.216.34", family: 4 };
const ASSET = "5".repeat(64);
const PAYEE = `00${"6".repeat(64)}`;

describe("X402Probe", () => {
  it.runIf(process.env.AGENTPAY_LIVE_PROBE === "1")(
    "probes the live Tab402 endpoint through the production pinned transport",
    async () => {
      const probe = new X402Probe({ allowHttp: false });
      const result = await probe.probe({
        url: "https://tab402.fly.dev/v1/speak",
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: { text: "AgentPay live probe verification" }
      });

      expect(result.response.status).toBe(402);
      expect(result.terms).toMatchObject({
        network: "casper:casper-test",
        asset: "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf",
        amount: "100000000",
        payTo: "00b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8"
      });
    },
    15_000
  );

  it("captures a public 402, pins the validated address, and returns no response body", async () => {
    const transport = vi.fn<ProbeTransport>(async () => response(402, {
      "content-type": "application/json",
      "payment-required": paymentRequiredHeader()
    }, "payment required"));
    const probe = makeProbe({ transport });

    const result = await probe.probe({
      url: "https://service.example/v1/generate",
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: { prompt: "hello" }
    });

    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      url: new URL("https://service.example/v1/generate"),
      address: PUBLIC_ADDRESS,
      method: "POST",
      headers: expect.objectContaining({
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "AgentPay-Probe/1.0"
      })
    }));
    expect(result).toMatchObject({
      request: { method: "POST", origin: "https://service.example" },
      response: { status: 402, contentType: "application/json" },
      terms: { network: "casper:casper-test", asset: ASSET, payTo: PAYEE },
      paymentRequired: paymentRequiredValue()
    });
    expect(result).not.toHaveProperty("body");
    expect(JSON.stringify(result)).not.toContain("payment required");
    expect(result.response.bodyHash).toBe(createHash("sha256").update("payment required").digest("hex"));
  });

  it("falls back to another validated public address after a retryable transport failure", async () => {
    const unavailable: ProbeAddress = { address: "93.184.216.35", family: 4 };
    const transport = vi.fn<ProbeTransport>(async ({ address }) => {
      if (address.address === unavailable.address) {
        throw new AuthError("probe_transport_failed", "address unavailable", 502, { retryable: true });
      }
      return response(402, { "payment-required": paymentRequiredHeader() }, "");
    });
    const probe = makeProbe({
      transport,
      lookup: async () => [unavailable, PUBLIC_ADDRESS]
    });

    const result = await probe.probe({ url: "https://service.example", method: "GET" });

    expect(result.response.status).toBe(402);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map(([input]) => input.address)).toEqual([unavailable, PUBLIC_ADDRESS]);
  });

  it.each([
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0177.0.0.1/",
    "https://0x7f000001/",
    "https://10.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/"
  ])("rejects non-public target %s before transport", async (url) => {
    const transport = vi.fn<ProbeTransport>();
    const probe = makeProbe({ transport });

    await expect(probe.probe({ url, method: "GET" })).rejects.toMatchObject({
      code: "probe_target_forbidden"
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("allows a loopback target only when loopback development access is enabled", async () => {
    const transport = vi.fn<ProbeTransport>(async () =>
      response(402, { "payment-required": paymentRequiredHeader() }, "")
    );
    const probe = makeProbe({ allowLoopback: true, transport });

    const result = await probe.probe({
      url: "http://127.0.0.1:4021/reports/buy/quote-id",
      method: "POST"
    });

    expect(result.response.status).toBe(402);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      address: { address: "127.0.0.1", family: 4 }
    }));
  });

  it("rejects a hostname if any resolved address is private", async () => {
    const transport = vi.fn<ProbeTransport>();
    const probe = makeProbe({
      transport,
      lookup: async () => [PUBLIC_ADDRESS, { address: "10.0.0.4", family: 4 }]
    });

    await expect(probe.probe({ url: "https://mixed.example", method: "GET" })).rejects.toMatchObject({
      code: "probe_target_forbidden"
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("revalidates redirects and rejects a redirect to a private address", async () => {
    const transport = vi.fn<ProbeTransport>(async () => response(302, { location: "https://127.0.0.1/admin" }, ""));
    const probe = makeProbe({ transport });

    await expect(probe.probe({ url: "https://service.example", method: "GET" })).rejects.toMatchObject({
      code: "probe_target_forbidden"
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("stops after three redirects", async () => {
    let redirect = 0;
    const transport = vi.fn<ProbeTransport>(async () => {
      redirect += 1;
      return response(302, { location: `https://service.example/r${redirect}` }, "");
    });
    const probe = makeProbe({ transport });

    await expect(probe.probe({ url: "https://service.example", method: "GET" })).rejects.toMatchObject({
      code: "probe_redirect_limit"
    });
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("rejects HTTP in production mode", async () => {
    const probe = makeProbe({ allowHttp: false });

    await expect(probe.probe({ url: "http://service.example", method: "GET" })).rejects.toMatchObject({
      code: "probe_https_required"
    });
  });

  it("rejects oversized request and response bodies", async () => {
    const probe = makeProbe();
    await expect(probe.probe({
      url: "https://service.example",
      method: "POST",
      body: { content: "x".repeat(65 * 1024) }
    })).rejects.toMatchObject({ code: "probe_request_too_large" });

    const oversized = makeProbe({
      transport: async () => ({ status: 402, headers: {}, body: new Uint8Array(1024 * 1024 + 1) })
    });
    await expect(oversized.probe({ url: "https://service.example", method: "GET" }))
      .rejects.toMatchObject({ code: "probe_response_too_large" });
  });

  it("enforces the total timeout even when an injected transport stalls", async () => {
    const probe = makeProbe({
      timeoutMs: 20,
      transport: async () => new Promise<ProbeTransportResponse>(() => {})
    });

    await expect(probe.probe({ url: "https://service.example", method: "GET" }))
      .rejects.toMatchObject({ code: "probe_timeout", retryable: true });
  });

  it.each(["authorization", "cookie", "proxy-authorization", "user-agent", "x-api-key"])(
    "rejects caller-supplied %s headers",
    async (header) => {
      const probe = makeProbe();
      await expect(probe.probe({
        url: "https://service.example",
        method: "GET",
        headers: { [header]: "secret" }
      })).rejects.toMatchObject({ code: "probe_header_forbidden" });
    }
  );

  it("rejects malformed PAYMENT-REQUIRED without retaining the response body", async () => {
    const probe = makeProbe({
      transport: async () => response(402, { "payment-required": "not base64!" }, "sensitive body")
    });

    await expect(probe.probe({ url: "https://service.example", method: "GET" }))
      .rejects.toMatchObject({ code: "invalid_payment_required" });
  });

  it("exposes an authenticated route using the existing checks scope", async () => {
    const repository = openSqliteRepository(":memory:", { now: () => new Date(NOW) });
    const token = "probe-agent-token-000000000000000000000000";
    repository.saveAgentToken({
      id: "probe-agent",
      operatorPublicKey: `01${"1".repeat(64)}`,
      agentName: "probe-agent",
      tokenHash: hashBearerToken(token),
      scopes: ["checks:write"],
      allowedPayerPublicKeys: [],
      revision: 1,
      actionHash: "2".repeat(64),
      signature: `01${"3".repeat(128)}`,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null
    });
    try {
      const auth = new AuditorAuth({
        repository,
        publicOrigin: "https://agentpay.example",
        now: () => new Date(NOW)
      });
      const probe = makeProbe();
      const app = createReportApp({ auditorRouter: createAuditorRouter({ repository, auth, probe }) });

      await request(app)
        .post("/v1/probes")
        .send({ url: "https://service.example/v1/generate", method: "GET" })
        .expect(401);
      const response = await request(app)
        .post("/v1/probes")
        .set("Authorization", `Bearer ${token}`)
        .send({ url: "https://service.example/v1/generate", method: "GET" })
        .expect(200);
      expect(response.body.terms).toMatchObject({ asset: ASSET, payTo: PAYEE });
    } finally {
      repository.close();
    }
  });
});

function makeProbe(overrides: {
  allowHttp?: boolean;
  allowLoopback?: boolean;
  timeoutMs?: number;
  lookup?: (hostname: string) => Promise<ProbeAddress[]>;
  transport?: ProbeTransport;
} = {}): X402Probe {
  return new X402Probe({
    allowHttp: overrides.allowHttp ?? true,
    ...({ allowLoopback: overrides.allowLoopback ?? false } as object),
    timeoutMs: overrides.timeoutMs,
    now: () => new Date(NOW),
    lookup: overrides.lookup ?? (async () => [PUBLIC_ADDRESS]),
    transport: overrides.transport ?? (async () => response(402, { "payment-required": paymentRequiredHeader() }, ""))
  });
}

function response(status: number, headers: Record<string, string>, body: string): ProbeTransportResponse {
  return { status, headers, body: new TextEncoder().encode(body) };
}

function paymentRequiredHeader(): string {
  return Buffer.from(JSON.stringify(paymentRequiredValue()), "utf8").toString("base64");
}

function paymentRequiredValue() {
  return {
    x402Version: 2,
    resource: {
      url: "https://service.example/v1/generate",
      description: "Generate a response",
      mimeType: "application/json"
    },
    accepts: [{
      scheme: "exact",
      network: "casper:casper-test",
      asset: ASSET,
      amount: "100",
      payTo: PAYEE,
      maxTimeoutSeconds: 300,
      extra: { name: "Casper X402 Token", version: "1", decimals: "9", symbol: "X402" }
    }]
  };
}
