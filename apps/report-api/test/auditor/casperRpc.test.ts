import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { NodeRpcClient } from "../../src/auditor/casperRpc.js";

const PACKAGE_HASH = "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf";
const CONTRACT_HASH = "81ad8086b869c0ad6b06ce38bedb82542411531b930962be5479c88f144ef4df";
const BLOCK_HASH = "7".repeat(64);
const TRANSACTION_HASH = "2458f77bcd56ae960c02d0dfba616c63f3008c7ee7e87bcfd861c4da87e774b4";
const OBSERVED_AT = "2026-07-15T21:06:48.000Z";

type RpcRequest = {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown;
};

type RpcReply = {
  status?: number;
  delayMs?: number;
  body: unknown;
};

type RpcHandler = (request: RpcRequest) => RpcReply | Promise<RpcReply>;

const openServers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("NodeRpcClient", () => {
  it("loads package, active contract, exact authorization entry point, and metadata", async () => {
    const requests: RpcRequest[] = [];
    const rpcUrl = await startRpcServer((request) => {
      requests.push(request);
      return stateReply(request);
    });
    const client = new NodeRpcClient({
      rpcUrl,
      now: () => new Date(OBSERVED_AT)
    });

    const evidence = await client.loadPaymentAssetEvidence({
      network: "casper:casper-test",
      packageHash: PACKAGE_HASH,
      declaredMetadata: {
        name: "Casper X402 Token",
        symbol: "X402",
        decimals: "9"
      }
    });

    expect(evidence).toMatchObject({
      network: "casper:casper-test",
      packageHash: PACKAGE_HASH,
      packageExists: true,
      activeContractHash: CONTRACT_HASH,
      authorizationEntrypoint: true,
      name: "Casper X402 Token",
      symbol: "X402",
      decimals: 9,
      mintBurnEnabled: false,
      publicMintEntrypoint: false,
      holderConcentrationPct: null,
      contractAgeBlocks: null,
      apiVersion: "2.0.0",
      observedBlockHash: BLOCK_HASH,
      observedBlockHeight: 7_654_321,
      observedAt: OBSERVED_AT,
      missing: [],
      sourceErrors: []
    });
    expect(evidence.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(requests.map((request) => request.params)).toEqual([
      { state_identifier: null, key: `hash-${PACKAGE_HASH}`, path: [] },
      { state_identifier: null, key: `hash-${CONTRACT_HASH}`, path: [] },
      { state_identifier: null, key: `uref-${"a".repeat(64)}-007`, path: [] },
      { state_identifier: null, key: `uref-${"b".repeat(64)}-007`, path: [] },
      { state_identifier: null, key: `uref-${"c".repeat(64)}-007`, path: [] },
      { state_identifier: null, key: `uref-${"e".repeat(64)}-007`, path: [] }
    ]);
  });

  it("reports an enabled CEP-18 mint and burn setting from Casper state", async () => {
    const rpcUrl = await startRpcServer((request) => {
      const reply = stateReply(request);
      if ((request.params as { key?: unknown }).key === `uref-${"e".repeat(64)}-007`) {
        return success(request, metadataResult("U8", 1));
      }
      return reply;
    });
    const client = new NodeRpcClient({ rpcUrl, now: () => new Date(OBSERVED_AT) });

    await expect(client.loadPaymentAssetEvidence(assetInput())).resolves.toMatchObject({
      mintBurnEnabled: true
    });
  });

  it("records a public mint entry point when the CEP-18 setting is absent", async () => {
    const rpcUrl = await startRpcServer((request) => {
      const reply = stateReply(request);
      if (isContractQuery(request)) {
        const contract = getStoredVariant(reply, "Contract");
        contract.named_keys = (contract.named_keys as Array<{ name: string }>).filter(
          (key) => key.name !== "enable_mint_burn"
        );
        contract.entry_points = [authorizationEntryPoint(), { name: "mint", access: "Public" }];
      }
      return reply;
    });
    const client = new NodeRpcClient({ rpcUrl, now: () => new Date(OBSERVED_AT) });

    const evidence = await client.loadPaymentAssetEvidence(assetInput());

    expect(evidence).toMatchObject({
      mintBurnEnabled: null,
      publicMintEntrypoint: true
    });
    expect(evidence.missing).not.toContain("mintBurnEnabled");
  });

  it("selects the highest non-disabled package version", async () => {
    const rpcUrl = await startRpcServer(stateReply);
    const client = new NodeRpcClient({ rpcUrl, now: () => new Date(OBSERVED_AT) });

    const evidence = await client.loadPaymentAssetEvidence(assetInput());

    expect(evidence.activeContractHash).toBe(CONTRACT_HASH);
  });

  it("supports tuple-form disabled package versions from Casper RPC", async () => {
    const rpcUrl = await startRpcServer((request) => {
      const reply = stateReply(request);
      if ((request.params as { key?: unknown }).key === `hash-${PACKAGE_HASH}`) {
        const pkg = getStoredVariant(reply, "ContractPackage");
        pkg.disabled_versions = [[2, 3]];
      }
      return reply;
    });
    const client = new NodeRpcClient({ rpcUrl, now: () => new Date(OBSERVED_AT) });

    await expect(client.loadPaymentAssetEvidence(assetInput())).resolves.toMatchObject({
      activeContractHash: CONTRACT_HASH
    });
  });

  it("rejects a similarly named entry point with a different argument type", async () => {
    const rpcUrl = await startRpcServer((request) => {
      const reply = stateReply(request);
      if (isContractQuery(request)) {
        const contract = getStoredVariant(reply, "Contract");
        const entryPoint = contract.entry_points[0] as { args: Array<{ name: string; cl_type: unknown }> };
        entryPoint.args[2] = { name: "amount", cl_type: "U64" };
      }
      return reply;
    });
    const client = new NodeRpcClient({ rpcUrl, now: () => new Date(OBSERVED_AT) });

    const evidence = await client.loadPaymentAssetEvidence(assetInput());

    expect(evidence.authorizationEntrypoint).toBe(false);
    expect(evidence.missing).toContain("authorizationEntrypoint");
  });

  it("records malformed metadata without discarding valid structural evidence", async () => {
    const rpcUrl = await startRpcServer((request) => {
      const reply = stateReply(request);
      if (metadataKey(request) === "decimals") {
        const clValue = getStoredVariant(reply, "CLValue");
        clValue.parsed = 999;
      }
      return reply;
    });
    const client = new NodeRpcClient({ rpcUrl, now: () => new Date(OBSERVED_AT) });

    const evidence = await client.loadPaymentAssetEvidence(assetInput());

    expect(evidence).toMatchObject({
      packageExists: true,
      activeContractHash: CONTRACT_HASH,
      authorizationEntrypoint: true,
      decimals: null,
      missing: ["decimals"]
    });
    expect(evidence.sourceErrors).toContain("metadata.decimals: expected a parsed U8 value");
  });

  it("returns fail-closed evidence when the package cannot be queried", async () => {
    const rpcUrl = await startRpcServer((request) => ({
      body: {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32003, message: "state query failed: value not found" }
      }
    }));
    const client = new NodeRpcClient({ rpcUrl, now: () => new Date(OBSERVED_AT) });

    const evidence = await client.loadPaymentAssetEvidence(assetInput());

    expect(evidence).toMatchObject({
      packageExists: false,
      activeContractHash: null,
      authorizationEntrypoint: false,
      name: null,
      symbol: null,
      decimals: null,
      missing: [
        "activeContractHash",
        "authorizationEntrypoint",
        "decimals",
        "name",
        "package",
        "supplyControl",
        "symbol"
      ]
    });
    expect(evidence.sourceErrors[0]).toMatch(/package: Casper RPC query_global_state failed \(-32003\)/);
  });

  it("does not report a missing package when the package query times out", async () => {
    const rpcUrl = await startRpcServer((request) => ({
      delayMs: 100,
      body: { jsonrpc: "2.0", id: request.id, result: packageResult() }
    }));
    const client = new NodeRpcClient({
      rpcUrl,
      timeoutMs: 20,
      now: () => new Date(OBSERVED_AT)
    });

    const evidence = await client.loadPaymentAssetEvidence(assetInput());

    expect(evidence.packageExists).toBeNull();
    expect(evidence.authorizationEntrypoint).toBeNull();
    expect(evidence.missing).toEqual(expect.arrayContaining(["package", "authorizationEntrypoint"]));
    expect(evidence.sourceErrors[0]).toBe(
      "package: Casper RPC query_global_state timed out after 20ms"
    );
  });

  it("rejects JSON-RPC error envelopes and missing results", async () => {
    const rpcErrorUrl = await startRpcServer((request) => ({
      body: {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32000, message: "boom" }
      }
    }));
    const malformedUrl = await startRpcServer((request) => ({
      body: { jsonrpc: "2.0", id: request.id }
    }));

    await expect(new NodeRpcClient({ rpcUrl: rpcErrorUrl }).call("query_global_state", {}))
      .rejects.toThrow("Casper RPC query_global_state failed (-32000): boom");
    await expect(new NodeRpcClient({ rpcUrl: malformedUrl }).call("query_global_state", {}))
      .rejects.toThrow("Malformed Casper RPC response: result is missing");
  });

  it("aborts RPC requests at the configured timeout", async () => {
    const rpcUrl = await startRpcServer((request) => ({
      delayMs: 100,
      body: { jsonrpc: "2.0", id: request.id, result: {} }
    }));
    const client = new NodeRpcClient({ rpcUrl, timeoutMs: 20 });

    await expect(client.call("query_global_state", {})).rejects.toThrow(
      "Casper RPC query_global_state timed out after 20ms"
    );
  });

  it("queries a Version1 transaction by exact hash", async () => {
    let observed: RpcRequest | null = null;
    const rpcUrl = await startRpcServer((request) => {
      observed = request;
      return {
        body: {
          jsonrpc: "2.0",
          id: request.id,
          result: { api_version: "2.0.0", transaction: { Version1: { hash: TRANSACTION_HASH } } }
        }
      };
    });
    const client = new NodeRpcClient({ rpcUrl });

    await expect(client.getTransaction(TRANSACTION_HASH)).resolves.toMatchObject({
      transaction: { Version1: { hash: TRANSACTION_HASH } }
    });
    expect(observed).toMatchObject({
      method: "info_get_transaction",
      params: { transaction_hash: { Version1: TRANSACTION_HASH } }
    });
    await expect(client.getTransaction("not-a-hash")).rejects.toThrow("transaction hash must be 64 hexadecimal characters");
  });
});

