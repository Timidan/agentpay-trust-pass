import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodePaymentRequiredHeader,
  normalizeOriginalRequest,
  normalizePaymentRequired
} from "../../src/payment/index.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/tab402-payment-required.json", import.meta.url)), "utf8")
) as unknown;

const request = normalizeOriginalRequest({
  method: "post",
  url: "https://tab402.fly.dev/v1/speak",
  bodyHash: "0".repeat(64),
  bodyBytes: 36,
  capturedAt: "2026-07-15T21:06:48.000Z",
  adapterVersion: "test"
});

describe("Casper x402 normalization", () => {
  it("normalizes the captured Tab402 requirement without hiding its resource scheme mismatch", () => {
    const result = normalizePaymentRequired(fixture, request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.terms).toMatchObject({
      x402Version: 2,
      acceptanceIndex: 0,
      scheme: "exact",
      network: "casper:casper-test",
      amount: "100000000",
      asset: "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf",
      payTo: "00b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8",
      maxTimeoutSeconds: 300,
      resourceComparison: {
        sameHost: true,
        sameScheme: false,
        samePath: true
      },
      extra: {
        name: "Casper X402 Token",
        symbol: "X402",
        version: "1",
        decimals: "9"
      }
    });
    expect(result.advisories.map((reason) => reason.code)).toEqual(["resource_scheme_mismatch"]);
    expect(result.terms.requirementHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("decodes a standard base64 PAYMENT-REQUIRED header", () => {
    const encoded = Buffer.from(JSON.stringify(fixture), "utf8").toString("base64");
    expect(decodePaymentRequiredHeader(encoded)).toEqual(fixture);
  });

  it("rejects an ambiguous payload with two compatible Casper acceptances", () => {
    const duplicate = structuredClone(fixture) as { accepts: unknown[] };
    duplicate.accepts.push(structuredClone(duplicate.accepts[0]));

    const result = normalizePaymentRequired(duplicate, request);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.reasons.map((reason) => reason.code)).toContain("invalid_payment_required");
  });

  it.each([
    ["fractional amount", { amount: "0.1" }],
    ["negative amount", { amount: "-1" }],
    ["malformed asset", { asset: "hash-nope" }],
    ["malformed payee", { payTo: "account-hash-nope" }],
    ["oversized timeout", { maxTimeoutSeconds: 901 }]
  ])("rejects %s", (_label, change) => {
    const changed = structuredClone(fixture) as { accepts: Array<Record<string, unknown>> };
    Object.assign(changed.accepts[0], change);

    expect(normalizePaymentRequired(changed, request).ok).toBe(false);
  });

  it("normalizes request method, host casing, default port, and body metadata", () => {
    expect(
      normalizeOriginalRequest({
        method: "post",
        url: "https://TAB402.FLY.DEV:443/v1/speak",
        bodyHash: "A".repeat(64),
        bodyBytes: 4,
        capturedAt: "2026-07-15T21:06:48.000Z",
        adapterVersion: "test"
      })
    ).toMatchObject({
      method: "POST",
      url: "https://tab402.fly.dev/v1/speak",
      origin: "https://tab402.fly.dev",
      path: "/v1/speak",
      bodyHash: "a".repeat(64),
      bodyBytes: 4
    });
  });
});
