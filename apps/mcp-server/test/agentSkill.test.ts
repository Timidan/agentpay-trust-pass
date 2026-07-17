import { afterEach, describe, expect, it } from "vitest";
import { agentPayPublicOrigin, agentPaySkillMarkdown } from "../src/agentSkill.js";

const envSnapshot = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
});

describe("AgentPay skill origin", () => {
  it("uses the public API base ahead of the auth origin and internal API URL", () => {
    process.env.AGENT_PAY_RESOURCE_BASE_URL = "https://agentpay.example/api/";
    process.env.AGENTPAY_PUBLIC_ORIGIN = "https://agentpay.example/";
    process.env.AGENT_PAY_PUBLIC_ORIGIN = "https://legacy.example";
    process.env.REPORT_API_URL = "http://127.0.0.1:4021";

    expect(agentPayPublicOrigin()).toBe("https://agentpay.example/api");
  });

  it("keeps the legacy public-origin alias compatible", () => {
    delete process.env.AGENTPAY_PUBLIC_ORIGIN;
    process.env.AGENT_PAY_PUBLIC_ORIGIN = "https://legacy.example/";

    expect(agentPayPublicOrigin()).toBe("https://legacy.example");
  });

  it("fails closed instead of publishing an internal URL in production", () => {
    delete process.env.AGENT_PAY_PUBLIC_API_URL;
    delete process.env.AGENT_PAY_RESOURCE_BASE_URL;
    delete process.env.REPORT_API_PUBLIC_URL;
    delete process.env.AGENTPAY_PUBLIC_ORIGIN;
    delete process.env.AGENT_PAY_PUBLIC_ORIGIN;
    process.env.REPORT_API_URL = "http://127.0.0.1:4021";
    process.env.NODE_ENV = "production";

    expect(() => agentPayPublicOrigin()).toThrow(/AGENT_PAY_RESOURCE_BASE_URL/);
  });

  it("documents live symbol resolution and separates evidence from payment networks", () => {
    const markdown = agentPaySkillMarkdown("https://agentpay.example");

    expect(markdown).toContain("CSPR.trade");
    expect(markdown).toContain("CSPR.name");
    expect(markdown).toContain("CSPR.cloud");
    expect(markdown).toContain("amountDisplay");
    expect(markdown).toContain("evidenceNetwork");
    expect(markdown).toContain("casper-mainnet");
    expect(markdown).toContain("casper:casper-test");
    expect(markdown).not.toContain("supplyRenounced");
    expect(markdown).not.toContain("Trust Signal");
  });
});
