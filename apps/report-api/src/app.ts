import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import type { Router } from "express";
import {
  findReport,
  hashJson,
  parseSubject,
  verifyReportProof,
  type EvidenceRecord,
  type PaymentAssetEvidence,
  type ProofStep,
  type ReportProof,
  type SubjectRef
} from "@agent-pay/core";
import {
  parseVerdictCardSubmission,
  parseVerdictCardData,
  renderVerdictCardSvg,
  renderVerdictCardPng,
  verdictCardId,
  type VerdictCardData
} from "./card.js";
import { resolveTokenBySymbol, type LiveEvidenceDataset } from "./liveEvidence.js";
import { getHeroTokenList } from "./csprCloud.js";
import { normalizeCsprName, resolveCsprName } from "./csprName.js";
import { buildSubjectEvidence } from "./subjectEvidence.js";
import { buildAccountEvidence } from "./accountEvidence.js";
import {
  buildPaymentRequirement,
  buildPaymentRequired,
  buildPaymentResource,
  checkPaymentReadiness,
  decodeX402PaymentHeader,
  encodeX402Header,
  formatTokenAmount,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PaymentConfigurationError,
  PaymentRejectedError,
  settleX402Payment,
  type PaymentReadiness,
  type PaymentRequirement,
  type PaymentResource,
  type SettledPayment
} from "./payment.js";
import { FixedWindowRateLimiter, setBoundedMapEntry } from "./securityLimits.js";
import {
  createMemoryPublicArtifactStore,
  isPublicArtifactId,
  type PublicArtifactStore
} from "./publicArtifacts.js";
import {
  reportApiAllowedOriginsFromEnv,
  reportApiOriginPolicy
} from "./originPolicy.js";
import {
  defaultEvidenceNetwork,
  parseEvidenceNetwork,
  type EvidenceNetwork
} from "./evidenceNetwork.js";
import { NodeRpcClient } from "./auditor/casperRpc.js";
import {
  createDecisionRecordVerifier,
  type DecisionRecordVerifier
} from "./decisionRecord.js";

const DEFAULT_QUOTE_TTL_SECONDS = 300;
const DEFAULT_X402_NETWORK = "casper:casper-test";
const DEFAULT_PAYMENT_RPC_URL = "https://node.testnet.casper.network/rpc";
const PAYMENT_ASSET_CACHE_TTL_MS = 5 * 60 * 1000;
const PAYMENT_ASSET_FAILURE_CACHE_TTL_MS = 10_000;
const PAYMENT_ASSET_RPC_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_QUOTE_REQUESTS_PER_WINDOW = 30;
const DEFAULT_AUTH_REQUESTS_PER_WINDOW = 120;
const DEFAULT_PUBLIC_WRITES_PER_WINDOW = 120;
const DEFAULT_DISCOVERY_REQUESTS_PER_WINDOW = 60;
const DEFAULT_RATE_LIMIT_CLIENTS = 10_000;
const DEFAULT_MAX_ACTIVE_QUOTES = 1_000;
const DEFAULT_MAX_VERDICT_CARDS = 1_000;
const DEFAULT_MAX_FEED_ENTRIES = 500;
const SKILL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "agents",
  "SKILL.md"
);

type QuoteSnapshot = {
  quoteId: string;
  reportId: string;
  reportHash: string;
  evidenceNetwork: EvidenceNetwork;
  dataset: LiveEvidenceDataset;
  expiresAt: number;
  paymentResource: PaymentResource;
  paymentRequirement: PaymentRequirement | null;
  paymentReadiness: PaymentReadiness;
  paymentConfigurationReason: string | null;
  amountAtomic: string;
  displayAmount: string;
  displayAsset: string;
  assetDecimals: number | null;
  settlement: QuoteSettlement | null;
  pendingSettlement: PendingQuoteSettlement | null;
};

type QuoteSettlement = {
  paymentPayloadHash: string;
  paymentResponseHeader: { success: true; transaction: string };
  reportResponse: PaidReportResponse;
};

type PendingQuoteSettlement = {
  paymentPayloadHash: string;
  promise: Promise<QuoteSettlement>;
};

type PaidReportResponse = ReturnType<typeof reportResponse>;

type BuyReportBody = {
  quoteId?: string;
  paymentPayload?: unknown;
};

export type CreateReportAppOptions = {
  auditorRouter?: Router;
  publicArtifactStore?: PublicArtifactStore;
  securityLimits?: Partial<AppSecurityLimits>;
  allowedOrigins?: string[];
  paymentAssetEvidenceLoader?: PaymentAssetEvidenceLoader;
  decisionRecordVerifier?: DecisionRecordVerifier | null;
  tokenEvidenceConfigured?: boolean;
};

export type PaymentAssetEvidenceLoader = (
  requirement: PaymentRequirement
) => Promise<PaymentAssetEvidence>;

export type AppSecurityLimits = {
  windowMs: number;
  quoteRequestsPerWindow: number;
  authRequestsPerWindow: number;
  publicWritesPerWindow: number;
  discoveryRequestsPerWindow: number;
  maxTrackedClients: number;
  maxActiveQuotes: number;
  maxVerdictCards: number;
  maxFeedEntries: number;
};

