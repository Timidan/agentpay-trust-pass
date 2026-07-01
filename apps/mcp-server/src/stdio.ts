import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentPayMcpServer } from "./mcp.js";

const server = createAgentPayMcpServer();
await server.connect(new StdioServerTransport());
