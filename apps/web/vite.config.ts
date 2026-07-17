import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const AGENTPAY_LOOPBACK_ENDPOINT =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?=$|[/?#"'`\s),;])/i;
const APP_SOURCE_ROOT = fileURLToPath(new URL("./src/", import.meta.url));

function rejectLoopbackEndpoints(): Plugin {
  return {
    name: "reject-agentpay-loopback-endpoints",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        const containsAppSource =
          output.type === "chunk" && output.moduleIds.some((moduleId) => moduleId.startsWith(APP_SOURCE_ROOT));
        const source = output.type === "chunk" ? output.code : typeof output.source === "string" ? output.source : "";
        if ((containsAppSource || output.type === "asset") && AGENTPAY_LOOPBACK_ENDPOINT.test(source)) {
          this.error(`Production chunk ${output.fileName} contains a loopback AgentPay endpoint`);
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), rejectLoopbackEndpoints()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173)
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@phosphor-icons")) return "icons";
          if (id.includes("motion") || id.includes("framer-motion")) return "motion";
          if (id.includes("@radix-ui")) return "radix";
          return "vendor";
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"]
  }
});
