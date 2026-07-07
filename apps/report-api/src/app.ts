import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type Express } from "express";
import {
  findReport,
  hashJson,
  parseSubject,
  verifyReportProof,
  type EvidenceRecord,
  type ProofStep,
  type ReportProof,
  type SubjectRef
} from "@agent-pay/core";
import {
  renderVerdictCardSvg,
  renderVerdictCardPng,
  verdictCardId,
  type VerdictCardData
} from "./card.js";
import { resolveTokenBySymbol, type LiveEvidenceDataset } from "./liveEvidence.js";
import { getHeroTokenList } from "./csprCloud.js";
import { buildSubjectEvidence } from "./subjectEvidence.js";
import { buildAccountEvidence } from "./accountEvidence.js";
import {
  buildPaymentRequirement,
  buildPaymentRequired,
  buildPaymentResource,
  checkPaymentReadiness,
  decodeX402PaymentHeader,
  encodeX402Header,
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

const DEFAULT_QUOTE_TTL_SECONDS = 300;
const DEFAULT_REPORT_AMOUNT = "10000";
const DEFAULT_ASSET = "CSPR";
const DEFAULT_X402_NETWORK = "casper:casper-test";
const DEFAULT_TOKEN_NAME = "Cep18x402";
const DEFAULT_TOKEN_VERSION = "1";
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
  dataset: LiveEvidenceDataset;
  expiresAt: number;
  paymentResource: PaymentResource;
  paymentRequirement: PaymentRequirement | null;
  paymentReadiness: PaymentReadiness;
  paymentConfigurationReason: string | null;
  displayAmount: string;
  displayAsset: string;
  settlement: QuoteSettlement | null;
};

type QuoteSettlement = {
  paymentPayloadHash: string;
  paymentResponseHeader: { success: true; transaction: string };
  reportResponse: PaidReportResponse;
};

type PaidReportResponse = ReturnType<typeof reportResponse>;

type BuyReportBody = {
  quoteId?: string;
  paymentPayload?: unknown;
};

type FeedEntry = {
  id: string;
  aspect: string;
  subjectShortHash: string;
  cardImageUrl: string;
};

