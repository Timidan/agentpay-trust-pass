import { afterEach, describe, expect, it } from "vitest";
import {
  createMcpBridgeApp,
  mcpBridgeAppOptionsFromEnv,
  type McpBridgeAppOptions
} from "../src/app";

const envSnapshot = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
});

async function withBridge<T>(
  fn: (url: string) => Promise<T>,
  options: McpBridgeAppOptions = { allowUnauthenticatedPrivilegedTools: true }
): Promise<T> {
  const app = createMcpBridgeApp(options);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("MCP bridge did not bind to a TCP port");
    }
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("MCP bridge activity feed", () => {
  it("records real tool traffic and serves it at /activity", async () => {
    await withBridge(async (url) => {
      await fetch(`${url}/tools/assess_subject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "not-a-hash" })
      });
      const response = await fetch(`${url}/activity`);
      expect(response.status).toBe(200);
      const body = await response.json();
      const entry = body.entries.find((item: { tool: string }) => item.tool === "assess_subject");
      expect(entry).toBeTruthy();
      expect(entry.status).toBe(400);
      expect(typeof entry.ms).toBe("number");
      expect(typeof entry.at).toBe("string");
    });
  });
});

describe("MCP bridge error statuses", () => {
  it("does not expose JSON parser error details", async () => {
    await withBridge(async (url) => {
      const response = await fetch(`${url}/tools/quote_report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(1_100_000) })
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        error: "request_too_large",
        message: "Request body exceeds the supported limit."
      });
    });
  });

  it("requires a bearer token before invoking privileged tools", async () => {
    const authToken = "mcp-bridge-token-that-is-at-least-32-characters";
    await withBridge(async (url) => {
      const unauthenticated = await fetch(`${url}/tools/check_x402_payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toMatchObject({ error: "bridge_auth_required" });

      const invalid = await fetch(`${url}/tools/check_x402_payment`, {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token-that-is-at-least-32-characters",
          "content-type": "application/json"
        },
        body: "{}"
      });
      expect(invalid.status).toBe(401);

      const authenticated = await fetch(`${url}/tools/check_x402_payment`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/json"
        },
        body: "{}"
      });
      expect(authenticated.status).toBe(400);
      expect(await authenticated.json()).toMatchObject({ error: "invalid_input" });
    }, { authToken });
  });

  it("requires a configured bridge token from a genuine loopback peer", async () => {
    const authToken = "mcp-bridge-token-that-is-at-least-32-characters";
    const options = mcpBridgeAppOptionsFromEnv({
      MCP_SERVER_HOST: "127.0.0.1",
      MCP_SERVER_AUTH_TOKEN: authToken
    });

    const response = await dispatchBridgeTool("check_x402_payment", {}, options);

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ error: "bridge_auth_required" });
  });

  it.each([
    ["a non-loopback peer", { remoteAddress: "203.0.113.10" }],
    ["a forged Host header", {
      remoteAddress: "203.0.113.10",
      headers: { host: "127.0.0.1" }
    }],
    ["X-Forwarded-For", { headers: { "x-forwarded-for": "203.0.113.10" } }],
    ["Forwarded", { headers: { forwarded: "for=203.0.113.10" } }]
  ])("does not grant the loopback bypass through %s", async (_case, requestOptions) => {
    const options = mcpBridgeAppOptionsFromEnv({ MCP_SERVER_HOST: "127.0.0.1" });

    const response = await dispatchBridgeTool(
      "record_decision",
      {},
      options,
      requestOptions
    );

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ error: "privileged_tools_disabled" });
  });

  it("allows a genuine loopback peer when no bridge token is configured", async () => {
    const options = mcpBridgeAppOptionsFromEnv({ MCP_SERVER_HOST: "127.0.0.1" });

    const response = await dispatchBridgeTool("record_decision", {}, options);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ error: "invalid_input" });
  });

  it("protects read-only HTTP tools when a bridge token is configured", async () => {
    const authToken = "mcp-bridge-token-that-is-at-least-32-characters";
    await withBridge(async (url) => {
      const unauthenticated = await fetch(`${url}/tools/quote_report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "not-a-hash" })
      });
      expect(unauthenticated.status).toBe(401);

      const authenticated = await fetch(`${url}/tools/quote_report`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ subject: "not-a-hash" })
      });
      expect(authenticated.status).toBe(400);
      expect(await authenticated.json()).toMatchObject({ error: "invalid_subject" });
    }, { authToken });
  });

  it("disables privileged HTTP tools for a non-loopback peer without deployment authorization", async () => {
    const response = await dispatchBridgeTool(
      "record_decision",
      {},
      {},
      { remoteAddress: "203.0.113.10" }
    );

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ error: "privileged_tools_disabled" });
  });

  it("allows only assessment tools through the explicit public testnet capability", async () => {
    const options = publicAssessmentOptions();
    const requestOptions = {
      remoteAddress: "203.0.113.10",
      headers: { origin: "https://agentpay.example" }
    };

    const publicAssessment = await dispatchBridgeTool(
      "assess_subject",
      { subject: "not-a-hash" },
      options,
      requestOptions
    );
    expect(publicAssessment.status).toBe(400);

    const protectedWrite = await dispatchBridgeTool(
      "record_decision",
      {},
      options,
      requestOptions
    );
    expect(protectedWrite.status).toBe(503);

    const protectedQuote = await dispatchBridgeTool(
      "quote_report",
      { subject: "not-a-hash" },
      options,
      requestOptions
    );
    expect(protectedQuote.status).toBe(503);
  });

  it("rejects disallowed browser origins before a public assessment runs", async () => {
    await withBridge(async (url) => {
      const rejected = await fetch(`${url}/tools/assess_subject`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example"
        },
        body: JSON.stringify({ subject: "not-a-hash" })
      });
      expect(rejected.status).toBe(403);
      expect(await rejected.json()).toMatchObject({ error: "origin_not_allowed" });

      const allowed = await fetch(`${url}/tools/assess_subject`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://agentpay.example"
        },
        body: JSON.stringify({ subject: "not-a-hash" })
      });
      expect(allowed.status).toBe(400);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://agentpay.example");
    }, publicAssessmentOptions());
  });

  it("allows an origin-restricted public assessment alongside a configured bridge token", async () => {
    const authToken = "mcp-bridge-token-that-is-at-least-32-characters";
    const options = publicAssessmentOptions({ authToken, requestsPerWindow: 1 });
    const remotePeer = { remoteAddress: "203.0.113.10" };

    const guest = await dispatchBridgeTool(
      "assess_subject",
      { subject: "not-a-hash" },
      options,
      {
        ...remotePeer,
        headers: { origin: "https://agentpay.example" }
      }
    );
    expect(guest.status).toBe(400);

    const authenticated = await dispatchBridgeTool(
      "assess_subject",
      { subject: "not-a-hash" },
      options,
      {
        ...remotePeer,
        headers: { authorization: `Bearer ${authToken}` }
      }
    );
    expect(authenticated.status).toBe(400);
  });

  it("rejects a public assessment without an allowed browser origin", async () => {
    const options = publicAssessmentOptions({
      authToken: "mcp-bridge-token-that-is-at-least-32-characters"
    });

    const response = await dispatchBridgeTool(
      "assess_subject",
      { subject: "not-a-hash" },
      options,
      { remoteAddress: "203.0.113.10" }
    );

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ error: "public_origin_required" });
  });

  it("rate limits browser-origin public assessments when no bridge token is configured", async () => {
    const options = publicAssessmentOptions({ requestsPerWindow: 1 });
    const app = createMcpBridgeApp(options);
    const guestRequest = () => dispatchBridgeTool(
      "assess_subject",
      { subject: "not-a-hash" },
      options,
      {
        remoteAddress: "203.0.113.10",
        headers: { origin: "https://agentpay.example" }
      },
      app
    );
    expect((await guestRequest()).status).toBe(400);

    const limited = await guestRequest();
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body)).toMatchObject({ error: "public_assessment_rate_limited" });
  });

  it("keeps readiness status public when a bridge token is configured", async () => {
    const response = await dispatchBridgeTool(
      "registry_status",
      {},
      { authToken: "mcp-bridge-token-that-is-at-least-32-characters" },
      { remoteAddress: "203.0.113.10" }
    );

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty("status");
    expect(body).not.toHaveProperty("recordScript");
    expect(body).not.toHaveProperty("rpc.url");
    expect(body).not.toHaveProperty("receiptAnchors.recordScript");
    expect(body).not.toHaveProperty("receiptAnchors.recorderKeyConfigured");
    expect(body.checks.map((check: { name: string }) => check.name)).not.toEqual(
      expect.arrayContaining(["record_script", "casper_secret_key", "casper_client"])
    );
    expect(response.body).not.toMatch(/CASPER_SECRET_KEY_PATH|AGENT_PAY_RECORD_SCRIPT|record-decision/);
  });

  it("refuses to enable public funded assessments outside Casper testnet", () => {
    expect(() => mcpBridgeAppOptionsFromEnv({
      MCP_PUBLIC_TESTNET_ASSESSMENTS: "1",
      MCP_ALLOWED_ORIGINS: "https://agentpay.example",
      X402_NETWORK: "casper:casper-mainnet"
    })).toThrow(/testnet/i);

    expect(() => mcpBridgeAppOptionsFromEnv({
      MCP_PUBLIC_TESTNET_ASSESSMENTS: "1",
      X402_NETWORK: "casper:casper-test"
    })).toThrow(/origin/i);

    expect(mcpBridgeAppOptionsFromEnv({
      MCP_PUBLIC_TESTNET_ASSESSMENTS: "1",
      MCP_ALLOWED_ORIGINS: "https://agentpay.example",
      X402_NETWORK: "casper:casper-test",
      CASPER_CHAIN_NAME: "casper-test",
      CASPER_NETWORK: "casper-testnet",
      PAYEE_ADDRESS: `00${"8".repeat(64)}`,
      AGENT_PAY_EXPECTED_PAYEE_ADDRESS: `00${"8".repeat(64)}`,
      X402_ASSET_PACKAGE_HASH: "9".repeat(64),
      AGENT_PAY_EXPECTED_X402_ASSET: "9".repeat(64),
      AGENT_PAY_EXPECTED_NETWORK: "casper:casper-test",
      AGENT_PAY_REPORT_AMOUNT: "10000",
      AGENT_PAY_MAX_REPORT_AMOUNT: "10000"
    })).toMatchObject({
      allowedOrigins: ["https://agentpay.example"],
      publicAssessments: { requestsPerWindow: 3, dailyLimit: 100 }
    });
  });

  it("answers 400 invalid_subject for a malformed subject", async () => {
    await withBridge(async (url) => {
      const response = await fetch(`${url}/tools/assess_subject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "not-a-hash" })
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_subject");
      expect(body.message).toMatch(/Invalid subject/);
    });
  });

  it("answers 400 invalid_input for non-object tool payloads", async () => {
    await withBridge(async (url) => {
      const response = await fetch(`${url}/tools/assess_subject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([])
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_input" });
    });
  });

  it("answers 400 invalid_input for a malformed record_decision body", async () => {
    await withBridge(async (url) => {
      const response = await fetch(`${url}/tools/record_decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId: "ds", decision: "maybe" })
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_input");
    });
  });

  it("answers 503 configuration_required when the signing key is missing", async () => {
    delete process.env.CASPER_SECRET_KEY_PATH;
    await withBridge(async (url) => {
      const response = await fetch(`${url}/tools/record_decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datasetId: "ds",
          datasetRoot: "00".repeat(32),
          reportHash: "11".repeat(32),
          paymentReceiptHash: "22".repeat(32),
          decision: "approved"
        })
      });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe("configuration_required");
      expect(body.message).toMatch(/operator needs to finish the server setup/i);
      expect(JSON.stringify(body)).not.toContain("CASPER_SECRET_KEY_PATH");
    });
  });
});

