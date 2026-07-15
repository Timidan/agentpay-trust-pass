import { artifactHash, type PaymentAssetEvidence } from "@agent-pay/core";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const HEX_64 = /^[0-9a-f]{64}$/i;
const UREF = /^uref-[0-9a-f]{64}-[0-9]{3}$/i;

const AUTHORIZATION_ARGUMENTS = [
  ["from", "Key"],
  ["to", "Key"],
  ["amount", "U256"],
  ["valid_after", "U64"],
  ["valid_before", "U64"],
  ["nonce", { List: "U8" }],
  ["public_key", "PublicKey"],
  ["signature", { List: "U8" }]
] as const;

export type DeclaredPaymentMetadata = {
  name: string;
  symbol: string | null;
  decimals: string | null;
};

export type PaymentAssetEvidenceInput = {
  network: "casper:casper-test";
  packageHash: string;
  declaredMetadata: DeclaredPaymentMetadata;
};

export type CasperRpcClientOptions = {
  rpcUrl: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
};

export class CasperRpcClient {
  readonly rpcUrl: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;

  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  private nextRequestId = 1;

  constructor(options: CasperRpcClientOptions) {
    const parsedUrl = new URL(options.rpcUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new TypeError("Casper RPC URL must use HTTP or HTTPS");
    }
    this.rpcUrl = parsedUrl.toString();
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes"
    );
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!method.trim()) throw new TypeError("Casper RPC method must not be empty");
    const id = this.nextRequestId++;
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response: Response;

    try {
      response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: requestSignal
      });
    } catch (error) {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new Error(`Casper RPC ${method} timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      if (signal?.aborted) {
        throw new Error(`Casper RPC ${method} was aborted`, { cause: error });
      }
      throw new Error(`Casper RPC ${method} transport failed: ${errorMessage(error)}`, { cause: error });
    }

    if (!response.ok) {
      throw new Error(`Casper RPC ${method} returned HTTP ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > this.maxResponseBytes) {
      throw new Error(`Casper RPC ${method} response exceeds ${this.maxResponseBytes} bytes`);
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new Error(`Casper RPC ${method} timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      throw new Error(`Casper RPC ${method} response read failed: ${errorMessage(error)}`, { cause: error });
    }
    if (bytes.byteLength > this.maxResponseBytes) {
      throw new Error(`Casper RPC ${method} response exceeds ${this.maxResponseBytes} bytes`);
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new Error(`Malformed Casper RPC response: invalid JSON (${errorMessage(error)})`, { cause: error });
    }

    const record = asRecord(envelope);
    if (!record || record.jsonrpc !== "2.0" || record.id !== id) {
      throw new Error("Malformed Casper RPC response: JSON-RPC version or request id does not match");
    }
    if ("error" in record) {
      const rpcError = asRecord(record.error);
      const code = rpcError?.code;
      const message = rpcError?.message;
      if (typeof code !== "number" || typeof message !== "string") {
        throw new Error("Malformed Casper RPC response: invalid error object");
      }
      throw new CasperRpcError(method, code, message, rpcError?.data);
    }
    if (!("result" in record)) {
      throw new Error("Malformed Casper RPC response: result is missing");
    }
    return record.result;
  }

  async getTransaction(hash: string, signal?: AbortSignal): Promise<unknown> {
    if (!HEX_64.test(hash)) {
      throw new TypeError("Casper transaction hash must be 64 hexadecimal characters");
    }
    return this.call(
      "info_get_transaction",
      { transaction_hash: { Version1: hash.toLowerCase() } },
      signal
    );
  }

  async loadPaymentAssetEvidence(
    input: PaymentAssetEvidenceInput,
    signal?: AbortSignal
  ): Promise<PaymentAssetEvidence> {
    validateEvidenceInput(input);
    const observedAt = validNow(this.now());
    const mutable: MutableEvidence = {
      network: input.network,
      packageHash: input.packageHash.toLowerCase(),
      packageExists: false,
      activeContractHash: null,
      authorizationEntrypoint: false,
      name: null,
      symbol: null,
      decimals: null,
      mintAuthorityOpen: null,
      supplyMutable: null,
      holderConcentrationPct: null,
      contractAgeBlocks: null,
      apiVersion: null,
      observedBlockHash: null,
      observedBlockHeight: null,
      observedAt,
      missing: [],
      sourceErrors: []
    };

    let packageResult: Record<string, unknown>;
    try {
      packageResult = requireRecord(
        await this.queryGlobalState(`hash-${mutable.packageHash}`, signal),
        "package response"
      );
      recordObservation(packageResult, mutable);
    } catch (error) {
      mutable.sourceErrors.push(`package: ${errorMessage(error)}`);
      mutable.missing.push("package", "activeContractHash", "authorizationEntrypoint", "name", "symbol", "decimals");
      return finalizeEvidence(mutable);
    }

    const contractPackage = storedVariant(packageResult, "ContractPackage");
    if (!contractPackage) {
      mutable.sourceErrors.push("package: stored value is not a ContractPackage");
      mutable.missing.push("package", "activeContractHash", "authorizationEntrypoint", "name", "symbol", "decimals");
      return finalizeEvidence(mutable);
    }
    mutable.packageExists = true;

    const activeContractHash = selectActiveContractHash(contractPackage);
    if (!activeContractHash) {
      mutable.sourceErrors.push("package: no active contract version could be resolved");
      mutable.missing.push("activeContractHash", "authorizationEntrypoint", "name", "symbol", "decimals");
      return finalizeEvidence(mutable);
    }
    mutable.activeContractHash = activeContractHash;

    let contractResult: Record<string, unknown>;
    try {
      contractResult = requireRecord(
        await this.queryGlobalState(`hash-${activeContractHash}`, signal),
        "contract response"
      );
      recordObservation(contractResult, mutable);
    } catch (error) {
      mutable.sourceErrors.push(`contract: ${errorMessage(error)}`);
      mutable.missing.push("authorizationEntrypoint", "name", "symbol", "decimals");
      return finalizeEvidence(mutable);
    }

    const contract = storedVariant(contractResult, "Contract");
    if (!contract) {
      mutable.sourceErrors.push("contract: stored value is not a Contract");
      mutable.missing.push("authorizationEntrypoint", "name", "symbol", "decimals");
      return finalizeEvidence(mutable);
    }
    if (stripHashPrefix(contract.contract_package_hash, "contract-package-") !== mutable.packageHash) {
      mutable.sourceErrors.push("contract: contract_package_hash does not match the queried package");
      mutable.missing.push("authorizationEntrypoint", "name", "symbol", "decimals");
      return finalizeEvidence(mutable);
    }

    mutable.authorizationEntrypoint = hasExactAuthorizationEntryPoint(contract.entry_points);
    if (!mutable.authorizationEntrypoint) mutable.missing.push("authorizationEntrypoint");

    const namedKeys = readNamedKeys(contract.named_keys);
    for (const metadataName of ["name", "symbol", "decimals"] as const) {
      const key = namedKeys.get(metadataName);
      if (!key) {
        mutable.missing.push(metadataName);
        mutable.sourceErrors.push(`metadata.${metadataName}: named-key URef is missing or invalid`);
        continue;
      }

      try {
        const result = requireRecord(
          await this.queryGlobalState(key, signal),
          `${metadataName} response`
        );
        recordObservation(result, mutable);
        const parsed = readMetadataValue(result, metadataName);
        if (metadataName === "decimals") mutable.decimals = parsed as number;
        else if (metadataName === "name") mutable.name = parsed as string;
        else mutable.symbol = parsed as string;
      } catch (error) {
        mutable.missing.push(metadataName);
        mutable.sourceErrors.push(`metadata.${metadataName}: ${errorMessage(error)}`);
      }
    }

    return finalizeEvidence(mutable);
  }

  private queryGlobalState(key: string, signal?: AbortSignal): Promise<unknown> {
    return this.call(
      "query_global_state",
      { state_identifier: null, key, path: [] },
      signal
    );
  }
}

export class CasperRpcError extends Error {
  readonly method: string;
  readonly code: number;
  readonly data: unknown;

  constructor(method: string, code: number, message: string, data: unknown) {
    super(`Casper RPC ${method} failed (${code}): ${message}`);
    this.name = "CasperRpcError";
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

type MutableEvidence = Omit<PaymentAssetEvidence, "evidenceHash">;

function validateEvidenceInput(input: PaymentAssetEvidenceInput): void {
  if (input.network !== "casper:casper-test") {
    throw new TypeError("Payment asset evidence only supports casper:casper-test");
  }
  if (!HEX_64.test(input.packageHash)) {
    throw new TypeError("Casper package hash must be 64 hexadecimal characters");
  }
  if (!input.declaredMetadata || typeof input.declaredMetadata.name !== "string") {
    throw new TypeError("Declared payment metadata must include a token name");
  }
  if (input.declaredMetadata.symbol !== null && typeof input.declaredMetadata.symbol !== "string") {
    throw new TypeError("Declared payment token symbol must be a string or null");
  }
  if (
    input.declaredMetadata.decimals !== null &&
    !/^(0|[1-9][0-9]{0,2})$/.test(input.declaredMetadata.decimals)
  ) {
    throw new TypeError("Declared payment token decimals must be a decimal string or null");
  }
}

function selectActiveContractHash(contractPackage: Record<string, unknown>): string | null {
  if (!Array.isArray(contractPackage.versions)) return null;
  const disabled = new Set<string>();
  if (Array.isArray(contractPackage.disabled_versions)) {
    for (const value of contractPackage.disabled_versions) {
      const version = asRecord(value);
      const major = nonNegativeInteger(version?.protocol_version_major);
      const contractVersion = nonNegativeInteger(version?.contract_version);
      if (major !== null && contractVersion !== null) disabled.add(`${major}:${contractVersion}`);
    }
  }

  const active = contractPackage.versions
    .map((value) => {
      const version = asRecord(value);
      const major = nonNegativeInteger(version?.protocol_version_major);
      const contractVersion = nonNegativeInteger(version?.contract_version);
      const contractHash = stripHashPrefix(version?.contract_hash, "contract-");
      if (major === null || contractVersion === null || contractHash === null) return null;
      return { major, contractVersion, contractHash };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .filter((value) => !disabled.has(`${value.major}:${value.contractVersion}`))
    .sort((left, right) => right.contractVersion - left.contractVersion || right.major - left.major);

  return active[0]?.contractHash ?? null;
}

function hasExactAuthorizationEntryPoint(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((candidate) => {
    const entryPoint = asRecord(candidate);
    const entryPointArgs = entryPoint?.args;
    if (
      entryPoint?.name !== "transfer_with_authorization" ||
      entryPoint.ret !== "Unit" ||
      entryPoint.access !== "Public" ||
      entryPoint.entry_point_type !== "Called" ||
      !Array.isArray(entryPointArgs) ||
      entryPointArgs.length !== AUTHORIZATION_ARGUMENTS.length
    ) {
      return false;
    }
    return AUTHORIZATION_ARGUMENTS.every(([expectedName, expectedType], index) => {
      const argument = asRecord(entryPointArgs[index]);
      return argument?.name === expectedName && sameClType(argument.cl_type, expectedType);
    });
  });
}

function sameClType(left: unknown, right: unknown): boolean {
  if (typeof right === "string") return left === right;
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  return leftRecord?.List === rightRecord?.List && Object.keys(leftRecord ?? {}).length === 1;
}

function readNamedKeys(value: unknown): Map<string, string> {
  const namedKeys = new Map<string, string>();
  const duplicates = new Set<string>();
  if (!Array.isArray(value)) return namedKeys;
  for (const candidate of value) {
    const namedKey = asRecord(candidate);
    if (typeof namedKey?.name !== "string" || typeof namedKey.key !== "string") continue;
    if (namedKeys.has(namedKey.name)) {
      duplicates.add(namedKey.name);
      continue;
    }
    if (UREF.test(namedKey.key)) namedKeys.set(namedKey.name, namedKey.key.toLowerCase());
  }
  for (const duplicate of duplicates) namedKeys.delete(duplicate);
  return namedKeys;
}

function readMetadataValue(
  result: Record<string, unknown>,
  name: "name" | "symbol" | "decimals"
): string | number {
  const clValue = storedVariant(result, "CLValue");
  if (!clValue) throw new Error("expected a CLValue stored value");
  if (name === "decimals") {
    if (
      clValue.cl_type !== "U8" ||
      typeof clValue.parsed !== "number" ||
      !Number.isInteger(clValue.parsed) ||
      clValue.parsed < 0 ||
      clValue.parsed > 255
    ) {
      throw new Error("expected a parsed U8 value");
    }
    return clValue.parsed;
  }
  if (clValue.cl_type !== "String" || typeof clValue.parsed !== "string") {
    throw new Error("expected a parsed String value");
  }
  return clValue.parsed;
}

function recordObservation(result: Record<string, unknown>, evidence: MutableEvidence): void {
  if (evidence.apiVersion === null && typeof result.api_version === "string") {
    evidence.apiVersion = result.api_version;
  }
  const blockHeader = asRecord(result.block_header);
  if (evidence.observedBlockHash === null) {
    evidence.observedBlockHash = stripHashPrefix(blockHeader?.hash, "block-");
  }
  if (evidence.observedBlockHeight === null) {
    evidence.observedBlockHeight = nonNegativeInteger(blockHeader?.height);
  }
}

function storedVariant(result: Record<string, unknown>, variant: string): Record<string, unknown> | null {
  return asRecord(asRecord(result.stored_value)?.[variant]);
}

function finalizeEvidence(mutable: MutableEvidence): PaymentAssetEvidence {
  const content: MutableEvidence = {
    ...mutable,
    missing: [...new Set(mutable.missing)].sort(),
    sourceErrors: [...new Set(mutable.sourceErrors)]
  };
  return { ...content, evidenceHash: artifactHash(content) };
}

function stripHashPrefix(value: unknown, prefix: string): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().startsWith(prefix)
    ? value.slice(prefix.length)
    : value;
  return HEX_64.test(normalized) ? normalized.toLowerCase() : null;
}

function validNow(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Casper RPC evidence clock returned an invalid date");
  }
  return value.toISOString();
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error(`${label} is not an object`);
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
