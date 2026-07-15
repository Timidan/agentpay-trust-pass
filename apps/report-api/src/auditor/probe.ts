import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import {
  decodePaymentRequiredHeader,
  normalizeOriginalRequest,
  normalizePaymentRequired,
  type OriginalRequest,
  type PaymentTerms,
  type Reason
} from "@agent-pay/core";
import { AuthError } from "./auth.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_PAYMENT_HEADER_BYTES = 256 * 1024;
const USER_AGENT = "AgentPay-Probe/1.0";
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "content-type"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type ProbeAddress = {
  address: string;
  family: 4 | 6;
};

export type ProbeTransportInput = {
  url: URL;
  address: ProbeAddress;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: Uint8Array;
  timeoutMs: number;
  maxResponseBytes: number;
};

export type ProbeTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
};

export type ProbeTransport = (input: ProbeTransportInput) => Promise<ProbeTransportResponse>;

export type X402ProbeOptions = {
  allowHttp: boolean;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  now?: () => Date;
  lookup?: (hostname: string) => Promise<ProbeAddress[]>;
  transport?: ProbeTransport;
};

export type ProbeResult = {
  request: OriginalRequest;
  response: {
    status: number;
    contentType: string | null;
    bodyBytes: number;
    bodyHash: string;
    observedAt: string;
  };
  terms: PaymentTerms | null;
  advisories: Reason[];
  redirects: string[];
};

export class X402Probe {
  private readonly allowHttp: boolean;
  private readonly timeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly maxRedirects: number;
  private readonly now: () => Date;
  private readonly lookup: (hostname: string) => Promise<ProbeAddress[]>;
  private readonly transport: ProbeTransport;

  constructor(options: X402ProbeOptions) {
    this.allowHttp = options.allowHttp;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.maxRequestBytes = positiveInteger(
      options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
      "maxRequestBytes"
    );
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes"
    );
    this.maxRedirects = nonNegativeInteger(
      options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      "maxRedirects"
    );
    this.now = options.now ?? (() => new Date());
    this.lookup = options.lookup ?? lookupPublicAddresses;
    this.transport = options.transport ?? requestPinned;
  }

  async probe(value: unknown): Promise<ProbeResult> {
    const parsed = parseProbeInput(value, this.maxRequestBytes);
    let url = parseTargetUrl(parsed.url, this.allowHttp);
    let method = parsed.method;
    let body = parsed.body;
    let headers = parsed.headers;
    const redirects: string[] = [];
    const deadline = performance.now() + this.timeoutMs;

    for (;;) {
      const address = await this.withDeadline(this.resolve(url), deadline);
      const response = await this.withDeadline(
        this.transport({
          url,
          address,
          method,
          headers,
          body,
          timeoutMs: remainingMilliseconds(deadline),
          maxResponseBytes: this.maxResponseBytes
        }),
        deadline
      );
      validateTransportResponse(response, this.maxResponseBytes);
      const responseHeaders = normalizedResponseHeaders(response.headers);

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = responseHeaders.location;
        if (!location) {
          throw new AuthError("probe_redirect_invalid", "Probe redirect omitted Location", 502, {
            retryable: false
          });
        }
        if (redirects.length >= this.maxRedirects) {
          throw new AuthError("probe_redirect_limit", "Probe exceeded the redirect limit", 400, {
            field: "url",
            expected: `no more than ${this.maxRedirects} redirects`,
            received: redirects.length + 1
          });
        }
        let redirected: URL;
        try {
          redirected = new URL(location, url);
        } catch {
          throw new AuthError("probe_redirect_invalid", "Probe redirect Location is invalid", 502);
        }
        url = parseTargetUrl(redirected.toString(), this.allowHttp);
        redirects.push(url.toString());
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = "GET";
          body = new Uint8Array();
          const { "content-type": _contentType, ...remainingHeaders } = headers;
          headers = remainingHeaders;
        }
        continue;
      }

      const observedAt = validNow(this.now());
      const request = normalizeOriginalRequest({
        method,
        url: url.toString(),
        bodyHash: sha256(body),
        bodyBytes: body.byteLength,
        capturedAt: observedAt,
        adapterVersion: "agentpay-probe/1.0"
      });
      const responseMetadata = {
        status: response.status,
        contentType: responseHeaders["content-type"] ?? null,
        bodyBytes: response.body.byteLength,
        bodyHash: sha256(response.body),
        observedAt
      };

      if (response.status !== 402) {
        return { request, response: responseMetadata, terms: null, advisories: [], redirects };
      }
      const encodedPaymentRequired = responseHeaders["payment-required"];
      if (!encodedPaymentRequired || Buffer.byteLength(encodedPaymentRequired, "utf8") > MAX_PAYMENT_HEADER_BYTES) {
        throw invalidPaymentRequired("A 402 response must include one bounded PAYMENT-REQUIRED header");
      }

      let paymentRequired: unknown;
      try {
        paymentRequired = decodePaymentRequiredHeader(encodedPaymentRequired);
      } catch (error) {
        throw invalidPaymentRequired(error instanceof Error ? error.message : "PAYMENT-REQUIRED is malformed");
      }
      const normalized = normalizePaymentRequired(paymentRequired, request);
      if (!normalized.ok) {
        throw new AuthError(
          "invalid_payment_required",
          normalized.reasons.map((reason) => reason.message).join("; "),
          422,
          {
            field: "PAYMENT-REQUIRED",
            expected: "one supported Casper x402 v2 exact acceptance",
            received: normalized.reasons
          }
        );
      }
      return {
        request: normalized.request,
        response: responseMetadata,
        terms: normalized.terms,
        advisories: normalized.advisories,
        redirects
      };
    }
  }

  private async resolve(url: URL): Promise<ProbeAddress> {
    const hostname = unbracketedHostname(url.hostname);
    const literalFamily = isIP(hostname);
    let addresses: ProbeAddress[];
    if (literalFamily === 4 || literalFamily === 6) {
      addresses = [{ address: hostname, family: literalFamily }];
    } else {
      try {
        addresses = await this.lookup(hostname);
      } catch {
        throw new AuthError("probe_dns_failed", "Probe target could not be resolved", 502, {
          retryable: true,
          field: "url",
          expected: "public DNS address",
          received: hostname
        });
      }
    }
    if (addresses.length < 1 || addresses.length > 32) {
      throw new AuthError("probe_dns_failed", "Probe target returned no usable addresses", 502, {
        retryable: true
      });
    }
    for (const address of addresses) {
      if (isIP(address.address) !== address.family || !isPublicAddress(address.address)) {
        throw new AuthError("probe_target_forbidden", "Probe target resolves to a non-public address", 400, {
          field: "url",
          expected: "public internet address",
          received: url.hostname
        });
      }
    }
    return addresses[0];
  }

  private async withDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
    const remaining = remainingMilliseconds(deadline);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new AuthError("probe_timeout", "Probe exceeded its total time limit", 504, { retryable: true }));
      }, remaining);
      timeout.unref?.();
    });
    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

