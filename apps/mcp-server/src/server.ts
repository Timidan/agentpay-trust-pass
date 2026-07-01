import { createMcpBridgeApp } from "./app.js";

const port = Number(process.env.MCP_SERVER_PORT ?? 3001);
const app = createMcpBridgeApp();

app.listen(port, () => {
  console.log(`mcp-server bridge listening on http://127.0.0.1:${port}`);
});
