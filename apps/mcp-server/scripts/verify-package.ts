import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..", ".publish");
const packageManifest = join(packageRoot, "package.json");
const expectedTools = [
  "assess_account",
  "assess_subject",
  "buy_report",
  "check_x402_payment",
  "get_payment_receipt",
  "payment_status",
  "quote_report",
  "record_decision",
  "registry_status",
  "verify_report",
  "verify_x402_settlement"
];

await access(packageManifest);
const workspace = await mkdtemp(join(tmpdir(), "agentpay-mcp-package-"));
const npmEnv = { ...process.env, NPM_CONFIG_CACHE: join(workspace, "npm-cache") };

try {
  const packDirectory = join(workspace, "pack");
  const installDirectory = join(workspace, "install");
  await mkdir(packDirectory, { recursive: true });
  await mkdir(installDirectory, { recursive: true });

  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", packDirectory],
    { cwd: packageRoot, env: npmEnv, maxBuffer: 1024 * 1024 }
  );
  const packed = stdout.trim() ? JSON.parse(stdout) as Array<{ filename?: string }> : [];
  const filename = packed[0]?.filename ?? (await readdir(packDirectory)).find((entry) => entry.endsWith(".tgz"));
  if (!filename) throw new Error("npm pack did not return an AgentPay MCP archive");
  const tarball = join(packDirectory, filename);

  await execFileAsync(
    "npm",
    [
      "install",
      "--prefix",
      installDirectory,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball
    ],
    { env: npmEnv, maxBuffer: 1024 * 1024 }
  );

  const installedManifestPath = join(
    installDirectory,
    "node_modules",
    "@timidan",
    "agentpay-mcp",
    "package.json"
  );
  const installedManifest = JSON.parse(await readFile(installedManifestPath, "utf8")) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
  };
  if (installedManifest.name !== "@timidan/agentpay-mcp") {
    throw new Error("Installed MCP package has the wrong name");
  }
  if (!installedManifest.version || installedManifest.bin?.["agentpay-mcp"] !== "main.js") {
    throw new Error("Installed MCP package is missing its version or executable");
  }

  const entrypoint = join(
    installDirectory,
    "node_modules",
    "@timidan",
    "agentpay-mcp",
    "main.js"
  );
  const client = new Client({ name: "agentpay-package-verifier", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    env: {
      HOME: process.env.HOME ?? workspace,
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production"
    },
    stderr: "pipe"
  });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const actualTools = tools.tools.map((tool) => tool.name).sort();
    if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
      throw new Error(`Installed MCP tool list differs: ${actualTools.join(", ")}`);
    }

    const resource = await client.readResource({ uri: "skill://agentpay" });
    const text = resource.contents
      .map((content) => ("text" in content ? content.text : ""))
      .join("\n");
    if (!text.includes("https://agentpay.timidan.xyz/api/skill.md")) {
      throw new Error("Installed MCP skill does not point to the hosted AgentPay API");
    }
    if (text.includes("127.0.0.1") || text.includes("localhost")) {
      throw new Error("Installed MCP skill exposes a loopback URL");
    }
  } finally {
    await client.close();
  }

  process.stdout.write(
    JSON.stringify({
      package: `${installedManifest.name}@${installedManifest.version}`,
      tools: expectedTools.length,
      skill: "bundled",
      defaultApi: "https://agentpay.timidan.xyz/api"
    }) + "\n"
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
