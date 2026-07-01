import cors from "cors";
import express, { type Express } from "express";
import {
  assessSubjectTool,
  buyReportTool,
  paymentStatusTool,
  quoteReportTool,
  recordDecisionTool,
  registryStatusTool,
  toolDefinitions,
  verifyReportTool
} from "./tools.js";
import { ApiResponseError } from "./apiClient.js";

export function createMcpBridgeApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "mcp-server" });
  });

  app.get("/tools", (_request, response) => {
    response.json({ tools: toolDefinitions });
  });

  app.post("/tools/quote_report", async (request, response, next) => {
    try {
      response.json(await quoteReportTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/payment_status", async (request, response, next) => {
    try {
      response.json(await paymentStatusTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/registry_status", async (_request, response, next) => {
    try {
      response.json(await registryStatusTool());
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/buy_report", async (request, response, next) => {
    try {
      response.json(await buyReportTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/verify_report", async (request, response, next) => {
    try {
      response.json(await verifyReportTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/record_decision", async (request, response, next) => {
    try {
      response.json(await recordDecisionTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/assess_subject", async (request, response, next) => {
    try {
      response.json(await assessSubjectTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof ApiResponseError) {
      response.status(error.status).json(error.body);
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown MCP bridge error";
    response.status(500).json({ error: "tool_error", message });
  });

  return app;
}
