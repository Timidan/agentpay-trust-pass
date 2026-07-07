import { describe, expect, it } from "vitest";
import { friendlyError, friendlyReason } from "../src/lib/friendly-errors";

describe("friendlyReason", () => {
  it("maps known reason codes to consumer copy and keeps the code as detail", () => {
    const result = friendlyReason("x402_asset_package_hash_required");
    expect(result.headline).toMatch(/payment asset isn't configured/);
    expect(result.detail).toBe("x402_asset_package_hash_required");
  });

  it("maps the invalid-subject code to paste-a-package-hash guidance", () => {
    const result = friendlyReason("subject_must_be_casper_package_hash");
    expect(result.headline).toMatch(/package hash/);
  });

  it("humanizes unknown snake_case codes instead of leaking them as the headline", () => {
    const result = friendlyReason("some_new_backend_code");
    expect(result.headline).toBe("Some new backend code.");
    expect(result.detail).toBe("some_new_backend_code");
  });

  it("passes through plain sentences untouched, without a duplicate detail", () => {
    const result = friendlyReason("The quote expired.");
    expect(result.headline).toBe("The quote expired.");
    expect(result.detail).toBeUndefined();
  });

  it("maps the 402 settlement reason codes", () => {
    expect(friendlyReason("malformed_payment_signature").headline).toMatch(/didn't parse/);
    expect(friendlyReason("payment_rejected").headline).toMatch(/rejected/);
    expect(friendlyReason("payment_verifier_unconfigured").headline).toMatch(/verifier isn't configured/);
  });

  it("maps registry and RPC config errors to operator copy", () => {
    expect(friendlyReason("AGENT_PAY_REGISTRY_PACKAGE_HASH is required to record an AgentPay decision").headline).toMatch(
      /registry contract isn't configured/
    );
    expect(friendlyReason("CASPER_RPC_URL is required to confirm a Casper decision submission").headline).toMatch(
      /no Casper RPC endpoint/
    );
  });

  it("handles null with a generic headline", () => {
    expect(friendlyReason(null).headline).toMatch(/Try again/);
  });
});

describe("friendlyError", () => {
  it("maps missing-signing-key config errors to operator copy", () => {
    const result = friendlyError(new Error("CASPER_SECRET_KEY_PATH is required for assess_subject"));
    expect(result.headline).toMatch(/isn't set up to run live checks/);
    expect(result.headline).not.toMatch(/CASPER_SECRET_KEY_PATH/);
    expect(result.headline).not.toMatch(/Nothing was charged/);
    expect(result.detail).toMatch(/CASPER_SECRET_KEY_PATH/);
  });

  it("maps Invalid subject errors to paste-a-package-hash guidance", () => {
    const result = friendlyError(new Error("Invalid subject: subject_must_be_casper_package_hash"));
    expect(result.headline).toMatch(/package hash/);
  });

  it("maps network failures to a services-not-running hint", () => {
    const result = friendlyError(new TypeError("Failed to fetch"));
    expect(result.headline).toMatch(/services are running/);
  });

  it("never leaks a raw JSON.parse SyntaxError as the headline", () => {
    const result = friendlyError(new SyntaxError("Unexpected end of JSON input"));
    expect(result.headline).not.toMatch(/JSON input/);
    expect(result.headline).toMatch(/unexpected response/);
  });

  it("handles non-Error values", () => {
    expect(friendlyError("boom").headline).toMatch(/Try again/);
  });
});
