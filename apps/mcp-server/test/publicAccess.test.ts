import { describe, expect, it } from "vitest";
import {
  bridgeAccessOptionsFromEnv,
  PublicAssessmentLimiter
} from "../src/publicAccess.js";

describe("bridgeAccessOptionsFromEnv", () => {
  it("does not infer unauthenticated access from the configured bind host", () => {
    expect(bridgeAccessOptionsFromEnv({
      MCP_SERVER_HOST: "127.0.0.1",
      MCP_SERVER_AUTH_TOKEN: "mcp-bridge-token-that-is-at-least-32-characters"
    })).not.toHaveProperty("allowUnauthenticatedPrivilegedTools");

    expect(bridgeAccessOptionsFromEnv({
      MCP_SERVER_HOST: "0.0.0.0",
      MCP_SERVER_AUTH_TOKEN: "mcp-bridge-token-that-is-at-least-32-characters"
    })).not.toHaveProperty("allowUnauthenticatedPrivilegedTools");
  });

  it("keeps the explicit unauthenticated privileged-tool opt-in", () => {
    expect(bridgeAccessOptionsFromEnv({
      MCP_SERVER_HOST: "0.0.0.0",
      MCP_ALLOW_UNAUTHENTICATED_PRIVILEGED_TOOLS: "1"
    })).toMatchObject({ allowUnauthenticatedPrivilegedTools: true });
  });

  it("requires a pinned spend ceiling before enabling funded public checks", () => {
    const env = publicAssessmentEnv();
    delete env.AGENT_PAY_MAX_REPORT_AMOUNT;

    expect(() => bridgeAccessOptionsFromEnv(env)).toThrow(
      /AGENT_PAY_MAX_REPORT_AMOUNT is required/
    );
  });

  it("enables funded public checks only when payment terms match local spend guards", () => {
    expect(bridgeAccessOptionsFromEnv(publicAssessmentEnv())).toMatchObject({
      allowedOrigins: ["https://agentpay.example"],
      publicAssessments: {
        requestsPerWindow: 3,
        dailyLimit: 100
      }
    });

    expect(() => bridgeAccessOptionsFromEnv({
      ...publicAssessmentEnv(),
      AGENT_PAY_EXPECTED_X402_ASSET: "7".repeat(64)
    })).toThrow(/must match X402_ASSET_PACKAGE_HASH/);
  });
});

describe("PublicAssessmentLimiter", () => {
  it("enforces the global UTC-day cap and resets on the next day", () => {
    let now = new Date("2026-07-16T23:59:30.000Z");
    const limiter = new PublicAssessmentLimiter({
      windowMs: 60_000,
      requestsPerWindow: 10,
      dailyLimit: 2,
      maxTrackedClients: 10,
      now: () => now
    });

    expect(limiter.consume("client-a")).toMatchObject({ allowed: true });
    expect(limiter.consume("client-b")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("client-c")).toMatchObject({
      allowed: false,
      reason: "daily_limit",
      retryAfterSeconds: 30
    });

    now = new Date("2026-07-17T00:00:00.000Z");
    expect(limiter.consume("client-c")).toMatchObject({ allowed: true });
  });

  it("resets a client window without disabling the daily budget", () => {
    let now = new Date("2026-07-16T12:00:00.000Z");
    const limiter = new PublicAssessmentLimiter({
      windowMs: 1_000,
      requestsPerWindow: 1,
      dailyLimit: 10,
      maxTrackedClients: 10,
      now: () => now
    });

    expect(limiter.consume("client-a")).toMatchObject({ allowed: true });
    expect(limiter.consume("client-a")).toMatchObject({
      allowed: false,
      reason: "client_rate",
      retryAfterSeconds: 1
    });

    now = new Date("2026-07-16T12:00:01.000Z");
    expect(limiter.consume("client-a")).toMatchObject({ allowed: true });
  });
});

function publicAssessmentEnv(): NodeJS.ProcessEnv {
  return {
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
  };
}
