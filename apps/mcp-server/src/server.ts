import { createMcpBridgeApp } from "./app.js";

const port = Number(process.env.MCP_SERVER_PORT ?? 3001);
const host = process.env.MCP_SERVER_HOST ?? "127.0.0.1";
const app = createMcpBridgeApp();

app.listen(port, host, () => {
  console.log(`mcp-server bridge listening on http://${host}:${port}`);
});