function assetInput() {
  return {
    network: "casper:casper-test" as const,
    packageHash: PACKAGE_HASH,
    declaredMetadata: {
      name: "Casper X402 Token",
      symbol: "X402",
      decimals: "9"
    }
  };
}

async function startRpcServer(handler: RpcHandler): Promise<string> {
  const server = createServer(async (request, response) => {
    try {
      const body = await readJsonRequest(request);
      const reply = await handler(body);
      if (reply.delayMs) await delay(reply.delayMs);
      writeJson(response, reply.status ?? 200, reply.body);
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test RPC server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function readJsonRequest(request: IncomingMessage): Promise<RpcRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcRequest;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function stateReply(request: RpcRequest): RpcReply {
  const key = (request.params as { key?: unknown }).key;
  if (key === `hash-${PACKAGE_HASH}`) return success(request, packageResult());
  if (key === `hash-${CONTRACT_HASH}`) return success(request, contractResult());
  if (key === `uref-${"a".repeat(64)}-007`) return success(request, metadataResult("String", "Casper X402 Token"));
  if (key === `uref-${"b".repeat(64)}-007`) return success(request, metadataResult("String", "X402"));
  if (key === `uref-${"c".repeat(64)}-007`) return success(request, metadataResult("U8", 9));
  if (key === `uref-${"e".repeat(64)}-007`) return success(request, metadataResult("U8", 0));
  return {
    body: {
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32003, message: `unknown key ${String(key)}` }
    }
  };
}

function success(request: RpcRequest, result: unknown): RpcReply {
  return { body: { jsonrpc: "2.0", id: request.id, result } };
}

function baseResult(storedValue: unknown) {
  return {
    api_version: "2.0.0",
    block_header: { hash: BLOCK_HASH, height: 7_654_321 },
    stored_value: storedValue,
    merkle_proof: "fixture-proof"
  };
}

function packageResult() {
  return baseResult({
    ContractPackage: {
      access_key: `uref-${"d".repeat(64)}-007`,
      versions: [
        {
          protocol_version_major: 2,
          contract_version: 1,
          contract_hash: `contract-${"1".repeat(64)}`
        },
        {
          protocol_version_major: 2,
          contract_version: 2,
          contract_hash: `contract-${CONTRACT_HASH}`
        },
        {
          protocol_version_major: 2,
          contract_version: 3,
          contract_hash: `contract-${"3".repeat(64)}`
        }
      ],
      disabled_versions: [{ protocol_version_major: 2, contract_version: 3 }],
      groups: [],
      lock_status: "Unlocked"
    }
  });
}

function contractResult() {
  return baseResult({
    Contract: {
      contract_package_hash: `contract-package-${PACKAGE_HASH}`,
      contract_wasm_hash: `contract-wasm-${"4".repeat(64)}`,
      named_keys: [
        { name: "name", key: `uref-${"a".repeat(64)}-007` },
        { name: "symbol", key: `uref-${"b".repeat(64)}-007` },
        { name: "decimals", key: `uref-${"c".repeat(64)}-007` },
        { name: "enable_mint_burn", key: `uref-${"e".repeat(64)}-007` }
      ],
      entry_points: [authorizationEntryPoint()]
    }
  });
}

function authorizationEntryPoint() {
  return {
    name: "transfer_with_authorization",
    args: [
      { name: "from", cl_type: "Key" },
      { name: "to", cl_type: "Key" },
      { name: "amount", cl_type: "U256" },
      { name: "valid_after", cl_type: "U64" },
      { name: "valid_before", cl_type: "U64" },
      { name: "nonce", cl_type: { List: "U8" } },
      { name: "public_key", cl_type: "PublicKey" },
      { name: "signature", cl_type: { List: "U8" } }
    ],
    ret: "Unit",
    access: "Public",
    entry_point_type: "Called"
  };
}

function metadataResult(clType: string, parsed: string | number) {
  return baseResult({ CLValue: { cl_type: clType, bytes: "fixture", parsed } });
}

function isContractQuery(request: RpcRequest): boolean {
  return (request.params as { key?: unknown }).key === `hash-${CONTRACT_HASH}`;
}

function metadataKey(request: RpcRequest): "name" | "symbol" | "decimals" | null {
  const key = (request.params as { key?: unknown }).key;
  if (key === `uref-${"a".repeat(64)}-007`) return "name";
  if (key === `uref-${"b".repeat(64)}-007`) return "symbol";
  if (key === `uref-${"c".repeat(64)}-007`) return "decimals";
  return null;
}

function getStoredVariant(reply: RpcReply, variant: "Contract" | "CLValue"): Record<string, any> {
  const body = reply.body as { result: { stored_value: Record<string, Record<string, any>> } };
  return body.result.stored_value[variant];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
