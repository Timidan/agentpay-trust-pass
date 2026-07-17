import { randomUUID } from "node:crypto";
import {
  artifactHash,
  operatorPolicyHash,
  providerDecisionHash,
  type OperatorPolicy,
  type ProviderDecision
} from "@agent-pay/core";
import type { CasperSigner } from "@agent-pay/client";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type OperatorClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export type ProviderDecisionInput = {
  kind: "pin" | "deny";
  origin: string;
  payee: string;
  asset: string;
  resourcePathPrefix: string | null;
  perCallCeiling: string;
  expiresAt: string;
  promptedByCheckId: string;
};

export type AgentTokenScope =
  | "checks:write"
  | "settlements:write"
  | "observations:write"
  | "receipts:read";

export type AgentTokenPublicRecord = {
  id: string;
  operatorPublicKey: string;
  agentName: string;
  scopes: AgentTokenScope[];
  allowedPayerPublicKeys: string[];
  revision: number;
  actionHash: string;
  signature: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type AgentTokenIssueInput = {
  agentName: string;
  scopes: AgentTokenScope[];
  allowedPayerPublicKeys: string[];
  expiresAt: string | null;
};

export class OperatorClient {
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OperatorClientOptions) {
    const url = new URL(options.baseUrl);
    if (url.username || url.password || url.search || url.hash) {
      throw new TypeError("AgentPay operator API URL must not include credentials, query parameters, or a fragment");
    }
    if (url.protocol !== "https:" && !isLocalHostname(url.hostname)) {
      throw new TypeError("AgentPay operator API URL must use HTTPS outside localhost");
    }
    this.baseUrl = url.toString().replace(/\/+$/, "");
    this.origin = url.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createSession(signer: CasperSigner): Promise<string> {
    const challenge = await this.request<Challenge>("/v1/auth/challenges", {
      method: "POST",
      body: {
        purpose: "session",
        operatorPublicKey: signer.publicKeyHex
      }
    });
    const signature = await signMessage(signer, challenge.message);
    const session = await this.request<{ token: string }>("/v1/auth/sessions", {
      method: "POST",
      body: {
        challengeId: challenge.challengeId,
        operatorPublicKey: signer.publicKeyHex,
        signature
      }
    });
    return session.token;
  }

  async currentPolicy(token: string): Promise<OperatorPolicy | null> {
    try {
      const result = await this.request<{ policy: OperatorPolicy | null }>("/v1/policies/current", {
        method: "GET",
        token
      });
      return result.policy;
    } catch (error) {
      if (error instanceof OperatorApiError && error.status === 404) return null;
      throw error;
    }
  }

  async providerDecisions(token: string): Promise<ProviderDecision[]> {
    const result = await this.request<{ decisions: ProviderDecision[] }>("/v1/provider-decisions", {
      method: "GET",
      token
    });
    return result.decisions;
  }

  async agentTokens(token: string): Promise<AgentTokenPublicRecord[]> {
    return (await this.agentTokenState(token)).records;
  }

  async issueAgentToken(
    input: AgentTokenIssueInput,
    signer: CasperSigner,
    token: string
  ): Promise<{ token: string; record: AgentTokenPublicRecord }> {
    const revision = (await this.agentTokenState(token)).nextRevision;
    const spec = {
      operatorPublicKey: signer.publicKeyHex,
      revision,
      agentName: input.agentName,
      scopes: input.scopes,
      allowedPayerPublicKeys: input.allowedPayerPublicKeys,
      expiresAt: input.expiresAt
    };
    const actionHash = artifactHash({ kind: "agent_token_issue", ...spec });
    const signed = await this.signAction("agent_token_issue", revision, actionHash, signer, token);
    return this.request<{ token: string; record: AgentTokenPublicRecord }>("/v1/agent-tokens", {
      method: "POST",
      token,
      body: {
        challengeId: signed.challengeId,
        spec,
        signature: signed.signature
      }
    });
  }

  async revokeAgentToken(
    tokenId: string,
    signer: CasperSigner,
    token: string
  ): Promise<void> {
    const revision = (await this.agentTokenState(token)).nextRevision;
    const actionHash = artifactHash({
      kind: "agent_token_revoke",
      operatorPublicKey: signer.publicKeyHex,
      tokenId,
      revision
    });
    const signed = await this.signAction("agent_token_revoke", revision, actionHash, signer, token);
    await this.request<void>(`/v1/agent-tokens/${encodeURIComponent(tokenId)}`, {
      method: "DELETE",
      token,
      body: {
        challengeId: signed.challengeId,
        revision,
        signature: signed.signature
      }
    });
  }

  async installPolicy(input: Record<string, unknown>, signer: CasperSigner, token: string): Promise<OperatorPolicy> {
    const current = await this.currentPolicy(token);
    const revision = (current?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    const unsigned = {
      policyId: stringValue(input.policyId) ?? randomUUID(),
      operatorPublicKey: signer.publicKeyHex,
      revision,
      issuedAt: stringValue(input.issuedAt) ?? now,
      effectiveAt: stringValue(input.effectiveAt) ?? now,
      allowedNetworks: input.allowedNetworks ?? ["casper:casper-test"],
      allowedPayerPublicKeys: input.allowedPayerPublicKeys ?? [signer.publicKeyHex],
      assetDailyCaps: input.assetDailyCaps ?? {},
      maximumAuthorizationWindowSeconds: input.maximumAuthorizationWindowSeconds ?? 300,
      maximumConcurrentReservations: input.maximumConcurrentReservations ?? 20,
      deniedOrigins: input.deniedOrigins ?? [],
      deniedPayees: input.deniedPayees ?? [],
      deniedAssets: input.deniedAssets ?? [],
      evidenceMaxAgeSeconds: input.evidenceMaxAgeSeconds ?? 300,
      reviewOnInvestmentAdvisories: input.reviewOnInvestmentAdvisories ?? true,
      allowPinnedResourceSchemeMismatch: input.allowPinnedResourceSchemeMismatch ?? false,
      signatureMessage: "",
      signature: "",
      policyHash: ""
    } as OperatorPolicy;
    const policyHash = operatorPolicyHash(unsigned);
    const signed = await this.signAction("policy_revision", revision, policyHash, signer, token);
    const policy: OperatorPolicy = {
      ...unsigned,
      policyHash,
      signatureMessage: signed.message,
      signature: signed.signature
    };
    const result = await this.request<{ policy: OperatorPolicy }>("/v1/policies/revisions", {
      method: "POST",
      token,
      body: { challengeId: signed.challengeId, policy }
    });
    return result.policy;
  }

  async installProviderDecision(
    input: ProviderDecisionInput,
    signer: CasperSigner,
    token: string
  ): Promise<ProviderDecision> {
    const decisions = await this.providerDecisions(token);
    const revision = decisions.reduce((maximum, decision) => Math.max(maximum, decision.revision), 0) + 1;
    const unsigned: ProviderDecision = {
      decisionId: randomUUID(),
      kind: input.kind,
      operatorPublicKey: signer.publicKeyHex,
      revision,
      origin: new URL(input.origin).origin,
      payee: input.payee.toLowerCase(),
      asset: input.asset.toLowerCase().replace(/^hash-/, ""),
      network: "casper:casper-test",
      resourcePathPrefix: input.resourcePathPrefix,
      perCallCeiling: input.perCallCeiling,
      expiresAt: input.expiresAt,
      promptedByCheckId: input.promptedByCheckId,
      signatureMessage: "",
      signature: "",
      decisionHash: ""
    };
    const decisionHash = providerDecisionHash(unsigned);
    const signed = await this.signAction("provider_decision", revision, decisionHash, signer, token);
    const decision: ProviderDecision = {
      ...unsigned,
      decisionHash,
      signatureMessage: signed.message,
      signature: signed.signature
    };
    const result = await this.request<{ decision: ProviderDecision }>("/v1/provider-decisions", {
      method: "POST",
      token,
      body: { challengeId: signed.challengeId, decision }
    });
    return result.decision;
  }

  private async signAction(
    kind: "policy_revision" | "provider_decision" | "agent_token_issue" | "agent_token_revoke",
    revision: number,
    artifactHash: string,
    signer: CasperSigner,
    token: string
  ): Promise<{ challengeId: string; message: string; signature: string }> {
    const challenge = await this.request<Challenge>("/v1/auth/challenges", {
      method: "POST",
      token,
      body: {
        purpose: "operator_action",
        operatorPublicKey: signer.publicKeyHex,
        action: { kind, artifactHash, revision }
      }
    });
    return {
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature: await signMessage(signer, challenge.message)
    };
  }

  private agentTokenState(token: string): Promise<{ records: AgentTokenPublicRecord[]; nextRevision: number }> {
    return this.request("/v1/agent-tokens", { method: "GET", token });
  }

  private async request<T>(
    path: string,
    input: { method: "GET" | "POST" | "DELETE"; token?: string; body?: unknown }
  ): Promise<T> {
    const headers = new Headers({ origin: this.origin });
    if (input.token) headers.set("authorization", `Bearer ${input.token}`);
    if (input.body !== undefined) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new OperatorApiError("AgentPay operator API request failed", 0, true);
    }
    const text = await readBoundedText(response);
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new OperatorApiError("AgentPay operator API returned malformed JSON", response.status, false);
      }
    }
    if (!response.ok) {
      const record = asRecord(body);
      throw new OperatorApiError(
        typeof record?.message === "string" ? record.message : "AgentPay operator API rejected the request",
        response.status,
        record?.retryable === true
      );
    }
    return body as T;
  }
}

export class OperatorApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = "OperatorApiError";
  }
}

type Challenge = { challengeId: string; message: string };

async function signMessage(signer: CasperSigner, message: string): Promise<string> {
  const bytes = new TextEncoder().encode(`Casper Message:\n${message}`);
  const signature = await signer.sign(bytes);
  return Buffer.from(signature).toString("hex");
}

async function readBoundedText(response: Response): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && /^[0-9]+$/.test(length) && BigInt(length) > BigInt(MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new OperatorApiError("AgentPay operator API response was too large", response.status, false);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new OperatorApiError("AgentPay operator API response was too large", response.status, false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
