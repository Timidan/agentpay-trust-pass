import { Router } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportApp } from "../src/app.js";
import {
  FixedWindowRateLimiter,
  setBoundedMapEntry
} from "../src/securityLimits.js";
import { acceptDecisionRecord, createVerdictSubmission } from "./verdictSubmission.js";

const firstCard = createVerdictSubmission({ packageHash: "1".repeat(64) });
const secondCard = createVerdictSubmission({ packageHash: "2".repeat(64) });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("backend security limits", () => {
  it("reports whether complete token evidence is connected without exposing credentials", async () => {
    const limited = await request(createReportApp({ tokenEvidenceConfigured: false }))
      .get("/health")
      .expect(200);
    expect(limited.body.tokenEvidence).toEqual({
      status: "limited",
      source: "Casper RPC",
      available: ["supplyControl"],
      unavailable: ["contractAge", "holderCount", "topHolderShare"]
    });

    const complete = await request(createReportApp({ tokenEvidenceConfigured: true }))
      .get("/health")
      .expect(200);
    expect(complete.body.tokenEvidence).toEqual({
      status: "complete",
      source: "CSPR.live + Casper RPC",
      available: ["supplyControl", "contractAge", "holderCount", "topHolderShare"],
      unavailable: []
    });
    expect(JSON.stringify(complete.body)).not.toMatch(/access.?token|authorization/i);
  });

  it("reports complete public token coverage without a private indexer credential", async () => {
    vi.stubEnv("CSPR_CLOUD_ACCESS_TOKEN", "");

    const response = await request(createReportApp()).get("/health").expect(200);

    expect(response.body.tokenEvidence).toMatchObject({
      status: "complete",
      source: "CSPR.live + Casper RPC",
      unavailable: []
    });
  });

  it("allows configured browser origins and rejects every other origin", async () => {
    const app = createReportApp({ allowedOrigins: ["https://agentpay.example"] });

    const allowed = await request(app)
      .get("/health")
      .set("Origin", "https://agentpay.example")
      .expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://agentpay.example");

    const rejected = await request(app)
      .get("/health")
      .set("Origin", "https://attacker.example")
      .expect(403);
    expect(rejected.body).toMatchObject({ error: "origin_not_allowed" });

    await request(app)
      .options("/v1/checks")
      .set("Origin", "https://agentpay.example")
      .set("Access-Control-Request-Method", "POST")
      .expect(204)
      .expect("Access-Control-Allow-Origin", "https://agentpay.example");
  });

  it("blocks a client after the fixed-window request budget is exhausted", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1_000, maxKeys: 10 });

    expect(limiter.consume("client", 0)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume("client", 10)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.consume("client", 20)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1
    });
    expect(limiter.consume("client", 1_000)).toEqual({ allowed: true, remaining: 1 });
  });

  it("evicts the oldest map entry when a state limit is reached", () => {
    const values = new Map<string, number>();
    setBoundedMapEntry(values, "first", 1, 2);
    setBoundedMapEntry(values, "second", 2, 2);

    expect(setBoundedMapEntry(values, "third", 3, 2)).toEqual(["first", 1]);
    expect([...values.entries()]).toEqual([
      ["second", 2],
      ["third", 3]
    ]);
  });

  it("rate limits expensive quote requests before subject processing", async () => {
    const app = createReportApp({
      securityLimits: { quoteRequestsPerWindow: 1, windowMs: 60_000 }
    });

    await request(app).get("/reports/quote").expect(400);
    const limited = await request(app).get("/reports/quote").expect(429);

    expect(limited.body).toMatchObject({ error: "rate_limited" });
    expect(limited.headers["retry-after"]).toBe("60");
  });

  it("rate limits authentication challenge creation before the auditor router", async () => {
    const auditorRouter = Router();
    auditorRouter.post("/auth/challenges", (_request, response) => {
      response.status(201).json({ challengeId: "test" });
    });
    const app = createReportApp({
      auditorRouter,
      securityLimits: { authRequestsPerWindow: 1, windowMs: 60_000 }
    });

    await request(app).post("/v1/auth/challenges").send({}).expect(201);
    await request(app).post("/v1/auth/challenges").send({}).expect(429);
  });

  it("rate limits public discovery endpoints that perform upstream work", async () => {
    const app = createReportApp({
      securityLimits: { discoveryRequestsPerWindow: 1, windowMs: 60_000 }
    });

    const unavailable = await request(app).get("/tokens").expect(503);
    expect(unavailable.body).toMatchObject({ code: "source_unavailable" });

    const limited = await request(app).get("/tokens").expect(429);
    expect(limited.body).toMatchObject({ error: "rate_limited" });
    expect(limited.headers["retry-after"]).toBe("60");
  });

  it("rate limits report settlement and proof verification endpoints", async () => {
    const app = createReportApp({
      securityLimits: {
        publicWritesPerWindow: 1,
        discoveryRequestsPerWindow: 1,
        windowMs: 60_000
      }
    });

    await request(app).post("/reports/buy/not-a-quote").send({}).expect(400);
    await request(app).post("/reports/buy/not-a-quote").send({}).expect(429);
    await request(app).post("/reports/verify").send({}).expect(400);
    await request(app).post("/reports/verify").send({}).expect(429);
  });

  it("rejects malformed proof structures before hashing them", async () => {
    const response = await request(createReportApp())
      .post("/reports/verify")
      .send({
        record: { id: "test" },
        proof: [{ position: "sideways", hash: "a".repeat(64) }],
        datasetRoot: "b".repeat(64)
      })
      .expect(400);

    expect(response.body).toEqual({ error: "invalid_verification_payload" });
  });

  it("bounds public verdict card and feed state", async () => {
    const app = createReportApp({
      securityLimits: { maxVerdictCards: 1, maxFeedEntries: 1 },
      decisionRecordVerifier: acceptDecisionRecord
    });
    const first = await request(app).post("/card").send(firstCard).expect(200);
    const second = await request(app).post("/card").send(secondCard).expect(200);

    await request(app).get(`/card/${first.body.id}.svg`).expect(404);
    await request(app).post("/feed/share").send({ cardId: second.body.id, optIn: true }).expect(200);
    const feed = await request(app).get("/feed").expect(200);

    expect(feed.body.entries).toHaveLength(1);
    expect(feed.body.entries[0].id).toBe(second.body.id);
  });

  it("does not expose parser or internal error messages", async () => {
    const app = createReportApp();
    const response = await request(app)
      .post("/reports/verify")
      .send({ value: "x".repeat(1_100_000) })
      .expect(413);

    expect(response.body).toEqual({
      error: "request_too_large",
      message: "Request body exceeds the supported limit."
    });
    expect(JSON.stringify(response.body)).not.toContain("entity too large");
  });
});