export function createReportApp(options: CreateReportAppOptions = {}): Express {
  const app = express();
  if (process.env.NODE_ENV === "production" && !configuredPublicApiBaseUrl()) {
    throw new TypeError("AGENT_PAY_RESOURCE_BASE_URL is required in production");
  }
  const limits = resolveSecurityLimits(options.securityLimits);
  const quotes = new Map<string, QuoteSnapshot>();
  const settledTransactionQuotes = new Map<string, string>();
  const publicArtifacts = options.publicArtifactStore ?? createMemoryPublicArtifactStore();
  const allowedOrigins = options.allowedOrigins ?? reportApiAllowedOriginsFromEnv();
  const paymentAssetEvidenceLoader =
    options.paymentAssetEvidenceLoader ?? createCachedPaymentAssetEvidenceLoader();
  const decisionRecordVerifier = options.decisionRecordVerifier === undefined
    ? configuredDecisionRecordVerifier()
    : options.decisionRecordVerifier;
  const tokenEvidenceConfigured = options.tokenEvidenceConfigured ?? true;
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use(reportApiOriginPolicy(allowedOrigins));
  app.use(
    "/reports/quote",
    rateLimitMiddleware(limits.quoteRequestsPerWindow, limits, ["GET"])
  );
  app.use(
    "/v1/auth/challenges",
    rateLimitMiddleware(limits.authRequestsPerWindow, limits, ["POST"])
  );
  app.use(
    "/v1/auth/sessions",
    rateLimitMiddleware(limits.authRequestsPerWindow, limits, ["POST"])
  );
  app.use("/card", rateLimitMiddleware(limits.publicWritesPerWindow, limits, ["POST"]));
  app.use("/feed/share", rateLimitMiddleware(limits.publicWritesPerWindow, limits, ["POST"]));
  app.use(
    "/reports/payment-status",
    rateLimitMiddleware(limits.discoveryRequestsPerWindow, limits, ["GET"])
  );
  app.use(
    "/reports/buy",
    rateLimitMiddleware(limits.publicWritesPerWindow, limits, ["POST"])
  );
  app.use(
    "/reports/verify",
    rateLimitMiddleware(limits.discoveryRequestsPerWindow, limits, ["POST"])
  );
  app.use("/resolve", rateLimitMiddleware(limits.discoveryRequestsPerWindow, limits, ["GET"]));
  app.use("/resolve-account", rateLimitMiddleware(limits.discoveryRequestsPerWindow, limits, ["GET"]));
  app.use("/tokens", rateLimitMiddleware(limits.discoveryRequestsPerWindow, limits, ["GET"]));
  app.use("/card", rateLimitMiddleware(limits.publicWritesPerWindow, limits, ["GET"]));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "report-api",
      checkedAt: new Date().toISOString(),
      tokenEvidence: tokenEvidenceConfigured
        ? {
            status: "complete",
            source: "CSPR.live + Casper RPC",
            available: ["supplyControl", "contractAge", "holderCount", "topHolderShare"],
            unavailable: []
          }
        : {
            status: "limited",
            source: "Casper RPC",
            available: ["supplyControl"],
            unavailable: ["contractAge", "holderCount", "topHolderShare"]
          }
    });
  });

  app.get(["/skill.md", "/skill"], (request, response) => {
    if (!existsSync(SKILL_PATH)) {
      response.status(404).json({ error: "skill_not_found" });
      return;
    }
    response
      .type("text/markdown")
      .set("Cache-Control", "no-cache")
      .send(readAgentPaySkill(requestPublicBaseUrl(request)));
  });

  app.get("/reports/payment-status", async (_request, response, next) => {
    try {
      response.json(publicPaymentReadiness(await currentPaymentReadiness(paymentAssetEvidenceLoader)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/reports/quote", async (request, response, next) => {
    try {
      pruneExpiredQuotes(quotes, settledTransactionQuotes);
      const rawSubject = typeof request.query.subject === "string" ? request.query.subject.trim() : "";
      if (!rawSubject) {
        response.status(400).json({ error: "subject_required" });
        return;
      }
      const parsed = parseSubject(rawSubject);
      if (!parsed.ok) {
        response.status(400).json({ error: "invalid_subject", reason: parsed.error });
        return;
      }
      const requestedNetwork = request.query.network;
      const evidenceNetwork =
        requestedNetwork === undefined
          ? defaultEvidenceNetwork()
          : parseEvidenceNetwork(requestedNetwork);
      if (!evidenceNetwork) {
        response.status(400).json({
          error: "invalid_evidence_network",
          allowed: ["casper-mainnet", "casper-testnet"]
        });
        return;
      }
      const snapshot = await createQuoteSnapshot(
        reportResourceBaseUrl(request),
        parsed.subject,
        evidenceNetwork,
        paymentAssetEvidenceLoader
      );
      const evicted = setBoundedMapEntry(quotes, snapshot.quoteId, snapshot, limits.maxActiveQuotes);
      if (evicted) removeSettlementMapping(settledTransactionQuotes, evicted[0], evicted[1]);
      response.json(quoteResponse(snapshot));
    } catch (error) {
      next(error);
    }
  });

  app.post("/reports/buy/:quoteId", async (request, response, next) => {
    await handleBuyReport(request, response, next, request.params.quoteId);
  });

  app.post("/reports/buy", async (request, response, next) => {
    const body = asObject(request.body) as BuyReportBody | null;
    await handleBuyReport(request, response, next, body?.quoteId);
  });

  async function handleBuyReport(
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
    quoteId: string | undefined
  ) {
    try {
      pruneExpiredQuotes(quotes, settledTransactionQuotes);
      const body = asObject(request.body) as BuyReportBody | null;
      const snapshot = quoteId ? quotes.get(quoteId) : null;

      if (!quoteId || !snapshot) {
        response.status(400).json({ error: "invalid_quote", quoteId: quoteId ?? null });
        return;
      }

      if (Date.now() > snapshot.expiresAt) {
        deleteQuote(quotes, settledTransactionQuotes, quoteId, snapshot);
        response.status(410).json({ error: "quote_expired", quoteId });
        return;
      }

      if (!snapshot.paymentRequirement) {
        writePaymentRequired(response, snapshot, snapshot.paymentConfigurationReason ?? "payment_configuration_required");
        return;
      }

      let paymentPayload: unknown;
      try {
        paymentPayload = readRuntimePaymentPayload(request, body);
      } catch (error) {
        if (error instanceof PaymentRejectedError) {
          writePaymentRequired(response, snapshot, "malformed_payment_signature", error.settlementResponse);
          return;
        }
        throw error;
      }

      if (!paymentPayload) {
        writePaymentRequired(response, snapshot, "PAYMENT-SIGNATURE header is required");
        return;
      }

      const paymentPayloadHash = hashJson(paymentPayload);
      if (snapshot.settlement) {
        if (snapshot.settlement.paymentPayloadHash !== paymentPayloadHash) {
          response.status(409).json({ error: "quote_already_settled", quoteId });
          return;
        }
        writeSettledQuote(response, snapshot.settlement);
        return;
      }

      let pending = snapshot.pendingSettlement;
      if (pending && pending.paymentPayloadHash !== paymentPayloadHash) {
        response.setHeader("Retry-After", "1");
        response.status(409).json({ error: "quote_settlement_in_progress", quoteId });
        return;
      }
      const ownsPending = pending === null;
      if (!pending) {
        pending = {
          paymentPayloadHash,
          promise: completeQuoteSettlement(snapshot, quoteId, paymentPayload, paymentPayloadHash)
        };
        snapshot.pendingSettlement = pending;
      }

      try {
        const settlement = await pending.promise;
        writeSettledQuote(response, settlement);
      } catch (error) {
        if (error instanceof PaymentConfigurationError) {
          writePaymentRequired(response, snapshot, "payment_verifier_unconfigured");
          return;
        }
        if (error instanceof PaymentRejectedError) {
          writePaymentRequired(response, snapshot, "payment_rejected", error.settlementResponse);
          return;
        }
        throw error;
      } finally {
        if (ownsPending && snapshot.pendingSettlement === pending) {
          snapshot.pendingSettlement = null;
        }
      }
    } catch (error) {
      next(error);
    }
  }

  async function completeQuoteSettlement(
    snapshot: QuoteSnapshot,
    quoteId: string,
    paymentPayload: unknown,
    paymentPayloadHash: string
  ): Promise<QuoteSettlement> {
    const payment = await settleX402Payment({
      paymentPayload,
      requirement: snapshot.paymentRequirement!,
      resource: snapshot.paymentResource
    });
    const settledQuoteId = settledTransactionQuotes.get(payment.transactionHash);
    if (settledQuoteId && settledQuoteId !== quoteId) {
      throw new PaymentRejectedError(
        "Settlement transaction has already been used for another AgentPay quote.",
        {
          isValid: false,
          invalidReason: "duplicate_transaction_hash",
          invalidMessage: "Settlement transaction has already been used for another AgentPay quote.",
          transactionHash: payment.transactionHash,
          quoteId: settledQuoteId
        }
      );
    }

    const report = findReport(snapshot.dataset, snapshot.reportId);
    const settlement: QuoteSettlement = {
      paymentPayloadHash,
      paymentResponseHeader: { success: true, transaction: payment.transactionHash },
      reportResponse: reportResponse(snapshot, report, payment)
    };
    snapshot.settlement = settlement;
    setBoundedMapEntry(
      settledTransactionQuotes,
      payment.transactionHash,
      quoteId,
      limits.maxActiveQuotes
    );
    return settlement;
  }

  // ---------------------------------------------------------------- //
  //  Verdict card routes                                              //
  // ---------------------------------------------------------------- //

  app.post("/card", async (request, response) => {
    if (parseVerdictCardData(request.body)) {
      response.status(400).json({ error: "card_proof_required" });
      return;
    }
    const submission = parseVerdictCardSubmission(request.body);
    if (!submission) {
      response.status(400).json({ error: "invalid_card" });
      return;
    }
    if (!decisionRecordVerifier) {
      response.status(503).json({ error: "card_verification_unavailable" });
      return;
    }

    const decision = submission.proof.verdictReport.decision;
    if (
      decision !== "approved" &&
      decision !== "needs_review" &&
      decision !== "rejected"
    ) {
      response.status(400).json({ error: "invalid_card" });
      return;
    }

    let verification;
    try {
      verification = await decisionRecordVerifier({
        hashKind: submission.proof.hashKind,
        transactionHash: submission.card.decisionTxHash,
        datasetId: submission.proof.datasetId,
        datasetRoot: submission.proof.datasetRoot,
        reportHash: submission.proof.reportHash,
        paymentReceiptHash: submission.proof.paymentReceiptHash,
        decision
      });
    } catch {
      response.status(503).json({ error: "card_verification_unavailable" });
      return;
    }
    if (!verification.verified) {
      if (verification.reason === "record_verification_unavailable") {
        response.status(503).json({ error: "card_verification_unavailable" });
        return;
      }
      response.status(422).json({
        error: "card_not_verified",
        reason: verification.reason
      });
      return;
    }

    const id = verdictCardId(submission.card);
    publicArtifacts.saveCard(id, submission.card, limits.maxVerdictCards);
    response.json({ id });
  });

  app.get("/card/:idWithExt", async (request, response, next) => {
    try {
      const raw = request.params.idWithExt;
      const isPng = raw.endsWith(".png");
      const isSvg = raw.endsWith(".svg");
      if (!isPng && !isSvg) {
        response.status(404).json({ error: "not_found" });
        return;
      }
      const id = raw.slice(0, raw.lastIndexOf("."));
      const data = publicArtifacts.getCard(id);
      if (!data) {
        response.status(404).json({ error: "not_found" });
        return;
      }
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      const svg = renderVerdictCardSvg(data);
      if (isSvg) {
        response
          .type("image/svg+xml")
          .set("Content-Security-Policy", "default-src 'none'; sandbox")
          .set("X-Content-Type-Options", "nosniff");
        // All dynamic SVG text is escaped by renderVerdictCardSvg; the route also validates its input.
        response.send(svg); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
        return;
      }
      // PNG
      const pngBuf = await renderVerdictCardPng(svg);
      // PNG files start with magic byte 0x89; if not, it's SVG fallback
      if (pngBuf[0] === 0x89) {
        response.setHeader("content-type", "image/png");
      } else {
        response.setHeader("content-type", "image/svg+xml");
        response.setHeader("content-security-policy", "default-src 'none'; sandbox");
      }
      response.setHeader("x-content-type-options", "nosniff");
      response.send(pngBuf); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------------- //
  //  Feed routes                                                     //
  // ---------------------------------------------------------------- //

  app.post("/feed/share", (request, response) => {
    const body = request.body as { cardId?: string; optIn?: boolean };
    if (body.optIn !== true) {
      response.status(403).json({ error: "share_not_opted_in" });
      return;
    }
    const cardId = body.cardId;
    if (!isPublicArtifactId(cardId)) {
      response.status(400).json({ error: "invalid_card_id" });
      return;
    }
    const shareResult = publicArtifacts.shareCard(cardId, limits.maxFeedEntries);
    if (shareResult === "unknown_card") {
      response.status(404).json({ error: "unknown_card" });
      return;
    }
    response.json({ ok: true });
  });

  app.get("/feed", (_request, response) => {
    response.json({ entries: publicArtifacts.listFeed() });
  });

  app.post("/reports/verify", (request, response) => {
    const payload = parseVerificationPayload(request.body);
    if (!payload) {
      response.status(400).json({ error: "invalid_verification_payload" });
      return;
    }

    response.json({
      verified: verifyReportProof(payload.record, payload.proof, payload.datasetRoot)
    });
  });

  // ---------------------------------------------------------------- //
  //  Token discovery (landing hero) — live CSPR.cloud, best-effort    //
  // ---------------------------------------------------------------- //

  // Resolves a token symbol to its package hash within cspr.trade's pair set.
  app.get("/resolve", async (request, response) => {
    const symbol = typeof request.query.symbol === "string" ? request.query.symbol.trim() : "";
    if (!symbol || symbol.length > 24) {
      response.status(400).json({ error: "invalid_symbol" });
      return;
    }
    try {
      const resolved = await resolveTokenBySymbol(symbol);
      if (!resolved) {
        response.status(404).json({ error: "not_listed", symbol });
        return;
      }
      response.json(resolved);
    } catch (error) {
      console.error("/resolve failed:", error instanceof Error ? error.message : error);
      response.status(503).json(sourceUnavailableBody("CSPR.trade"));
    }
  });

  app.get("/resolve-account", async (request, response) => {
    const name = normalizeCsprName(request.query.name);
    if (!name) {
      response.status(400).json({ error: "invalid_cspr_name" });
      return;
    }
    try {
      const resolved = await resolveCsprName(name);
      if (!resolved) {
        response.status(404).json({ error: "not_found", name });
        return;
      }
      response.json(resolved);
    } catch (error) {
      console.error("/resolve-account failed:", error instanceof Error ? error.message : error);
      response.status(503).json(sourceUnavailableBody("CSPR.name", "account resolution"));
    }
  });

  app.get("/tokens", async (_request, response) => {
    try {
      response.json({ tokens: await getHeroTokenList() });
    } catch (error) {
      console.error("/tokens failed:", error instanceof Error ? error.message : error);
      response.status(503).json(sourceUnavailableBody("CSPR.cloud"));
    }
  });

  if (options.auditorRouter) app.use("/v1", options.auditorRouter);

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
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
    console.error("Report API request failed", error instanceof Error ? error.name : "UnknownError");
    response.status(status).json({
      error: "live_source_error",
      message: "AgentPay could not complete the request."
    });
  });

  return app;
}

async function createQuoteSnapshot(
  resourceBaseUrl: string,
  subject: SubjectRef,
  evidenceNetwork: EvidenceNetwork,
  paymentAssetEvidenceLoader: PaymentAssetEvidenceLoader
): Promise<QuoteSnapshot> {
  const dataset =
    subject.kind === "account"
      ? await buildAccountEvidence(subject, { network: evidenceNetwork })
      : await buildSubjectEvidence(subject, { network: evidenceNetwork });
  const report = chooseReport(dataset);
  const expiresAt = Date.now() + quoteTtlSeconds() * 1000;
  const quoteId = `${dataset.datasetId}-${report.reportHash.slice(0, 16)}`;
  const paymentResource = buildPaymentResource({
    quoteId,
    reportId: report.record.id,
    baseUrl: resourceBaseUrl
  });
  const paymentConfiguration = paymentRequirementConfiguration();
  const configuredRequirement = paymentConfiguration.ok
    ? buildPaymentRequirement({
        amount: paymentConfiguration.amount,
        network: paymentConfiguration.network,
        assetPackageHash: paymentConfiguration.assetPackageHash,
        payTo: paymentConfiguration.payTo,
        tokenName: paymentConfiguration.tokenName,
        tokenVersion: paymentConfiguration.tokenVersion,
        tokenDecimals: paymentConfiguration.tokenDecimals,
        tokenSymbol: paymentConfiguration.tokenSymbol,
        maxTimeoutSeconds: configuredPaymentTimeoutSeconds()
      })
    : null;
  const assetCheck = await loadPaymentAssetEvidence(
    configuredRequirement,
    paymentAssetEvidenceLoader
  );
  const paymentReadiness = await checkPaymentReadiness({
    requirement: configuredRequirement,
    configurationReason: paymentConfiguration.ok ? null : paymentConfiguration.reason,
    assetEvidence: assetCheck.evidence,
    assetEvidenceError: assetCheck.error
  });
  const amountAtomic = configuredRequirement?.amount ?? "";
  const displayAmount = configuredRequirement
    ? formatTokenAmount(configuredRequirement.amount, configuredRequirement.extra.decimals)
    : "";
  const displayAsset = configuredRequirement?.extra.symbol ?? "";

  return {
    quoteId,
    reportId: report.record.id,
    reportHash: report.reportHash,
    evidenceNetwork,
    dataset,
    expiresAt,
    paymentResource,
    paymentRequirement: paymentReadiness.status === "ready" ? configuredRequirement : null,
    paymentReadiness,
    paymentConfigurationReason: paymentReadiness.reason,
    amountAtomic,
    displayAmount,
    displayAsset,
    assetDecimals: configuredRequirement?.extra.decimals === undefined
      ? null
      : Number(configuredRequirement.extra.decimals),
    settlement: null,
    pendingSettlement: null
  };
}

function chooseReport(dataset: LiveEvidenceDataset): ReportProof {
  return (
    dataset.reports.find((report) => report.record.product === "CSPR.trade MCP") ??
    dataset.reports[dataset.reports.length - 1]
  );
}

function quoteResponse(snapshot: QuoteSnapshot) {
  return {
    quoteId: snapshot.quoteId,
    reportId: snapshot.reportId,
    reportHash: snapshot.reportHash,
    datasetId: snapshot.dataset.datasetId,
    datasetRoot: snapshot.dataset.root,
    evidenceNetwork: snapshot.evidenceNetwork,
    amount: snapshot.amountAtomic,
    amountDisplay: snapshot.displayAmount,
    asset: snapshot.displayAsset,
    assetPackageHash: snapshot.paymentRequirement?.asset ?? null,
    assetDecimals: snapshot.assetDecimals,
    network: snapshot.paymentRequirement?.network ?? process.env.X402_NETWORK ?? DEFAULT_X402_NETWORK,
    expiresAt: new Date(snapshot.expiresAt).toISOString(),
    expiresInSeconds: Math.max(0, Math.floor((snapshot.expiresAt - Date.now()) / 1000)),
    paymentResource: snapshot.paymentResource,
    paymentRequirements: snapshot.paymentRequirement ? [snapshot.paymentRequirement] : [],
    paymentConfigurationRequired: !snapshot.paymentRequirement,
    paymentConfigurationReason: snapshot.paymentConfigurationReason,
    paymentReadiness: publicPaymentReadiness(snapshot.paymentReadiness),
    sourceSummary: snapshot.dataset.sourceSummary
  };
}

function paymentRequired(snapshot: QuoteSnapshot, reason: string) {
  const payment = buildPaymentRequired({
    reason,
    resource: snapshot.paymentResource,
    requirement: snapshot.paymentRequirement
  });
  return {
    error: "payment_required",
    reason,
    x402Version: payment.x402Version,
    resource: payment.resource,
    quote: quoteResponse(snapshot),
    accepts: payment.accepts
  };
}

function writePaymentRequired(response: express.Response, snapshot: QuoteSnapshot, reason: string, paymentResponse?: unknown) {
  const required = buildPaymentRequired({
    reason,
    resource: snapshot.paymentResource,
    requirement: snapshot.paymentRequirement
  });
  response.setHeader(PAYMENT_REQUIRED_HEADER, encodeX402Header(required));
  if (paymentResponse) {
    response.setHeader(
      PAYMENT_RESPONSE_HEADER,
      encodeX402Header(publicPaymentRejection(paymentResponse))
    );
  }
  response.status(402).json(paymentRequired(snapshot, reason));
}

function publicPaymentRejection(value: unknown): Record<string, unknown> {
  const source = asObject(value);
  const result: Record<string, unknown> = { isValid: false };
  for (const field of ["invalidReason", "invalidMessage"] as const) {
    const candidate = source?.[field];
    if (typeof candidate === "string" && candidate.length > 0) {
      result[field] = candidate.slice(0, field === "invalidReason" ? 128 : 512);
    }
  }
  for (const field of ["transactionHash", "transaction"] as const) {
    const candidate = source?.[field];
    if (typeof candidate === "string" && /^[0-9a-f]{64}$/i.test(candidate)) {
      result.transactionHash = candidate.toLowerCase();
      break;
    }
  }
  return result;
}

function publicPaymentReadiness(readiness: PaymentReadiness) {
  return {
    status: readiness.status,
    reason: readiness.reason,
    checkedAt: readiness.checkedAt,
    checks: readiness.checks,
    supportedKind: readiness.supportedKind
      ? {
          x402Version: readiness.supportedKind.x402Version,
          scheme: readiness.supportedKind.scheme,
          network: readiness.supportedKind.network
        }
      : null
  };
}

function writeSettledQuote(response: express.Response, settlement: QuoteSettlement): void {
  response.setHeader(PAYMENT_RESPONSE_HEADER, encodeX402Header(settlement.paymentResponseHeader));
  response.json(settlement.reportResponse);
}

function parseVerificationPayload(value: unknown): {
  record: EvidenceRecord;
  proof: ProofStep[];
  datasetRoot: string;
} | null {
  const body = asObject(value);
  const record = asObject(body?.record);
  const proof = body?.proof;
  const datasetRoot = body?.datasetRoot;
  if (
    !record ||
    !Array.isArray(proof) ||
    proof.length > 256 ||
    typeof datasetRoot !== "string" ||
    !/^[0-9a-f]{64}$/i.test(datasetRoot)
  ) {
    return null;
  }
  const validProof = proof.every((value) => {
    const step = asObject(value);
    return (
      (step?.position === "left" || step?.position === "right") &&
      typeof step.hash === "string" &&
      /^[0-9a-f]{64}$/i.test(step.hash)
    );
  });
  return validProof
    ? {
        record: record as EvidenceRecord,
        proof: proof as ProofStep[],
        datasetRoot: datasetRoot.toLowerCase()
      }
    : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceUnavailableBody(source: string, operation = "token discovery") {
  return {
    code: "source_unavailable",
    message: `${source} ${operation} is unavailable.`,
    retryable: true,
    field: null,
    expected: `available ${source} ${operation} source`,
    received: null
  };
}

function reportResponse(snapshot: QuoteSnapshot, report: ReportProof, payment: SettledPayment) {
  return {
    datasetId: report.datasetId,
    datasetRoot: snapshot.dataset.root,
    evidenceNetwork: snapshot.evidenceNetwork,
    reportId: report.record.id,
    report: report.record,
    reportHash: report.reportHash,
    proof: report.proof,
    evidence: snapshot.dataset.reports,
    paymentReceiptHash: payment.receiptHash,
    payment: {
      scheme: payment.scheme,
      status: payment.status,
      transactionHash: payment.transactionHash,
      amount: snapshot.paymentRequirement?.amount ?? snapshot.amountAtomic,
      amountDisplay: snapshot.displayAmount,
      asset: snapshot.paymentRequirement?.asset ?? "",
      assetSymbol: snapshot.displayAsset,
      assetDecimals: snapshot.assetDecimals,
      network:
        snapshot.paymentRequirement?.network ??
        process.env.X402_NETWORK ??
        DEFAULT_X402_NETWORK,
      confirmation: payment.confirmation,
      facilitatorHash: payment.facilitatorHash
    }
  };
}

function quoteTtlSeconds() {
  const configured = Number(process.env.AGENT_PAY_QUOTE_TTL_SECONDS ?? DEFAULT_QUOTE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_QUOTE_TTL_SECONDS;
}

function configuredPaymentTimeoutSeconds() {
  const configured = Number(process.env.X402_MAX_TIMEOUT_SECONDS ?? 300);
  return Number.isInteger(configured) && configured >= 6 ? configured : 300;
}

function reportResourceBaseUrl(request: express.Request) {
  const configured = configuredPublicApiBaseUrl();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new TypeError(
      "AGENT_PAY_RESOURCE_BASE_URL is required to generate public payment URLs in production"
    );
  }
  return `${request.protocol}://${request.get("host")}`;
}

function requestPublicBaseUrl(request: express.Request) {
  const configured = configuredPublicApiBaseUrl();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new TypeError(
      "AGENT_PAY_RESOURCE_BASE_URL is required to generate the public AgentPay skill in production"
    );
  }
  const fwd = request.headers["x-forwarded-proto"];
  const proto = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || request.protocol || "http";
  const host = request.get("host") ?? `127.0.0.1:${process.env.REPORT_API_PORT ?? 4021}`;
  return `${proto}://${host}`;
}

function configuredPublicApiBaseUrl(): string | null {
  const configured =
    process.env.AGENT_PAY_PUBLIC_API_URL?.trim() ||
    process.env.AGENT_PAY_RESOURCE_BASE_URL?.trim() ||
    process.env.REPORT_API_PUBLIC_URL?.trim() ||
    process.env.AGENTPAY_PUBLIC_ORIGIN?.trim() ||
    process.env.AGENT_PAY_PUBLIC_ORIGIN?.trim();
  if (!configured) return null;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new TypeError("AgentPay public API base must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("AgentPay public API base must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(
      "AgentPay public API base must not include credentials, query parameters, or a fragment"
    );
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new TypeError("AgentPay public API base must use HTTPS in production");
  }
  return url.toString().replace(/\/+$/, "");
}

function readAgentPaySkill(origin: string) {
  return readFileSync(SKILL_PATH, "utf8").replace(/\$AGENT_PAY_BASE_URL/g, origin);
}

async function currentPaymentReadiness(
  paymentAssetEvidenceLoader: PaymentAssetEvidenceLoader
) {
  const paymentConfiguration = paymentRequirementConfiguration();
  const requirement = paymentConfiguration.ok
    ? buildPaymentRequirement({
        amount: paymentConfiguration.amount,
        network: paymentConfiguration.network,
        assetPackageHash: paymentConfiguration.assetPackageHash,
        payTo: paymentConfiguration.payTo,
        tokenName: paymentConfiguration.tokenName,
        tokenVersion: paymentConfiguration.tokenVersion,
        tokenDecimals: paymentConfiguration.tokenDecimals,
        tokenSymbol: paymentConfiguration.tokenSymbol,
        maxTimeoutSeconds: configuredPaymentTimeoutSeconds()
      })
    : null;
  const assetCheck = await loadPaymentAssetEvidence(requirement, paymentAssetEvidenceLoader);

  return checkPaymentReadiness({
    requirement,
    configurationReason: paymentConfiguration.ok ? null : paymentConfiguration.reason,
    assetEvidence: assetCheck.evidence,
    assetEvidenceError: assetCheck.error
  });
}

function readRuntimePaymentPayload(request: express.Request, body: BuyReportBody | null): unknown {
  const paymentHeader = request.header(PAYMENT_SIGNATURE_HEADER);
  if (paymentHeader) {
    return decodeX402PaymentHeader(paymentHeader);
  }
  return body?.paymentPayload;
}

function paymentRequirementConfiguration():
  | {
      ok: true;
      amount: string;
      network: "casper:casper-test";
      assetPackageHash: string;
      payTo: string;
      tokenName: string;
      tokenVersion: string;
      tokenDecimals: string;
      tokenSymbol: string;
    }
  | { ok: false; reason: string } {
  const assetPackageHash = process.env.X402_ASSET_PACKAGE_HASH?.trim();
  if (!assetPackageHash) {
    return { ok: false, reason: "x402_asset_package_hash_required" };
  }
  if (!/^[0-9a-f]{64}$/i.test(assetPackageHash)) {
    return { ok: false, reason: "x402_asset_package_hash_must_be_64_hex_chars" };
  }
  const payTo = process.env.PAYEE_ADDRESS?.trim();
  if (!payTo) {
    return { ok: false, reason: "payee_address_required" };
  }
  if (!/^00[0-9a-f]{64}$/i.test(payTo)) {
    return { ok: false, reason: "payee_address_must_be_00_plus_64_hex_chars" };
  }
  const amount = process.env.AGENT_PAY_REPORT_AMOUNT?.trim();
  if (!amount) return { ok: false, reason: "agent_pay_report_amount_required" };
  if (!isPositiveU256(amount)) {
    return { ok: false, reason: "agent_pay_report_amount_must_be_positive_u256_base_units" };
  }
  const network = process.env.X402_NETWORK?.trim() || DEFAULT_X402_NETWORK;
  if (network !== "casper:casper-test") {
    return { ok: false, reason: "x402_network_must_be_casper_testnet" };
  }
  const tokenName = boundedConfigurationText(process.env.X402_TOKEN_NAME, 128);
  if (!tokenName) return { ok: false, reason: "x402_token_name_required" };
  const tokenVersion = boundedConfigurationText(process.env.X402_TOKEN_VERSION, 64);
  if (!tokenVersion) return { ok: false, reason: "x402_token_version_required" };
  const tokenDecimals = process.env.X402_TOKEN_DECIMALS?.trim();
  if (
    !tokenDecimals ||
    !/^(0|[1-9][0-9]{0,2})$/.test(tokenDecimals) ||
    Number(tokenDecimals) > 255
  ) {
    return { ok: false, reason: "x402_token_decimals_must_be_0_to_255" };
  }
  const tokenSymbol = boundedConfigurationText(process.env.X402_TOKEN_SYMBOL, 32);
  if (!tokenSymbol) return { ok: false, reason: "x402_token_symbol_required" };
  const legacyDisplayAsset = process.env.AGENT_PAY_REPORT_ASSET?.trim();
  if (legacyDisplayAsset && legacyDisplayAsset !== tokenSymbol) {
    return { ok: false, reason: "agent_pay_report_asset_must_match_x402_token_symbol" };
  }
  return {
    ok: true,
    amount,
    network,
    assetPackageHash: assetPackageHash.toLowerCase(),
    payTo: payTo.toLowerCase(),
    tokenName,
    tokenVersion,
    tokenDecimals,
    tokenSymbol
  };
}

function isPositiveU256(value: string): boolean {
  if (!/^[1-9][0-9]*$/.test(value)) return false;
  try {
    return BigInt(value) <= (1n << 256n) - 1n;
  } catch {
    return false;
  }
}

function boundedConfigurationText(value: string | undefined, maximum: number): string | null {
  const text = value?.trim();
  return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text)
    ? text
    : null;
}

async function loadPaymentAssetEvidence(
  requirement: PaymentRequirement | null,
  loader: PaymentAssetEvidenceLoader
): Promise<{ evidence: PaymentAssetEvidence | null; error: string | null }> {
  if (!requirement) return { evidence: null, error: null };
  try {
    return { evidence: await loader(requirement), error: null };
  } catch (error) {
    return {
      evidence: null,
      error: error instanceof Error ? error.message : "payment asset lookup failed"
    };
  }
}

function createCachedPaymentAssetEvidenceLoader(): PaymentAssetEvidenceLoader {
  let cached: {
    key: string;
    expiresAt: number;
    promise: Promise<PaymentAssetEvidence>;
  } | null = null;

  return async (requirement) => {
    const rpcUrl = process.env.CASPER_RPC_URL?.trim() || DEFAULT_PAYMENT_RPC_URL;
    const key = hashJson({
      rpcUrl,
      asset: requirement.asset,
      name: requirement.extra.name,
      symbol: requirement.extra.symbol ?? null,
      decimals: requirement.extra.decimals ?? null
    });
    const now = Date.now();
    if (cached?.key === key && cached.expiresAt > now) return cached.promise;

    const promise = new NodeRpcClient({
      rpcUrl,
      timeoutMs: PAYMENT_ASSET_RPC_TIMEOUT_MS
    }).loadPaymentAssetEvidence({
      network: "casper:casper-test",
      packageHash: requirement.asset,
      declaredMetadata: {
        name: requirement.extra.name,
        symbol: requirement.extra.symbol ?? null,
        decimals: requirement.extra.decimals ?? null
      }
    });
    cached = { key, expiresAt: Number.POSITIVE_INFINITY, promise };
    try {
      const evidence = await promise;
      if (cached?.promise === promise) {
        cached.expiresAt = Date.now() + (
          evidence.sourceErrors.length > 0
            ? PAYMENT_ASSET_FAILURE_CACHE_TTL_MS
            : PAYMENT_ASSET_CACHE_TTL_MS
        );
      }
      return evidence;
    } catch (error) {
      if (cached?.promise === promise) cached = null;
      throw error;
    }
  };
}

function pruneExpiredQuotes(
  quotes: Map<string, QuoteSnapshot>,
  settledTransactionQuotes: Map<string, string>
) {
  const now = Date.now();
  for (const [quoteId, snapshot] of quotes.entries()) {
    if (snapshot.expiresAt <= now) {
      deleteQuote(quotes, settledTransactionQuotes, quoteId, snapshot);
    }
  }
}

function deleteQuote(
  quotes: Map<string, QuoteSnapshot>,
  settledTransactionQuotes: Map<string, string>,
  quoteId: string,
  snapshot: QuoteSnapshot
): void {
  quotes.delete(quoteId);
  removeSettlementMapping(settledTransactionQuotes, quoteId, snapshot);
}

function removeSettlementMapping(
  settledTransactionQuotes: Map<string, string>,
  quoteId: string,
  snapshot: QuoteSnapshot
): void {
  const transactionHash = snapshot.settlement?.paymentResponseHeader.transaction;
  if (transactionHash && settledTransactionQuotes.get(transactionHash) === quoteId) {
    settledTransactionQuotes.delete(transactionHash);
  }
}

function configuredDecisionRecordVerifier(): DecisionRecordVerifier | null {
  const rpcUrl = process.env.CASPER_RPC_URL?.trim();
  const registryPackageHash = process.env.AGENT_PAY_REGISTRY_PACKAGE_HASH?.trim();
  if (!rpcUrl || !registryPackageHash || !/^(?:hash-)?[0-9a-f]{64}$/i.test(registryPackageHash)) {
    return null;
  }
  try {
    return createDecisionRecordVerifier({ rpcUrl, registryPackageHash });
  } catch {
    return null;
  }
}

function resolveSecurityLimits(overrides: Partial<AppSecurityLimits> | undefined): AppSecurityLimits {
  const configured: AppSecurityLimits = {
    windowMs: envPositiveInteger("AGENT_PAY_RATE_LIMIT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 3_600_000),
    quoteRequestsPerWindow: envPositiveInteger(
      "AGENT_PAY_QUOTE_RATE_LIMIT",
      DEFAULT_QUOTE_REQUESTS_PER_WINDOW,
      100_000
    ),
    authRequestsPerWindow: envPositiveInteger(
      "AGENT_PAY_AUTH_RATE_LIMIT",
      DEFAULT_AUTH_REQUESTS_PER_WINDOW,
      100_000
    ),
    publicWritesPerWindow: envPositiveInteger(
      "AGENT_PAY_PUBLIC_WRITE_RATE_LIMIT",
      DEFAULT_PUBLIC_WRITES_PER_WINDOW,
      100_000
    ),
    discoveryRequestsPerWindow: envPositiveInteger(
      "AGENT_PAY_DISCOVERY_RATE_LIMIT",
      DEFAULT_DISCOVERY_REQUESTS_PER_WINDOW,
      100_000
    ),
    maxTrackedClients: envPositiveInteger(
      "AGENT_PAY_RATE_LIMIT_MAX_CLIENTS",
      DEFAULT_RATE_LIMIT_CLIENTS,
      1_000_000
    ),
    maxActiveQuotes: envPositiveInteger("AGENT_PAY_MAX_ACTIVE_QUOTES", DEFAULT_MAX_ACTIVE_QUOTES, 100_000),
    maxVerdictCards: envPositiveInteger("AGENT_PAY_MAX_VERDICT_CARDS", DEFAULT_MAX_VERDICT_CARDS, 100_000),
    maxFeedEntries: envPositiveInteger("AGENT_PAY_MAX_FEED_ENTRIES", DEFAULT_MAX_FEED_ENTRIES, 100_000)
  };
  if (!overrides) return configured;
  for (const [name, value] of Object.entries(overrides)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }
  return { ...configured, ...overrides };
}

function envPositiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function rateLimitMiddleware(
  requestLimit: number,
  limits: AppSecurityLimits,
  methods: string[]
): express.RequestHandler {
  const limiter = new FixedWindowRateLimiter({
    limit: requestLimit,
    windowMs: limits.windowMs,
    maxKeys: limits.maxTrackedClients
  });
  const limitedMethods = new Set(methods);
  return (request, response, next) => {
    if (!limitedMethods.has(request.method)) {
      next();
      return;
    }
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const result = limiter.consume(key);
    response.setHeader("X-RateLimit-Remaining", result.remaining.toString());
    if (result.allowed) {
      next();
      return;
    }
    response.setHeader("Retry-After", result.retryAfterSeconds.toString());
    response.status(429).json({
      error: "rate_limited",
      message: "Too many requests. Retry after the indicated delay.",
      retryAfterSeconds: result.retryAfterSeconds
    });
  };
}

function errorHttpStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 502;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : candidate.statusCode;
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 502;
}
