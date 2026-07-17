import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditorRuntimeOptionsFromEnv,
  createAuditorRuntime
} from "../../src/auditor/runtime.js";

describe("auditor runtime", () => {
  it("uses one repository-root database path regardless of the launch directory", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

    expect(auditorRuntimeOptionsFromEnv({}).databasePath).toBe(
      resolve(repoRoot, "data", "agentpay.sqlite")
    );
    expect(auditorRuntimeOptionsFromEnv({ AGENTPAY_DATABASE_PATH: "data/custom.sqlite" }).databasePath).toBe(
      resolve(repoRoot, "data", "custom.sqlite")
    );
  });

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
      allowLoopbackProbeTargets: false,
      databasePath: "/tmp/agentpay-test.sqlite",
      publicOrigin: "https://agentpay.example",
      rpcUrl: "https://node.testnet.casper.network/rpc",
      sessionCookiePath: "/v1"
    });
    expect(JSON.stringify(options)).not.toContain("CASPER_SECRET_KEY_PATH");
    expect(JSON.stringify(options)).not.toContain("must/not/be/read");
  });

  it("forbids loopback probes when the deployment environment is unconfigured", () => {
    expect(auditorRuntimeOptionsFromEnv({})).toMatchObject({
      allowLoopbackProbeTargets: false
    });
  });

  it("forbids loopback probes for a production public origin", () => {
    expect(auditorRuntimeOptionsFromEnv({
      AGENTPAY_PUBLIC_ORIGIN: "https://agentpay.example"
    })).toMatchObject({ allowLoopbackProbeTargets: false });
  });

  it("allows loopback probes only through the explicit opt-in", () => {
    expect(auditorRuntimeOptionsFromEnv({
      AGENTPAY_ALLOW_LOOPBACK_PROBES: "1"
    })).toMatchObject({ allowLoopbackProbeTargets: true });
  });

  it("maps an API-prefix cookie path for reverse-proxy deployments", () => {
    expect(auditorRuntimeOptionsFromEnv({
      AGENTPAY_SESSION_COOKIE_PATH: "/api/v1"
    })).toMatchObject({ sessionCookiePath: "/api/v1" });
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

      expect(runtime.repository.schemaVersion()).toBe(6);
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
