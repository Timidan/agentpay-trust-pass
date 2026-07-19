import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readTranscript(): Promise<string> {
  return readFile(`${root}/docs/live-demo-transcript.md`, "utf8");
}

function spokenWords(markdown: string): string[] {
  const mainCut = markdown.split("## Recovery line", 1)[0];

  return mainCut
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .join(" ")
    .replace(/^>\s*/gm, "")
    .match(/[\w.]+(?:['-][\w.]+)*/g) ?? [];
}

describe("final-round demo transcript", () => {
  it("leaves enough room for screen actions inside two minutes", async () => {
    const words = spokenWords(await readTranscript());

    // 215 words takes about 1:39 at 130 wpm, leaving 21 seconds for cuts.
    expect(words.length).toBeLessThanOrEqual(215);
  });

  it("visibly covers every product capability family", async () => {
    const transcript = await readTranscript();

    for (const required of [
      "official Testnet WCSPR check",
      "Shared results",
      "completed public account check",
      "PAY, REVIEW, or BLOCK",
      "CSPR.cloud",
      "MATCH",
      "service response",
      "Casper record",
      "Merkle proof",
      "Tamper one fact",
      "npm MCP server",
      "agentpay receipt verify",
      "HTTP bridge",
      "Private keys stayed local"
    ]) {
      expect(transcript).toContain(required);
    }
  });

  it("labels prepared settlement evidence honestly", async () => {
    const transcript = await readTranscript();

    expect(transcript).toContain("Label every earlier result **Completed Testnet run**");
    expect(transcript).toContain("In this completed Testnet run");
    expect(transcript).not.toContain("Now the wallet signs");
  });

  it("links to reproducible terminal commands", async () => {
    const [transcript, guide, rootManifestText, mcpManifestText, helper] = await Promise.all([
      readTranscript(),
      readFile(`${root}/docs/live-demo.md`, "utf8"),
      readFile(`${root}/package.json`, "utf8"),
      readFile(`${root}/apps/mcp-server/package.json`, "utf8"),
      readFile(`${root}/apps/mcp-server/scripts/demo-public-package.mjs`, "utf8")
    ]);
    const rootManifest = JSON.parse(rootManifestText) as { scripts?: Record<string, string> };
    const mcpManifest = JSON.parse(mcpManifestText) as { scripts?: Record<string, string> };

    expect(transcript).toContain("live-demo.md#prepare-the-terminal-clip");
    expect(guide).toContain("pnpm demo:mcp");
    expect(guide).toContain("npm install --global @timidan/agentpay-cli");
    expect(guide).toContain(
      "agentpay receipt verify --file ~/Downloads/agentpay-<receipt-id>.json --json"
    );
    expect(guide).toContain("click **Download receipt**");
    expect(rootManifest.scripts?.["demo:mcp"]).toBe(
      "pnpm --filter @agent-pay/mcp-server demo:public"
    );
    expect(mcpManifest.scripts?.["demo:public"]).toBe(
      "node scripts/demo-public-package.mjs"
    );
    expect(helper).toContain("@timidan/agentpay-mcp");
    expect(helper).toContain("quote_report");
    expect(helper).toContain(
      "hash-3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e"
    );
  });
});
