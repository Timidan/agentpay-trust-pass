import { randomUUID } from "node:crypto";
import {
  buildDataset,
  hashJson,
  type EvidenceFactValue,
  type EvidenceRecord,
  type SubjectRef
} from "@agent-pay/core";
import type { LiveEvidenceDataset } from "./liveEvidence.js";
import { fetchBoundedJson } from "./httpJson.js";
import {
  defaultEvidenceNetwork,
  evidenceRpcUrl,
  type EvidenceNetwork
} from "./evidenceNetwork.js";

/**
 * Account evidence from a public Casper node. `state_get_entity` returns
 * the account's associated
 * keys, action thresholds, named keys and main purse; `query_balance` returns
 * the purse balance. All named-param JSON-RPC. Best-effort: a lookup failure
 * degrades to `exists: null` (surfaced as "not checked"), never a false CLEAR.
 */

const RPC_ATTEMPTS = 2;
const RPC_RETRY_DELAY_MS = 150;

type EntityIdentifier = { PublicKey: string } | { AccountHash: string };

export type AccountEvidenceOptions = {
  network?: EvidenceNetwork;
  rpcUrl?: string;
};

export async function buildAccountEvidence(
  subject: SubjectRef,
  options: AccountEvidenceOptions = {}
): Promise<LiveEvidenceDataset> {
  const network = options.network ?? defaultEvidenceNetwork();
  const rpcUrl = options.rpcUrl ?? evidenceRpcUrl(network);
  const observedAt = new Date().toISOString();

  const entityIdentifier: EntityIdentifier = subject.publicKey
    ? { PublicKey: subject.publicKey }
    : { AccountHash: `account-hash-${subject.accountId ?? subject.packageHash}` };

  let exists: boolean | null = null;
  let accountHash: string | null = subject.accountId ? `account-hash-${subject.accountId}` : null;
  let associatedKeyCount: number | null = null;
  let deploymentThreshold: number | null = null;
  let keyManagementThreshold: number | null = null;
  let namedKeyCount: number | null = null;
  let mainPurse: string | null = null;

  try {
    const entity = await rpc<Record<string, unknown>>(rpcUrl, "state_get_entity", {
      entity_identifier: entityIdentifier,
      block_identifier: null,
      include_bytecode: false
    });
    const account = normalizeEntity(asRecord(entity.entity));
    if (account) {
      exists = true;
      accountHash = account.accountHash ?? accountHash;
      mainPurse = account.mainPurse;
      namedKeyCount = account.namedKeyCount;
      associatedKeyCount = account.associatedKeyCount;
      deploymentThreshold = account.deploymentThreshold;
      keyManagementThreshold = account.keyManagementThreshold;
    } else if (entity.entity != null) {
      // Resolved to an entity we couldn't read (unknown variant / a contract):
      // it exists, but its control/balance stay "not checked" → CAUTION.
      exists = true;
    }
  } catch (error) {
    // A "not found" style error means the address is empty on-chain — a real
    // signal. Any other error means we couldn't check — leave exists null.
    if (isNotFound(error)) {
      exists = false;
    }
  }

  let balanceMotes: string | null = null;
  if (mainPurse) {
    try {
      const bal = await rpc<Record<string, unknown>>(rpcUrl, "query_balance", {
        purse_identifier: { purse_uref: mainPurse }
      });
      balanceMotes = asString(bal.balance);
    } catch {
      // leave as not checked
    }
  } else if (exists === false) {
    balanceMotes = "0";
  }

  const key = subject.packageHash.slice(0, 16);
  const datasetId =
    `trust-account-${network}-${key}-${Date.now().toString(36)}`;

  const identityFacts: Record<string, EvidenceFactValue> = {};
  if (exists != null) identityFacts.exists = exists;
  if (accountHash) identityFacts.accountHash = accountHash;
  if (namedKeyCount != null) identityFacts.namedKeyCount = namedKeyCount;

  const controlFacts: Record<string, EvidenceFactValue> = {};
  if (associatedKeyCount != null) controlFacts.associatedKeyCount = associatedKeyCount;
  if (deploymentThreshold != null) controlFacts.deploymentThreshold = deploymentThreshold;
  if (keyManagementThreshold != null) controlFacts.keyManagementThreshold = keyManagementThreshold;

  const balanceFacts: Record<string, EvidenceFactValue> = {};
  if (balanceMotes != null) balanceFacts.balanceMotes = balanceMotes;

  const records: EvidenceRecord[] = [
    evidenceRecord({ id: `account-identity-${key}`, product: "Casper Account Identity", network, subject: "account_identity", observedAt, sourceUrl: rpcUrl, facts: identityFacts }),
    evidenceRecord({ id: `account-control-${key}`, product: "Casper Account Control", network, subject: "account_control", observedAt, sourceUrl: rpcUrl, facts: controlFacts }),
    evidenceRecord({ id: `account-balance-${key}`, product: "Casper Account Balance", network, subject: "account_balance", observedAt, sourceUrl: rpcUrl, facts: balanceFacts })
  ];

  const dataset = buildDataset(datasetId, records);
  return {
    ...dataset,
    sourceSummary: dataset.reports.map((report) => ({
      product: report.record.product,
      network: report.record.network,
      subject: report.record.subject,
      observedAt: report.record.observedAt,
      sourceUrl: report.record.sourceUrl,
      recordHash: report.reportHash,
      facts: report.record.facts
    }))
  };
}

