import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditorRuntimeOptionsFromEnv,
  createAuditorRuntime
} from "../../src/auditor/runtime.js";

describe("auditor runtime", () => {
  it("maps deployment environment values without inheriting buyer-key configuration", () => {
    const options = auditorRuntimeOptionsFromEnv({
      REPORT_API_HOST: "127.0.0.1",
      REPORT_API_PORT: "4100",
      AGENTPAY_DATABASE_PATH: "/tmp/agentpay-test.sqlite",
      AGENTPAY_PUBLIC_ORIGIN: "https://agentpay.example",
      CASPER_RPC_URL: "https://node.testnet.casper.network/rpc",
      CASPER_SECRET_KEY_PATH: "/must/not/be/read"
    });

    expect(options).toEqual({
      databasePath: "/tmp/agentpay-test.sqlite",
      publicOrigin: "https://agentpay.example",
      rpcUrl: "https://node.testnet.casper.network/rpc"
    });
    expect(JSON.stringify(options)).not.toContain("CASPER_SECRET_KEY_PATH");
    expect(JSON.stringify(options)).not.toContain("must/not/be/read");
  });

  it("opens the durable runtime at the current schema and closes idempotently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentpay-runtime-"));
    const databasePath = join(directory, "auditor.sqlite");
    try {
      const runtime = createAuditorRuntime({
        databasePath,
        publicOrigin: "http://127.0.0.1:4100/",
        rpcUrl: "http://127.0.0.1:1",
        now: () => new Date("2026-07-15T21:00:00.000Z")
      });

      expect(runtime.repository.schemaVersion()).toBe(5);
      expect(runtime.router).toBeDefined();
      runtime.close();
      runtime.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid deployment ports before opening the database", () => {
    expect(() => auditorRuntimeOptionsFromEnv({ REPORT_API_PORT: "70000" })).toThrow(
      "REPORT_API_PORT must be an integer from 1 to 65535"
    );
  });
});
