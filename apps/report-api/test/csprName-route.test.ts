import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportApp } from "../src/app.js";

const PUBLIC_KEY = "0188ed5156681e57c66d2f3f5baa38126607774a6cba86369fa89970426242413a";
const ACCOUNT_HASH = "1856e4a0b23c70b64e4509987680de0d99145fa0cdc71ad9b78760e18ff0deec";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /resolve-account", () => {
  it("resolves a CSPR.name to its validated Mainnet account", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({
      data: {
        name: "alice.cspr",
        resolved_hash: ACCOUNT_HASH,
        resolved_public_key: PUBLIC_KEY,
        expires_at: "2027-11-25T09:00:00Z",
        is_primary: true
      }
    })));

    const response = await request(createReportApp())
      .get("/resolve-account?name=Alice.CSPR")
      .expect(200);

    expect(response.body).toMatchObject({
      name: "alice.cspr",
      accountHash: `account-hash-${ACCOUNT_HASH}`,
      publicKey: PUBLIC_KEY,
      network: "casper-mainnet",
      source: "CSPR.name"
    });
  });

  it("distinguishes an unassigned name from an unavailable source", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      Response.json({ error: { code: "not_found" } }, { status: 404 })
    ));
    await request(createReportApp())
      .get("/resolve-account?name=missing.cspr")
      .expect(404, { error: "not_found", name: "missing.cspr" });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      Response.json({ internal: "must-not-leak" }, { status: 503 })
    ));
    const unavailable = await request(createReportApp())
      .get("/resolve-account?name=alice.cspr")
      .expect(503);
    expect(unavailable.body).toMatchObject({
      code: "source_unavailable",
      message: "CSPR.name account resolution is unavailable."
    });
    expect(JSON.stringify(unavailable.body)).not.toContain("must-not-leak");
  });

  it("rejects invalid names before contacting CSPR.name", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);

    await request(createReportApp())
      .get("/resolve-account?name=../alice.cspr")
      .expect(400, { error: "invalid_cspr_name" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
