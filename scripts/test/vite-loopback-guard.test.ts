import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../apps/web/vite.config";

describe("production loopback guard", () => {
  it("rejects a complete loopback endpoint embedded in an application chunk", () => {
    const plugins = Array.isArray(config.plugins) ? config.plugins.flat(Infinity) : [];
    const plugin = plugins.find(
      (candidate) => candidate && typeof candidate === "object" && candidate.name === "reject-agentpay-loopback-endpoints"
    );
    if (!plugin || typeof plugin !== "object" || typeof plugin.generateBundle !== "function") {
      throw new Error("reject-agentpay-loopback-endpoints plugin is unavailable");
    }

    const appModule = fileURLToPath(new URL("../../apps/web/src/runtime-origins.ts", import.meta.url));
    const bundle = {
      "assets/index.js": {
        type: "chunk",
        fileName: "assets/index.js",
        moduleIds: [appModule],
        code: 'const api = "http://127.0.0.1:4021";'
      }
    };
    const context = {
      error(message: string) {
        throw new Error(message);
      }
    };

    expect(() => plugin.generateBundle.call(context, {}, bundle, false)).toThrow(
      "Production chunk assets/index.js contains a loopback AgentPay endpoint"
    );
  });
});