type ParsedProbeInput = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: Uint8Array;
};

function parseProbeInput(value: unknown, maxRequestBytes: number): ParsedProbeInput {
  const input = asRecord(value);
  if (!input) throw invalidProbeInput("body", "object", value);
  const allowedKeys = new Set(["body", "headers", "method", "url"]);
  const unexpected = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) throw invalidProbeInput("body", "url, method, headers, and JSON body only", unexpected);

  if (typeof input.url !== "string" || input.url.length < 1 || input.url.length > 2_048) {
    throw invalidProbeInput("url", "absolute HTTP(S) URL up to 2048 characters", input.url);
  }
  const method = input.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    throw invalidProbeInput("method", ["GET", "POST"], method);
  }
  if (method === "GET" && input.body !== undefined) {
    throw invalidProbeInput("body", "no body for GET probes", input.body);
  }
  const headers = parseRequestHeaders(input.headers);
  let body = new Uint8Array();
  if (input.body !== undefined) {
    let serialized: string;
    try {
      serialized = JSON.stringify(input.body);
    } catch {
      throw invalidProbeInput("body", "JSON-serializable value", input.body);
    }
    if (serialized === undefined) throw invalidProbeInput("body", "JSON-serializable value", input.body);
    body = new TextEncoder().encode(serialized);
    if (body.byteLength > maxRequestBytes) {
      throw new AuthError("probe_request_too_large", "Probe JSON body exceeds the request limit", 413, {
        field: "body",
        expected: `at most ${maxRequestBytes} bytes`,
        received: body.byteLength
      });
    }
    headers["content-type"] ??= "application/json";
  }
  if (headers["content-type"] && !/^application\/json(?:\s*;|$)/i.test(headers["content-type"])) {
    throw invalidProbeInput("headers.content-type", "application/json", headers["content-type"]);
  }
  headers["user-agent"] = USER_AGENT;
  return { url: input.url, method, headers, body };
}

function parseRequestHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const input = asRecord(value);
  if (!input) throw invalidProbeInput("headers", "object", value);
  const output: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (!ALLOWED_REQUEST_HEADERS.has(name)) {
      throw new AuthError("probe_header_forbidden", "Probe header is not allowed", 400, {
        field: `headers.${rawName}`,
        expected: [...ALLOWED_REQUEST_HEADERS],
        received: rawName
      });
    }
    if (name in output) throw invalidProbeInput("headers", "unique case-insensitive header names", rawName);
    if (typeof rawValue !== "string" || rawValue.length > 1_024 || /[\r\n]/.test(rawValue)) {
      throw invalidProbeInput(`headers.${rawName}`, "single-line string up to 1024 characters", rawValue);
    }
    output[name] = rawValue;
  }
  return output;
}