type NormalizedEntity = {
  accountHash: string | null;
  mainPurse: string | null;
  namedKeyCount: number | null;
  associatedKeyCount: number | null;
  deploymentThreshold: number | null;
  keyManagementThreshold: number | null;
};

/**
 * Casper 2.0 `state_get_entity` returns `entity` as a tagged enum. Observed
 * live: `{ Account: {...} }` (legacy validator/user accounts). Also documented:
 * `{ LegacyAccount: {...} }` and `{ AddressableEntity: { entity: {...},
 * named_keys, entry_points } }`. Read whichever is present; unknown shapes
 * return null (→ exists but "not checked" → CAUTION, never a false CLEAR).
 */
export function normalizeEntity(entity: Record<string, unknown> | null): NormalizedEntity | null {
  if (!entity) return null;

  // Flat account variants — fields sit directly on the account object.
  const flat = asRecord(entity.Account) ?? asRecord(entity.LegacyAccount);
  if (flat) {
    const thresholds = asRecord(flat.action_thresholds);
    return {
      accountHash: asString(flat.account_hash),
      mainPurse: asString(flat.main_purse),
      namedKeyCount: Array.isArray(flat.named_keys) ? flat.named_keys.length : null,
      associatedKeyCount: Array.isArray(flat.associated_keys) ? flat.associated_keys.length : null,
      deploymentThreshold: asNumber(thresholds?.deployment),
      keyManagementThreshold: asNumber(thresholds?.key_management)
    };
  }

  // Addressable-entity variant — control fields live on an inner `entity`,
  // named_keys is a sibling of it.
  const wrapper = asRecord(entity.AddressableEntity);
  if (wrapper) {
    const inner = asRecord(wrapper.entity) ?? wrapper;
    const thresholds = asRecord(inner.action_thresholds);
    return {
      accountHash: asString(inner.account_hash) ?? asString(wrapper.account_hash),
      mainPurse: asString(inner.main_purse),
      namedKeyCount: Array.isArray(wrapper.named_keys) ? wrapper.named_keys.length : null,
      associatedKeyCount: Array.isArray(inner.associated_keys) ? inner.associated_keys.length : null,
      deploymentThreshold: asNumber(thresholds?.deployment),
      keyManagementThreshold: asNumber(thresholds?.key_management)
    };
  }

  return null;
}

function evidenceRecord(input: {
  id: string;
  product: string;
  network: string;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  facts: Record<string, EvidenceFactValue>;
}): EvidenceRecord {
  return {
    id: input.id,
    product: input.product,
    network: input.network,
    subject: input.subject,
    observedAt: input.observedAt,
    sourceUrl: input.sourceUrl,
    facts: input.facts,
    rawHash: hashJson({ subject: input.subject, ...input.facts })
  };
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    try {
      const { response, body } = await fetchBoundedJson<{
        result?: T;
        error?: { code?: number; message?: string };
      }>(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params })
      });
      if (body.error) {
        const error = new Error(body.error.message ?? `Casper RPC ${method} failed`) as Error & {
          rpcCode?: number;
        };
        error.rpcCode = body.error.code;
        throw error;
      }
      if (!response.ok || body.result == null) {
        throw new Error(`Casper RPC ${method} failed with ${response.status}`);
      }
      return body.result;
    } catch (error) {
      if ((error as { rpcCode?: unknown } | null)?.rpcCode !== undefined) throw error;
      lastError = error;
      if (attempt < RPC_ATTEMPTS) await delay(RPC_RETRY_DELAY_MS);
    }
  }
  throw lastError ?? new Error(`Casper RPC ${method} failed`);
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = (error as { rpcCode?: number } | null)?.rpcCode;
  // Casper returns a specific code / "not found" / "does not exist" wording.
  return code === -32026 || /not found|does not exist|no such|purse/i.test(message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
