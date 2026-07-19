import { describe, expect, it } from "vitest";
import { verifyProduction } from "../verify-production";

const ORIGIN = "https://agentpay.example";
const WCSPR_PACKAGE_HASH = `hash-${"a".repeat(64)}`;

describe("production verification", () => {
  it("accepts the current public app, service health, and hosted skill", async () => {
    const result = await verifyProduction({ origin: ORIGIN, fetchImpl: fixtureFetch() });

    expect(result.checks).toHaveLength(8);
    expect(result.applicationAssets).toEqual([`${ORIGIN}/assets/index-current.js`]);
  });

  it("rejects a public application bundle that exposes a loopback endpoint", async () => {
    const fetchImpl = fixtureFetch({
      "/assets/index-current.js": 'const api = "http://127.0.0.1:4021";'
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "application asset https://agentpay.example/assets/index-current.js exposes loopback URL"
    );
  });

  it("rejects a stale application bundle without the public npm integration", async () => {
    const fetchImpl = fixtureFetch({
      "/assets/index-current.js": 'fetch("/api/health")'
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "public application bundle is missing the MCP npm package"
    );
  });

  it("reports independent frontend and backend deployment leaks together", async () => {
    const fetchImpl = fixtureFetch({
      "/assets/index-current.js": [
        'const api = "http://127.0.0.1:4021";',
        'const facilitator = "http://127.0.0.1:4022";'
      ].join("\n"),
      "/bridge/tools/payment_status": JSON.stringify({
        status: "ready",
        facilitatorUrl: "http://127.0.0.1:4022"
      }),
      "/api/skill.md": "# AgentPay Trust Signal\n"
    });

    const error = await verifyProduction({ origin: ORIGIN, fetchImpl }).then(
      () => null,
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "application asset https://agentpay.example/assets/index-current.js exposes loopback URL " +
        "http://127.0.0.1:4021, http://127.0.0.1:4022"
    );
    expect((error as Error).message).toContain(
      "public payment status exposes loopback URL http://127.0.0.1:4022"
    );
    expect((error as Error).message).toContain("hosted skill is missing the payment-auditor tool");
  });

  it("rejects an obsolete hosted skill", async () => {
    const fetchImpl = fixtureFetch({
      "/api/skill.md": "# AgentPay Trust Signal\n"
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "hosted skill is missing the payment-auditor tool"
    );
  });

  it("rejects a fresh public quote that exposes an internal loopback endpoint", async () => {
    const fetchImpl = fixtureFetch({
      "/api/reports/quote": JSON.stringify({
        paymentResource: { url: `${ORIGIN}/api/reports/buy/quote-1` },
        paymentReadiness: { facilitatorUrl: "http://127.0.0.1:4022" }
      })
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "fresh WCSPR quote exposes loopback URL http://127.0.0.1:4022"
    );
  });

  it("rejects a public payment status that exposes the facilitator endpoint", async () => {
    const fetchImpl = fixtureFetch({
      "/bridge/tools/payment_status": JSON.stringify({
        status: "ready",
        facilitatorUrl: "http://127.0.0.1:4022"
      })
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "public payment status exposes loopback URL http://127.0.0.1:4022"
    );
  });

  it("rejects a public payment status that exposes the facilitator fee payer", async () => {
    const fetchImpl = fixtureFetch({
      "/bridge/tools/payment_status": JSON.stringify({
        status: "ready",
        supportedKind: {
          x402Version: 2,
          scheme: "exact",
          network: "casper:casper-test",
          feePayer: "7".repeat(64)
        }
      })
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "public payment status exposes facilitator fee payer"
    );
  });

  it("rejects a public payment rail that is not ready", async () => {
    const fetchImpl = fixtureFetch({
      "/bridge/tools/payment_status": JSON.stringify({
        status: "configuration_required",
        reason: "x402_facilitator_auth_required",
        supportedKind: null
      })
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "public payment status is not ready: x402_facilitator_auth_required"
    );
  });

  it("rejects a ready payment rail that does not support exact Testnet settlement", async () => {
    const fetchImpl = fixtureFetch({
      "/bridge/tools/payment_status": JSON.stringify({
        status: "ready",
        supportedKind: {
          x402Version: 2,
          scheme: "exact",
          network: "casper:casper-mainnet"
        }
      })
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "public payment status does not confirm x402 v2 exact Casper Testnet support"
    );
  });

  it("rejects a public registry status that exposes server internals", async () => {
    const fetchImpl = fixtureFetch({
      "/bridge/tools/registry_status": JSON.stringify({
        status: "ready",
        recordScript: "contracts/agent-pay-registry/scripts/record-decision-testnet.sh",
        checks: [],
        receiptAnchors: { status: "ready" }
      })
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "public registry status exposes record script"
    );
  });

  it("rejects a token checker whose live WCSPR evidence is incomplete", async () => {
    const fetchImpl = fixtureFetch({
      "/api/reports/quote": JSON.stringify({
        paymentResource: { url: `${ORIGIN}/api/reports/buy/quote-1` },
        paymentReadiness: { status: "ready" },
        sourceSummary: [
          {
            subject: "token_authority",
            facts: { publicMintEntrypoint: false }
          }
        ]
      })
    });

    await expect(verifyProduction({ origin: ORIGIN, fetchImpl })).rejects.toThrow(
      "fresh WCSPR quote is missing required token evidence: contract age, holder count, top-holder concentration"
    );
  });
});

function fixtureFetch(overrides: Record<string, string> = {}): typeof fetch {
  const bodies: Record<string, string> = {
    "/": `<!doctype html><title>AgentPay: check x402 charges before paying on Casper</title><script type="module" src="/assets/index-current.js"></script>`,
    "/assets/index-current.js": [
      'fetch("/api/health")',
      'const mcp = "https://www.npmjs.com/package/@timidan/agentpay-mcp";',
      'const cli = "https://www.npmjs.com/package/@timidan/agentpay-cli";',
      'const subject = "hash-3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e";'
    ].join("\n"),
    "/api/health": '{"ok":true}',
    "/bridge/health": '{"ok":true}',
    "/bridge/tools/payment_status": JSON.stringify({
      status: "ready",
      supportedKind: {
        x402Version: 2,
        scheme: "exact",
        network: "casper:casper-test"
      }
    }),
    "/bridge/tools/registry_status": JSON.stringify({
      status: "ready",
      checks: [
        { name: "decision_registry", status: "pass", message: "Decision registry ready" },
        { name: "receipt_recording", status: "pass", message: "Receipt recording ready" },
        { name: "casper_network", status: "pass", message: "casper-test" }
      ],
      registryPackageHash: `hash-${"b".repeat(64)}`,
      rpc: {
        apiVersion: "2.0.0",
        chainspecName: "casper-test",
        latestBlockHeight: 123,
        latestBlockHash: "c".repeat(64)
      },
      receiptAnchors: {
        status: "ready",
        reason: null,
        contractHash: `hash-${"d".repeat(64)}`
      }
    }),
    "/api/skill.md": "# AgentPay\nUse check_x402_payment before signing.\n",
    "/api/resolve": JSON.stringify({
      symbol: "WCSPR",
      packageHash: WCSPR_PACKAGE_HASH,
      network: "casper-mainnet"
    }),
    "/api/reports/quote": JSON.stringify({
      paymentResource: { url: `${ORIGIN}/api/reports/buy/quote-1` },
      paymentReadiness: { status: "ready" },
      sourceSummary: [
        {
          subject: "token_authority",
          facts: { publicMintEntrypoint: false }
        },
        {
          subject: "token_holders",
          facts: { holderCount: 120, topHolderPct: 14.25 }
        },
        {
          subject: "token_age",
          facts: { contractAgeBlocks: 100_000 }
        }
      ]
    }),
    ...overrides
  };

  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = bodies[url.pathname];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  }) as typeof fetch;
}
