import { afterEach, describe, expect, it } from "vitest";
import { createMcpBridgeApp } from "../src/app";

const envSnapshot = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);
});

async function withBridge<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const app = createMcpBridgeApp();
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
  it("answers 400 invalid_input for a malformed subject", async () => {
    await withBridge(async (url) => {
      const response = await fetch(`${url}/tools/assess_subject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "WCSPR" })
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_input");
      expect(body.message).toMatch(/Invalid subject/);
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
    });
  });
});
