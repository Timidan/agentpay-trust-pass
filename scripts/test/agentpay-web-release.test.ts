import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = resolve(import.meta.dirname, "../../deploy/agentpay/activate-web-release.sh");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("AgentPay web release activation", () => {
  it("switches the current symlink atomically and rejects changed content for the same ID", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "agentpay-web-release-"));
    temporaryDirectories.push(root);
    const build = resolve(root, "build");
    const web = resolve(root, "web");
    await mkdir(resolve(build, "assets"), { recursive: true });
    await writeFile(resolve(build, "index.html"), "<script src=/assets/index-test.js></script>\n");
    await writeFile(resolve(build, "assets/index-test.js"), "console.log('release');\n");

    const env = {
      ...process.env,
      AGENTPAY_WEB_BUILD_DIR: build,
      AGENTPAY_WEB_ROOT: web,
      AGENTPAY_SKIP_NGINX_RELOAD: "1"
    };
    await execFileAsync("bash", [script, "abc1234"], { env });

    expect(await readlink(resolve(web, "current"))).toBe("releases/abc1234");
    expect(await readFile(resolve(web, "current/index.html"), "utf8"))
      .toContain("index-test.js");

    await execFileAsync("bash", [script, "abc1234"], { env });
    await writeFile(resolve(build, "index.html"), "changed\n");
    await expect(execFileAsync("bash", [script, "abc1234"], { env }))
      .rejects.toMatchObject({ code: 1 });
    expect(await readFile(resolve(web, "current/index.html"), "utf8"))
      .toContain("index-test.js");
  });
});