export function createReportApp(): Express {
  const app = express();
  const quotes = new Map<string, QuoteSnapshot>();
  const settledTransactionQuotes = new Map<string, string>();
  const verdictCards = new Map<string, VerdictCardData>();
  const feedEntries: FeedEntry[] = [];
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "report-api" });
  });

  app.get(["/skill.md", "/skill"], (request, response) => {
    if (!existsSync(SKILL_PATH)) {
      response.status(404).json({ error: "skill_not_found" });
      return;
    }
    response
      .type("text/markdown")
      .set("Cache-Control", "no-cache")
      .send(readAgentPaySkill(requestPublicOrigin(request)));
  });

  app.get("/reports/payment-status", async (_request, response, next) => {
    try {
      response.json(await currentPaymentReadiness());
    } catch (error) {
      next(error);
    }
  });

  app.get("/reports/quote", async (request, response, next) => {
    try {
      pruneExpiredQuotes(quotes);
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
      const snapshot = await createQuoteSnapshot(reportResourceBaseUrl(request), parsed.subject);
      quotes.set(snapshot.quoteId, snapshot);
      response.json(quoteResponse(snapshot));
    } catch (error) {
      next(error);
    }
  });

  app.post("/reports/buy/:quoteId", async (request, response, next) => {
    await handleBuyReport(request, response, next, request.params.quoteId);
  });

  app.post("/reports/buy", async (request, response, next) => {
    const body = request.body as BuyReportBody;
    await handleBuyReport(request, response, next, body.quoteId);
  });

  async function handleBuyReport(
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
    quoteId: string | undefined
  ) {
    try {
      pruneExpiredQuotes(quotes);
      const body = request.body as BuyReportBody;
      const snapshot = quoteId ? quotes.get(quoteId) : null;

      if (!quoteId || !snapshot) {
        response.status(400).json({ error: "invalid_quote", quoteId: quoteId ?? null });
        return;
      }

      if (Date.now() > snapshot.expiresAt) {
        quotes.delete(quoteId);
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
        response.setHeader(PAYMENT_RESPONSE_HEADER, encodeX402Header(snapshot.settlement.paymentResponseHeader));
        response.json(snapshot.settlement.reportResponse);
        return;
      }

      let payment: SettledPayment;
      try {
        payment = await settleX402Payment({
          paymentPayload,
          requirement: snapshot.paymentRequirement,
          resource: snapshot.paymentResource
        });
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
      }

      const settledQuoteId = settledTransactionQuotes.get(payment.transactionHash);
      if (settledQuoteId && settledQuoteId !== quoteId) {
        writePaymentRequired(response, snapshot, "payment_rejected", {
          isValid: false,
          invalidReason: "duplicate_transaction_hash",
          invalidMessage: "Settlement transaction has already been used for another AgentPay quote.",
          transactionHash: payment.transactionHash,
          quoteId: settledQuoteId
        });
        return;
      }

      const report = findReport(snapshot.dataset, snapshot.reportId);
      const paymentResponseHeader = { success: true as const, transaction: payment.transactionHash };
      const paidReport = reportResponse(snapshot.dataset, report, payment);
      snapshot.settlement = {
        paymentPayloadHash,
        paymentResponseHeader,
        reportResponse: paidReport
      };
      settledTransactionQuotes.set(payment.transactionHash, quoteId);
      response.setHeader(PAYMENT_RESPONSE_HEADER, encodeX402Header(paymentResponseHeader));
      response.json(paidReport);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------- //
  //  Verdict card routes                                              //
  // ---------------------------------------------------------------- //

  app.post("/card", (request, response) => {
    const data = request.body as VerdictCardData;
    const id = verdictCardId(data);
    verdictCards.set(id, data);
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
      const data = verdictCards.get(id);
      if (!data) {
        response.status(404).json({ error: "not_found" });
        return;
      }
      const svg = renderVerdictCardSvg(data);
      if (isSvg) {
        response.setHeader("content-type", "image/svg+xml");
        response.send(svg);
        return;
      }
      // PNG
      const pngBuf = await renderVerdictCardPng(svg);
      // PNG files start with magic byte 0x89; if not, it's SVG fallback
      if (pngBuf[0] === 0x89) {
        response.setHeader("content-type", "image/png");
      } else {
        response.setHeader("content-type", "image/svg+xml");
      }
      response.send(pngBuf);
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
    if (!cardId) {
      response.status(400).json({ error: "missing_card_id" });
      return;
    }
    const card = verdictCards.get(cardId);
    if (!card) {
      response.status(404).json({ error: "unknown_card" });
      return;
    }
    if (feedEntries.some((e) => e.id === cardId)) {
      response.json({ ok: true });
      return;
    }
    const entry: FeedEntry = {
      id: cardId,
      aspect: card.aspect,
      subjectShortHash: card.subjectShortHash,
      cardImageUrl: `/card/${cardId}.png`
    };
    feedEntries.push(entry);
    response.json({ ok: true });
  });

  app.get("/feed", (_request, response) => {
    // Most-recent-first: reverse insertion order
    response.json({ entries: [...feedEntries].reverse() });
  });

  app.post("/reports/verify", (request, response) => {
    const body = request.body as { record?: EvidenceRecord; proof?: ProofStep[]; datasetRoot?: string };
    if (!body.record || !body.proof || !body.datasetRoot) {
      response.status(400).json({ error: "missing_verification_payload" });
      return;
    }

    response.json({
      verified: verifyReportProof(body.record, body.proof, body.datasetRoot)
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
      response.status(502).json({ error: "resolver_unavailable", symbol });
    }
  });

  app.get("/tokens", async (_request, response) => {
    // Never break the landing: any failure (incl. no CSPR.cloud key) returns [].
    try {
      response.json({ tokens: await getHeroTokenList() });
    } catch {
      response.json({ tokens: [] });
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown report API error";
    response.status(502).json({ error: "live_source_error", message });
  });

  return app;
}

async function createQuoteSnapshot(resourceBaseUrl: string, subject: SubjectRef): Promise<QuoteSnapshot> {
  const dataset =
    subject.kind === "account"
      ? await buildAccountEvidence(subject)
      : await buildSubjectEvidence(subject);
  const report = chooseReport(dataset);
  const expiresAt = Date.now() + quoteTtlSeconds() * 1000;
  const quoteId = `${dataset.datasetId}-${report.reportHash.slice(0, 16)}`;
  const amount = process.env.AGENT_PAY_REPORT_AMOUNT ?? DEFAULT_REPORT_AMOUNT;
  const displayAsset = process.env.AGENT_PAY_REPORT_ASSET ?? process.env.X402_TOKEN_SYMBOL ?? DEFAULT_ASSET;
  const network = process.env.X402_NETWORK ?? DEFAULT_X402_NETWORK;
  const paymentResource = buildPaymentResource({
    quoteId,
    reportId: report.record.id,
    baseUrl: resourceBaseUrl
  });
  const paymentConfiguration = paymentRequirementConfiguration();
  const configuredRequirement = paymentConfiguration.ok
    ? buildPaymentRequirement({
        amount,
        network,
        assetPackageHash: paymentConfiguration.assetPackageHash,
        payTo: paymentConfiguration.payTo,
        tokenName: process.env.X402_TOKEN_NAME ?? DEFAULT_TOKEN_NAME,
        tokenVersion: process.env.X402_TOKEN_VERSION ?? DEFAULT_TOKEN_VERSION,
        tokenDecimals: process.env.X402_TOKEN_DECIMALS,
        tokenSymbol: process.env.X402_TOKEN_SYMBOL ?? displayAsset,
        maxTimeoutSeconds: configuredPaymentTimeoutSeconds()
      })
    : null;
  const paymentReadiness = await checkPaymentReadiness({
    requirement: configuredRequirement,
    configurationReason: paymentConfiguration.ok ? null : paymentConfiguration.reason
  });

  return {
    quoteId,
    reportId: report.record.id,
    reportHash: report.reportHash,
    dataset,
    expiresAt,
    paymentResource,
    paymentRequirement: paymentReadiness.status === "ready" ? configuredRequirement : null,
    paymentReadiness,
    paymentConfigurationReason: paymentReadiness.reason,
    displayAmount: amount,
    displayAsset,
    settlement: null
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
    amount: snapshot.displayAmount,
    asset: snapshot.displayAsset,
    network: snapshot.paymentRequirement?.network ?? process.env.X402_NETWORK ?? DEFAULT_X402_NETWORK,
    expiresAt: new Date(snapshot.expiresAt).toISOString(),
    expiresInSeconds: Math.max(0, Math.floor((snapshot.expiresAt - Date.now()) / 1000)),
    paymentResource: snapshot.paymentResource,
    paymentRequirements: snapshot.paymentRequirement ? [snapshot.paymentRequirement] : [],
    paymentConfigurationRequired: !snapshot.paymentRequirement,
    paymentConfigurationReason: snapshot.paymentConfigurationReason,
    paymentReadiness: snapshot.paymentReadiness,
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
    response.setHeader(PAYMENT_RESPONSE_HEADER, encodeX402Header(paymentResponse));
  }
  response.status(402).json(paymentRequired(snapshot, reason));
}

function reportResponse(dataset: LiveEvidenceDataset, report: ReportProof, payment: SettledPayment) {
  return {
    datasetId: report.datasetId,
    datasetRoot: dataset.root,
    reportId: report.record.id,
    report: report.record,
    reportHash: report.reportHash,
    proof: report.proof,
    evidence: dataset.reports,
    paymentReceiptHash: payment.receiptHash,
    payment: {
      scheme: payment.scheme,
      status: payment.status,
      transactionHash: payment.transactionHash,
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

function reportResourceBaseUrl(request?: express.Request) {
  const configured =
    process.env.AGENT_PAY_RESOURCE_BASE_URL ??
    process.env.REPORT_API_PUBLIC_URL ??
    process.env.REPORT_API_URL;
  if (configured) {
    return configured;
  }
  if (request) {
    return `${request.protocol}://${request.get("host")}`;
  }
  return `http://127.0.0.1:${process.env.REPORT_API_PORT ?? 4021}`;
}

function requestPublicOrigin(request: express.Request) {
  const configured = process.env.AGENT_PAY_PUBLIC_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const fwd = request.headers["x-forwarded-proto"];
  const proto = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || request.protocol || "http";
  const host = request.get("host") ?? `127.0.0.1:${process.env.REPORT_API_PORT ?? 4021}`;
  return `${proto}://${host}`;
}

function readAgentPaySkill(origin: string) {
  return readFileSync(SKILL_PATH, "utf8").replace(/\$AGENT_PAY_BASE_URL/g, origin);
}

async function currentPaymentReadiness() {
  const amount = process.env.AGENT_PAY_REPORT_AMOUNT ?? DEFAULT_REPORT_AMOUNT;
  const displayAsset = process.env.AGENT_PAY_REPORT_ASSET ?? process.env.X402_TOKEN_SYMBOL ?? DEFAULT_ASSET;
  const network = process.env.X402_NETWORK ?? DEFAULT_X402_NETWORK;
  const paymentConfiguration = paymentRequirementConfiguration();
  const requirement = paymentConfiguration.ok
    ? buildPaymentRequirement({
        amount,
        network,
        assetPackageHash: paymentConfiguration.assetPackageHash,
        payTo: paymentConfiguration.payTo,
        tokenName: process.env.X402_TOKEN_NAME ?? DEFAULT_TOKEN_NAME,
        tokenVersion: process.env.X402_TOKEN_VERSION ?? DEFAULT_TOKEN_VERSION,
        tokenDecimals: process.env.X402_TOKEN_DECIMALS,
        tokenSymbol: process.env.X402_TOKEN_SYMBOL ?? displayAsset,
        maxTimeoutSeconds: configuredPaymentTimeoutSeconds()
      })
    : null;

  return checkPaymentReadiness({
    requirement,
    configurationReason: paymentConfiguration.ok ? null : paymentConfiguration.reason
  });
}

function readRuntimePaymentPayload(request: express.Request, body: BuyReportBody): unknown {
  const paymentHeader = request.header(PAYMENT_SIGNATURE_HEADER);
  if (paymentHeader) {
    return decodeX402PaymentHeader(paymentHeader);
  }
  return body.paymentPayload;
}

function paymentRequirementConfiguration():
  | { ok: true; assetPackageHash: string; payTo: string }
  | { ok: false; reason: string } {
  const assetPackageHash = process.env.X402_ASSET_PACKAGE_HASH;
  if (!assetPackageHash) {
    return { ok: false, reason: "x402_asset_package_hash_required" };
  }
  if (!/^[0-9a-f]{64}$/i.test(assetPackageHash)) {
    return { ok: false, reason: "x402_asset_package_hash_must_be_64_hex_chars" };
  }
  const payTo = process.env.PAYEE_ADDRESS;
  if (!payTo) {
    return { ok: false, reason: "payee_address_required" };
  }
  if (!/^00[0-9a-f]{64}$/i.test(payTo)) {
    return { ok: false, reason: "payee_address_must_be_00_plus_64_hex_chars" };
  }
  return { ok: true, assetPackageHash, payTo };
}

function pruneExpiredQuotes(quotes: Map<string, QuoteSnapshot>) {
  const now = Date.now();
  for (const [quoteId, snapshot] of quotes.entries()) {
    if (snapshot.expiresAt <= now) {
      quotes.delete(quoteId);
    }
  }
}
