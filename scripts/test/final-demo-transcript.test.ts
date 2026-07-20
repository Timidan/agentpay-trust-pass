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

    // 205 words takes about 1:35 at 130 wpm, leaving 25 seconds for tab changes.
    expect(words.length).toBeLessThanOrEqual(205);
  });

  it("visibly covers every product capability family", async () => {
    const transcript = await readTranscript();
    const normalized = transcript.replace(/^>\s?/gm, "").replace(/\s+/g, " ");

    for (const required of [
      "one continuous screen recording",
      "My real token input is WCSPR",
      "This result was shared by choice",
      "public Testnet account",
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
      expect(normalized).toContain(required);
    }
  });

  it("labels prepared settlement evidence honestly", async () => {
    const transcript = await readTranscript();

    expect(transcript).toContain("Call an earlier settlement a **completed Testnet run**");
    expect(transcript).toContain("This is a completed Testnet run, not a simulation");
    expect(transcript).toContain("Do not record separate clips");
    expect(transcript).not.toContain("Prepare these six clips");
    expect(transcript).not.toContain("Now the wallet signs");
  });

  it("contains current real inputs and their freshness rule", async () => {
    const transcript = await readTranscript();

    for (const required of [
      "pnpm demo:inputs",
      "https://agentpay.timidan.xyz/api/reports/buy/<fresh-quote-id>",
      "hash-8df5d26790e18cf0404502c62ce5dc9025800ad6975c97466e20506c39c505b6",
      "hash-3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e",
      "account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785",
      "0.00001 WCSPR",
      "casper:casper-test",
      "POST",
      "five minutes",
      "https://agentpay.timidan.xyz/bridge/tools/payment_status"
    ]) {
      expect(transcript).toContain(required);
    }
  });

  it("keeps the inline live-demo narration in sync", async () => {
    const [transcript, guide] = await Promise.all([
      readTranscript(),
      readFile(`${root}/docs/live-demo.md`, "utf8")
    ]);

    expect(spokenWords(guide)).toEqual(spokenWords(transcript));
  });

  it("links to reproducible terminal commands", async () => {
    const [transcript, guide, rootManifestText, mcpManifestText, mcpHelper, inputHelper] = await Promise.all([
      readTranscript(),
      readFile(`${root}/docs/live-demo.md`, "utf8"),
      readFile(`${root}/package.json`, "utf8"),
      readFile(`${root}/apps/mcp-server/package.json`, "utf8"),
      readFile(`${root}/apps/mcp-server/scripts/demo-public-package.mjs`, "utf8"),
      readFile(`${root}/scripts/demo-inputs.ts`, "utf8")
    ]);
    const rootManifest = JSON.parse(rootManifestText) as { scripts?: Record<string, string> };
    const mcpManifest = JSON.parse(mcpManifestText) as { scripts?: Record<string, string> };

    expect(transcript).toContain("pnpm demo:mcp");
    expect(transcript).toContain("agentpay receipt verify --file \"$RECEIPT\" --json");
    expect(guide).toContain("pnpm demo:mcp");
    expect(guide).toContain("npm install --global @timidan/agentpay-cli");
    expect(guide).toContain("agentpay receipt verify --file \"$RECEIPT\" --json");
    expect(guide).toContain("click **Download receipt**");
    expect(rootManifest.scripts?.["demo:inputs"]).toBe(
      "node --import tsx scripts/demo-inputs.ts"
    );
    expect(rootManifest.scripts?.["demo:mcp"]).toBe(
      "pnpm --filter @agent-pay/mcp-server demo:public"
    );
    expect(mcpManifest.scripts?.["demo:public"]).toBe(
      "node scripts/demo-public-package.mjs"
    );
    expect(mcpHelper).toContain("@timidan/agentpay-mcp");
    expect(mcpHelper).toContain("quote_report");
    expect(mcpHelper).toContain(
      "hash-3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e"
    );
    expect(inputHelper).toContain("/api/reports/buy/");
    expect(inputHelper).toContain("fresh x402 quote is already expired");
  });
});