function publicAssessmentOptions(
  overrides: Partial<McpBridgeAppOptions & { requestsPerWindow: number }> = {}
): McpBridgeAppOptions {
  return {
    ...(overrides.authToken ? { authToken: overrides.authToken } : {}),
    allowedOrigins: ["https://agentpay.example"],
    publicAssessments: {
      windowMs: 60_000,
      requestsPerWindow: overrides.requestsPerWindow ?? 3,
      dailyLimit: 100,
      maxTrackedClients: 100
    }
  };
}

async function dispatchBridgeTool(
  tool: string,
  bodyValue: unknown,
  options: McpBridgeAppOptions,
  requestOptions: {
    headers?: Record<string, string>;
    remoteAddress?: string;
  } = {},
  app = createMcpBridgeApp(options)
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let body = "";
    const headers: Record<string, string> = { ...requestOptions.headers };
    const requestLike = {
      method: "POST",
      url: `/tools/${tool}`,
      headers,
      body: bodyValue,
      socket: { remoteAddress: requestOptions.remoteAddress ?? "127.0.0.1" }
    };
    const responseLike = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      setHeader(name: string, value: string | number | readonly string[]) {
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
      },
      getHeader(name: string) {
        return headers[name.toLowerCase()];
      },
      removeHeader(name: string) {
        delete headers[name.toLowerCase()];
      },
      writeHead(status: number) {
        this.statusCode = status;
        this.headersSent = true;
      },
      write(chunk: unknown) {
        body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) this.write(chunk);
        this.headersSent = true;
        resolve({ status: this.statusCode, body });
      }
    };

    app.handle(requestLike as never, responseLike as never, (error) => {
      if (error) reject(error);
      else resolve({ status: responseLike.statusCode, body });
    });
  });
}
