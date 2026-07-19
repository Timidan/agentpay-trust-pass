import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function read(path: string): Promise<string> {
  return readFile(`${root}/${path}`, "utf8");
}

describe("public npm package documentation", () => {
  it.each([
    ["apps/mcp-server/.publish/package.json", "@timidan/agentpay-mcp"],
    ["apps/cli/.publish/package.json", "@timidan/agentpay-cli"]
  ])("keeps %s ready for the documented patch release", async (path, name) => {
    const manifest = JSON.parse(await read(path)) as {
      name?: string;
      version?: string;
      engines?: { node?: string };
      homepage?: string;
      repository?: { url?: string };
    };

    expect(manifest).toMatchObject({
      name,
      version: "0.1.1",
      engines: { node: ">=22" },
      homepage: "https://agentpay.timidan.xyz"
    });
    expect(manifest.repository?.url).toContain("Timidan/agentpay-trust-pass");
  });

  it("documents a complete MCP setup without the old under-scoped token", async () => {
    const readme = await read("apps/mcp-server/.publish/README.md");

    expect(readme).toContain("https://www.npmjs.com/package/@timidan/agentpay-mcp");
    expect(readme).toContain('"name": "quote_report"');
    expect(readme).toContain('"subject": "WCSPR"');
    expect(readme).toContain("agentpay agent-token issue");
    expect(readme).toContain("settlements:write");
    expect(readme).toContain("observations:write");
    expect(readme).toContain("receipts:read");
    expect(readme).not.toContain("--scope checks:write");
  });

  it("documents the CLI input, outputs, scopes, and exit codes", async () => {
    const readme = await read("apps/cli/.publish/README.md");

    expect(readme).toContain("https://www.npmjs.com/package/@timidan/agentpay-cli");
    expect(readme).toContain('"paymentRequired"');
    expect(readme).toContain('"authorization": null');
    expect(readme).toContain("AGENT_PAY_API_TOKEN");
    expect(readme).toContain("`checks:write`");
    expect(readme).toContain("| `2` | `REVIEW` or settlement `pending`. |");
    expect(readme).toContain("agentpay call");
  });

  it("advertises only installable packages on the public pages", async () => {
    const [readme, landing] = await Promise.all([
      read("README.md"),
      read("apps/web/src/landing2/data.ts")
    ]);

    expect(readme).toContain("https://www.npmjs.com/package/@timidan/agentpay-mcp");
    expect(readme).toContain("https://www.npmjs.com/package/@timidan/agentpay-cli");
    expect(readme).toContain("It is not a published npm package.");
    expect(landing).toContain("npx --yes @timidan/agentpay-mcp");
    expect(landing).toContain("npm install --global @timidan/agentpay-cli");
    expect(landing).not.toContain('id: "ts"');
    expect(landing).not.toContain('from "@agent-pay/client"');
  });
});
