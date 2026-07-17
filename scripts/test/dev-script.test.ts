import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");

describe("development launcher", () => {
  it("is valid shell and keeps browser login origin separate from API payment URLs", async () => {
    await execFileAsync("bash", ["-n", "scripts/dev.sh"], { cwd: repoRoot });

    const source = await readFile(resolve(repoRoot, "scripts/dev.sh"), "utf8");
    const environmentExample = await readFile(resolve(repoRoot, ".env.example"), "utf8");
    expect(source).toContain(
      'VITE_REPORT_API_URL="${VITE_REPORT_API_URL:-$REPORT_API_URL}"'
    );
    expect(source).toContain(
      'VITE_MCP_SERVER_URL="${VITE_MCP_SERVER_URL:-$MCP_SERVER_URL}"'
    );
    expect(source).toContain(
      'VITE_AGENTPAY_SERVICE_URL="${VITE_AGENTPAY_SERVICE_URL:-$REPORT_API_URL}"'
    );
    expect(source).toContain(
      'AGENTPAY_PUBLIC_ORIGIN="$WEB_PUBLIC_ORIGIN"'
    );
    expect(source).toContain(
      'AGENT_PAY_RESOURCE_BASE_URL="${AGENT_PAY_RESOURCE_BASE_URL:-$REPORT_API_URL}"'
    );
    expect(source).toContain(
      'WEB_PUBLIC_ORIGIN="${AGENTPAY_PUBLIC_ORIGIN:-http://127.0.0.1:${WEB_PORT}}"'
    );
    expect(source).not.toContain(
      'REPORT_API_PUBLIC_ORIGIN="${AGENTPAY_PUBLIC_ORIGIN:-http://127.0.0.1:${REPORT_API_PORT}}"'
    );
    expect(environmentExample).toContain("AGENTPAY_PUBLIC_ORIGIN=http://127.0.0.1:5173");
    expect(environmentExample).toContain("REPORT_API_URL=http://127.0.0.1:4021");
    expect(environmentExample).not.toContain("REPORT_API_URL=http://localhost:4021");
  });
});
