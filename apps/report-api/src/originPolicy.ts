import type { RequestHandler } from "express";

export function reportApiAllowedOriginsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const values = (env.AGENTPAY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const publicOrigin = env.AGENTPAY_PUBLIC_ORIGIN?.trim() || env.REPORT_API_PUBLIC_URL?.trim();
  if (publicOrigin) values.push(publicOrigin.replace(/\/+$/, ""));
  return [...new Set(values.map(normalizeOrigin))];
}

export function reportApiOriginPolicy(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map(normalizeOrigin));
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
        message: "This browser origin is not allowed to call the AgentPay API."
      });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type,Idempotency-Key,Payment-Signature"
    );
    response.setHeader("Access-Control-Expose-Headers", "Payment-Required,Payment-Response,Retry-After");
    response.setHeader("Access-Control-Max-Age", "600");
    if (request.method === "OPTIONS") {
      response.status(204).send();
      return;
    }
    next();
  };
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("AgentPay allowed origins must be absolute HTTP(S) origins");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new TypeError("AgentPay allowed origins must use HTTPS outside localhost");
  }
  if (url.origin !== value || url.username || url.password) {
    throw new TypeError(
      "AgentPay allowed origins must not include paths, credentials, queries, or fragments"
    );
  }
  return url.origin;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
