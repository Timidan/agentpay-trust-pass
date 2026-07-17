import { createHash, timingSafeEqual } from "node:crypto";
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
import type { RegistryStatus, RegistryStatusCheck } from "./casperClient.js";
import { ToolConfigError, ToolInputError } from "./errors.js";
import {
  bridgeAccessOptionsFromEnv,
  PublicAssessmentLimiter,
  validateBridgeAccessOptions,
  type BridgeAccessOptions
} from "./publicAccess.js";

const PRIVILEGED_TOOLS = new Set([
  "assess_account",
  "assess_subject",
  "buy_report",
  "check_x402_payment",
  "get_payment_receipt",
  "quote_report",
  "record_decision",
  "verify_x402_settlement"
]);

const PUBLIC_ASSESSMENT_TOOLS = new Set(["assess_account", "assess_subject"]);
const PUBLIC_STATUS_TOOLS = new Set(["payment_status", "registry_status"]);

export type McpBridgeAppOptions = {
} & BridgeAccessOptions;

export function createMcpBridgeApp(options: McpBridgeAppOptions = mcpBridgeAppOptionsFromEnv()): Express {
  validateBridgeAccessOptions(options);
  const app = express();
  const publicAssessmentLimiter = options.publicAssessments
    ? new PublicAssessmentLimiter(options.publicAssessments)
    : null;
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use(originPolicy(options.allowedOrigins ?? []));
  app.use("/tools/:tool", toolAuthorization(options, publicAssessmentLimiter));
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
      response.json(publicRegistryStatus(await registryStatusTool()));
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
      response.status(error.status >= 400 && error.status <= 599 ? error.status : 502).json(error.body);
      return;
    }
    if (error instanceof ToolInputError) {
      response.status(400).json({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof ToolConfigError) {
      response.status(503).json({ error: "configuration_required", message: error.publicMessage });
      return;
    }
    const status = errorHttpStatus(error);
    if (status === 413) {
      response.status(status).json({
        error: "request_too_large",
        message: "Request body exceeds the supported limit."
      });
      return;
    }
    if (status >= 400 && status < 500) {
      response.status(status).json({ error: "invalid_request", message: "Request could not be processed." });
      return;
    }
    console.error("MCP bridge request failed", error instanceof Error ? error.name : "UnknownError");
    response.status(status).json({
      error: "tool_error",
      message: "AgentPay could not complete the tool request."
    });
  });

  return app;
}

function publicRegistryStatus(status: RegistryStatus) {
  const publicStatus = status.status === "rpc_unavailable"
    ? "rpc_unavailable"
    : status.status === "ready" && status.receiptAnchors.status === "ready"
      ? "ready"
      : "configuration_required";
  const checks: RegistryStatusCheck[] = [
    {
      name: "decision_registry",
      status: status.status === "ready"
        ? "pass"
        : status.status === "rpc_unavailable"
          ? "fail"
          : "missing",
      message: status.status === "ready"
        ? "Decision registry ready"
        : "Decision registry needs setup"
    },
    {
      name: "receipt_recording",
      status: status.receiptAnchors.status === "ready" ? "pass" : "missing",
      message: status.receiptAnchors.status === "ready"
        ? "Receipt recording ready"
        : "Receipt recording needs setup"
    }
  ];
  if (status.rpc) {
    checks.push({
      name: "casper_network",
      status: "pass",
      message: status.rpc.chainspecName ?? "Casper RPC reachable"
    });
  }

  return {
    status: publicStatus,
    reason: publicStatus === "ready"
      ? null
      : publicStatus === "rpc_unavailable"
        ? "casper_rpc_status_check_failed"
        : status.status === "ready"
          ? "receipt_recording_configuration_required"
          : "agent_pay_registry_configuration_required",
    checkedAt: status.checkedAt,
    checks,
    registryPackageHash: status.registryPackageHash,
    rpc: status.rpc
      ? {
          apiVersion: status.rpc.apiVersion,
          chainspecName: status.rpc.chainspecName,
          latestBlockHeight: status.rpc.latestBlockHeight,
          latestBlockHash: status.rpc.latestBlockHash
        }
      : null,
    receiptAnchors: {
      status: status.receiptAnchors.status,
      reason: status.receiptAnchors.status === "ready"
        ? null
        : "receipt_recording_configuration_required",
      contractHash: status.receiptAnchors.contractHash
    }
  };
}

