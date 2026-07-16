import cors from "cors";
import express, { type Express } from "express";
import {
  assessAccountTool,
  assessSubjectTool,
  buyReportTool,
  checkX402PaymentTool,
  getPaymentReceiptTool,
  paymentStatusTool,
  quoteReportTool,
  recordDecisionTool,
  registryStatusTool,
  toolDefinitions,
  verifyX402SettlementTool,
  verifyReportTool
} from "./tools.js";
import { AgentPayApiError } from "@agent-pay/client";
import { ApiResponseError } from "./apiClient.js";
import { listBridgeActivity, recordBridgeActivity } from "./activity.js";
import { ToolConfigError, ToolInputError } from "./errors.js";

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

  // Live feed of real agent traffic over this bridge (newest first).
  app.get("/activity", (_request, response) => {
    response.json({ entries: listBridgeActivity() });
  });

  app.use("/tools/:tool", (request, response, next) => {
    const startedAt = Date.now();
    // Express 5 strips params on use() mounts; the tool name is the last
    // segment of the mount path.
    const tool = request.baseUrl.split("/").pop() ?? "unknown";
    response.on("finish", () => {
      recordBridgeActivity({
        tool,
        status: response.statusCode,
        ms: Date.now() - startedAt,
        at: new Date().toISOString()
      });
    });
    next();
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

  app.post("/tools/check_x402_payment", async (request, response, next) => {
    try {
      response.json(await checkX402PaymentTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/verify_x402_settlement", async (request, response, next) => {
    try {
      response.json(await verifyX402SettlementTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/get_payment_receipt", async (request, response, next) => {
    try {
      response.json(await getPaymentReceiptTool(request.body));
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

  app.post("/tools/assess_account", async (request, response, next) => {
    try {
      response.json(await assessAccountTool(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof AgentPayApiError) {
      response.status(error.status >= 400 && error.status <= 599 ? error.status : 502).json(
        error.body ?? { error: "payment_audit_unavailable", message: error.message, retryable: error.retryable }
      );
      return;
    }
    if (error instanceof ApiResponseError) {
      response.status(error.status).json(error.body);
      return;
    }
    if (error instanceof ToolInputError) {
      response.status(400).json({ error: "invalid_input", message: error.message });
      return;
    }
    if (error instanceof ToolConfigError) {
      response.status(503).json({ error: "configuration_required", message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown MCP bridge error";
    response.status(500).json({ error: "tool_error", message });
  });

  return app;
}
