function endpoint(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  if (candidate.startsWith("/")) {
    return candidate.replace(/\/+$/, "") || "/";
  }

  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("AgentPay browser endpoints must use HTTP or HTTPS");
  }
  if (url.protocol !== "https:" && !isLocalHostname(url.hostname)) {
    throw new TypeError("AgentPay browser endpoints must use HTTPS outside local development");
  }
  return candidate.replace(/\/+$/, "");
}

export const reportApiBase = endpoint(import.meta.env.VITE_REPORT_API_URL, "/api");
export const bridgeApiBase = endpoint(import.meta.env.VITE_MCP_SERVER_URL, "/bridge");
export const agentPayServiceBase = endpoint(
  import.meta.env.VITE_AGENTPAY_SERVICE_URL,
  reportApiBase
);

export function publicEndpoint(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window === "undefined" || !window.location.origin || window.location.origin === "null") {
    return value;
  }
  return new URL(value, window.location.origin).toString().replace(/\/$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