export function mcpBridgeAppOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): McpBridgeAppOptions {
  return bridgeAccessOptionsFromEnv(env);
}

function toolAuthorization(
  options: McpBridgeAppOptions,
  publicAssessmentLimiter: PublicAssessmentLimiter | null
): express.RequestHandler {
  return (request, response, next) => {
    if (request.method === "OPTIONS") {
      next();
      return;
    }
    const tool = request.baseUrl.split("/").pop() ?? "";
    const authorization = request.header("authorization");
    const match = authorization ? /^Bearer (\S+)$/.exec(authorization) : null;
    if (authorization) {
      if (!options.authToken || !match || !constantTimeEqual(match[1], options.authToken)) {
        writeAuthenticationRequired(response);
        return;
      }
      next();
      return;
    }
    if (PUBLIC_STATUS_TOOLS.has(tool)) {
      next();
      return;
    }
    if (PUBLIC_ASSESSMENT_TOOLS.has(tool) && publicAssessmentLimiter) {
      const origin = request.header("origin");
      if (!origin || !(options.allowedOrigins ?? []).includes(origin)) {
        response.status(403).json({
          error: "public_origin_required",
          message: "Public assessments are available only from an allowed AgentPay browser origin."
        });
        return;
      }
      const client = request.ip || request.socket.remoteAddress || "unknown";
      const limit = publicAssessmentLimiter.consume(client);
      if (!limit.allowed) {
        response.setHeader("Retry-After", limit.retryAfterSeconds.toString());
        response.status(429).json({
          error:
            limit.reason === "daily_limit"
              ? "public_assessment_daily_limit"
              : "public_assessment_rate_limited",
          message:
            limit.reason === "daily_limit"
              ? "The public Casper testnet assessment budget is exhausted for today."
              : "Too many public assessments from this client.",
          retryAfterSeconds: limit.retryAfterSeconds
        });
        return;
      }
      response.setHeader("X-RateLimit-Remaining", limit.remaining.toString());
      next();
      return;
    }
    if (options.authToken) {
      writeAuthenticationRequired(response);
      return;
    }
    if (
      options.allowUnauthenticatedPrivilegedTools === true ||
      isDirectLoopbackRequest(request)
    ) {
      next();
      return;
    }
    if (!PRIVILEGED_TOOLS.has(tool)) {
      next();
      return;
    }
    response.status(503).json({
      error: "privileged_tools_disabled",
      message: "Privileged HTTP tools require MCP_SERVER_AUTH_TOKEN"
    });
  };
}

function isDirectLoopbackRequest(request: express.Request): boolean {
  if (
    request.headers["x-forwarded-for"] !== undefined ||
    request.headers.forwarded !== undefined
  ) {
    return false;
  }
  return isLoopbackAddress(request.socket.remoteAddress ?? request.ip);
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (address === "::1") return true;
  const ipv4 = address.toLowerCase().startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  const octets = ipv4.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

function writeAuthenticationRequired(response: express.Response): void {
  response.setHeader("WWW-Authenticate", 'Bearer realm="agentpay-mcp"');
  response.status(401).json({
    error: "bridge_auth_required",
    message: "A valid MCP bridge bearer token is required"
  });
}

function originPolicy(allowedOrigins: string[]): express.RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.header("origin");
    if (!origin) {
      if (request.method === "OPTIONS") {
        response.status(204).send();
        return;
      }
      next();
      return;
    }
    if (!allowed.has(origin)) {
      response.status(403).json({
        error: "origin_not_allowed",
        message: "This browser origin is not allowed to call the AgentPay bridge."
      });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type,Idempotency-Key"
    );
    response.setHeader("Access-Control-Max-Age", "600");
    if (request.method === "OPTIONS") {
      response.status(204).send();
      return;
    }
    next();
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function errorHttpStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 500;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 500;
}