function parseTargetUrl(value: string, allowHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidProbeInput("url", "absolute HTTP(S) URL", value);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw invalidProbeInput("url", "HTTP(S) URL", value);
  }
  if (url.protocol === "http:" && !allowHttp) {
    throw new AuthError("probe_https_required", "Probe targets must use HTTPS", 400, {
      field: "url",
      expected: "https URL",
      received: value
    });
  }
  if (url.username || url.password || url.hash) {
    throw invalidProbeInput("url", "URL without credentials or fragment", value);
  }
  return url;
}

async function lookupPublicAddresses(hostname: string): Promise<ProbeAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses
    .filter((item): item is { address: string; family: 4 | 6 } => item.family === 4 || item.family === 6)
    .map((item) => ({ address: item.address, family: item.family }));
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const ipv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (ipv4Mapped) return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  if ((bytes[0] & 0xe0) !== 0x20) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false;
  return true;
}

function ipv6Bytes(address: string): number[] | null {
  if (address.includes("%") || address.split("::").length > 2) return null;
  let normalized = address.toLowerCase();
  const ipv4Match = /(?:^|:)([0-9]+(?:\.[0-9]+){3})$/.exec(normalized);
  if (ipv4Match) {
    const ipv4 = ipv4Match[1].split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((octet) => octet < 0 || octet > 255)) return null;
    normalized = normalized.slice(0, -ipv4Match[1].length) +
      `${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((rightRaw === undefined && missing !== 0) || missing < 0) return null;
  const groups = rightRaw === undefined ? left : [...left, ...new Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function requestPinned(input: ProbeTransportInput): Promise<ProbeTransportResponse> {
  return new Promise((resolve, reject) => {
    const request = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const lookup: NonNullable<RequestOptions["lookup"]> = (_hostname, _options, callback) => {
      callback(null, input.address.address, input.address.family);
    };
    const options: RequestOptions & { servername: string; autoSelectFamily: boolean } = {
      protocol: input.url.protocol,
      hostname: input.url.hostname,
      port: input.url.port || undefined,
      method: input.method,
      path: `${input.url.pathname}${input.url.search}`,
      headers: input.headers,
      family: input.address.family,
      autoSelectFamily: false,
      lookup,
      servername: unbracketedHostname(input.url.hostname)
    };
    const outgoing = request(options, (incoming) => {
      const contentLength = firstHeader(incoming.headers, "content-length");
      if (contentLength !== null && Number(contentLength) > input.maxResponseBytes) {
        incoming.destroy();
        reject(responseTooLarge(input.maxResponseBytes));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      incoming.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > input.maxResponseBytes) {
          incoming.destroy(responseTooLarge(input.maxResponseBytes));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => {
        const status = incoming.statusCode;
        if (status === undefined) {
          reject(new AuthError("probe_transport_failed", "Probe response omitted its status", 502, { retryable: true }));
          return;
        }
        resolve({
          status,
          headers: selectedHeaders(incoming.headers),
          body: new Uint8Array(Buffer.concat(chunks))
        });
      });
    });
    outgoing.setTimeout(input.timeoutMs, () => {
      outgoing.destroy(new AuthError("probe_timeout", "Probe exceeded its total time limit", 504, { retryable: true }));
    });
    outgoing.on("error", (error) => {
      reject(
        error instanceof AuthError
          ? error
          : new AuthError("probe_transport_failed", "Probe could not reach the target", 502, { retryable: true })
      );
    });
    if (input.body.byteLength > 0) outgoing.write(input.body);
    outgoing.end();
  });
}

function selectedHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of ["content-length", "content-type", "location", "payment-required"]) {
    const value = firstHeader(headers, name);
    if (value !== null) output[name] = value;
  }
  return output;
}

function firstHeader(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function normalizedResponseHeaders(value: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    output[name.toLowerCase()] = headerValue;
  }
  return output;
}

function validateTransportResponse(response: ProbeTransportResponse, maximum: number): void {
  if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new AuthError("probe_transport_failed", "Probe response status is invalid", 502, { retryable: true });
  }
  if (!(response.body instanceof Uint8Array)) {
    throw new AuthError("probe_transport_failed", "Probe response body is invalid", 502, { retryable: true });
  }
  if (response.body.byteLength > maximum) throw responseTooLarge(maximum);
}

function responseTooLarge(maximum: number): AuthError {
  return new AuthError("probe_response_too_large", "Probe response exceeds the body limit", 413, {
    field: "response",
    expected: `at most ${maximum} bytes`,
    received: "larger response"
  });
}

function invalidPaymentRequired(message: string): AuthError {
  return new AuthError("invalid_payment_required", message, 422, {
    field: "PAYMENT-REQUIRED",
    expected: "Base64-encoded x402 v2 JSON",
    received: "malformed or missing header"
  });
}

function invalidProbeInput(field: string, expected: unknown, received: unknown): AuthError {
  return new AuthError("invalid_request", `Probe ${field} is invalid`, 400, { field, expected, received });
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validNow(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Probe clock returned an invalid date");
  }
  return value.toISOString();
}

function unbracketedHostname(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function remainingMilliseconds(deadline: number): number {
  return Math.max(1, Math.ceil(deadline - performance.now()));
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
