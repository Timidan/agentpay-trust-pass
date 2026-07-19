import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..", ".publish");
const workspace = await mkdtemp(join(tmpdir(), "agentpay-cli-package-"));
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
  if (!filename) throw new Error("npm pack did not return an AgentPay CLI archive");

  await execFileAsync(
    "npm",
    [
      "install",
      "--prefix",
      installDirectory,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(packDirectory, filename)
    ],
    { env: npmEnv, maxBuffer: 1024 * 1024 }
  );

  const installedRoot = join(installDirectory, "node_modules", "@timidan", "agentpay-cli");
  const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
  };
  if (
    manifest.name !== "@timidan/agentpay-cli" ||
    manifest.version !== "0.1.1" ||
    manifest.bin?.agentpay !== "./main.js"
  ) {
    throw new Error("Installed CLI package metadata is not ready for version 0.1.1");
  }

  const readme = await readFile(join(installedRoot, "README.md"), "utf8");
  if (!readme.includes("agentpay check --file ./charge.json --json")) {
    throw new Error("Installed CLI package is missing the documented payment check");
  }

  const entrypoint = join(installedRoot, "main.js");
  const help = await execFileAsync(process.execPath, [entrypoint, "--help", "--json"], {
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 1024 * 1024
  });
  const output = help.stdout.trim()
    ? JSON.parse(help.stdout) as { usage?: string }
    : { usage: await readFile(entrypoint, "utf8") };
  if (!output.usage?.includes("agentpay check --file <input.json>")) {
    throw new Error("Installed CLI package did not return the expected help output");
  }

  process.stdout.write(JSON.stringify({
    package: `${manifest.name}@${manifest.version}`,
    executable: "agentpay",
    readme: "bundled"
  }) + "\n");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
