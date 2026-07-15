# AgentPay Non-UI Payment Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and thoroughly verify AgentPay's non-custodial Casper x402 payment-auditor core, persistence, HTTP, MCP, CLI, settlement receipts, and hardened registry without changing the web UI.

**Architecture:** Pure payment types, canonicalization, policy evaluation, authorization cryptography, and settlement comparison live in `@agent-pay/core`. `report-api` owns network adapters, signed operator state, atomic SQLite reservations, checks, receipts, and HTTP routes. A local client package owns private-key access and signer enforcement; MCP, CLI, and existing buyer scripts consume it so hosted AgentPay never receives a buyer key.

**Tech Stack:** Node.js >=22.12, TypeScript 5.8 strict ESM, Vitest 3, Express 5, built-in `node:sqlite`, `@casper-ecosystem/casper-eip-712`, Noble curves/hashes, Rust 2021, Casper contract SDK 5.1, Casper types 6.0.

## Global Constraints

- Do not modify `apps/web` during this plan.
- Do not push any commit.
- Preserve every existing report, token, wallet, MCP, script, and contract test.
- The hosted API never reads `CASPER_SECRET_KEY_PATH` or receives a private key.
- Core amounts are decimal atomic-unit strings parsed with `BigInt`; never use JavaScript numbers for token amounts.
- P0 supports x402 v2 `exact` on `casper:casper-test` only.
- Pre-payment verdicts are `pay`, `review`, and `block`; settlement results are `match`, `mismatch`, `pending`, and `unverifiable`.
- Only a complete authorization intent plus an active signed operator pin can produce PAY in P0.
- Casper JSON-RPC, not facilitator output or CSPR.cloud, is settlement truth.
- A payment token's mint authority or holder concentration is advisory by default, not an investment-style hard block.
- Existing public registry claims remain disabled until registry v2 access control and append-only tests pass.
- Run the focused test after each red/green cycle, the affected workspace suite before each local commit, and `npm test && npm run lint && npm run build` at Tasks 4, 9, 13, and 14.

---

## File Map

### Pure core

- `packages/agent-pay-core/src/payment/types.ts`: shared request, terms, evidence, policy, decision, settlement, and receipt DTOs.
- `packages/agent-pay-core/src/payment/canonical.ts`: RFC 8785-compatible canonical JSON and artifact hashes.
- `packages/agent-pay-core/src/payment/normalize.ts`: strict x402 v2 and original-request normalization.
- `packages/agent-pay-core/src/payment/casperSignature.ts`: Casper account derivation and CSPR.click message signature verification.
- `packages/agent-pay-core/src/payment/authorization.ts`: EIP-712 intent construction, digesting, and payment signature verification.
- `packages/agent-pay-core/src/payment/policy.ts`: deterministic reason collection and PAY/REVIEW/BLOCK evaluation.
- `packages/agent-pay-core/src/payment/settlement.ts`: Version1 RPC decoder and exact comparison.
- `packages/agent-pay-core/src/payment/receipt.ts`: canonical receipt construction and independent verification.
- `packages/agent-pay-core/src/payment/index.ts`: payment exports.

### Hosted API

- `apps/report-api/src/auditor/casperRpc.ts`: bounded JSON-RPC transport and payment-asset evidence.
- `apps/report-api/src/auditor/repository.ts`: storage contract and records.
- `apps/report-api/src/auditor/sqliteRepository.ts`: migrations, transactions, reservations, sessions, and durable artifacts.
- `apps/report-api/src/auditor/auth.ts`: challenges, CSPR.click signature verification, sessions, and scoped tokens.
- `apps/report-api/src/auditor/service.ts`: check, settlement, observation, and receipt orchestration.
- `apps/report-api/src/auditor/probe.ts`: SSRF-resistant 402 acquisition.
- `apps/report-api/src/auditor/routes.ts`: `/v1` validation, auth, and error envelopes.
- `apps/report-api/src/auditor/runtime.ts`: production dependency wiring and lifecycle.
- `apps/report-api/src/app.ts`: mount the isolated auditor router without changing legacy route behavior.
- `apps/report-api/src/server.ts`: open and close the durable runtime.

### Local clients

- `packages/agent-pay-client/src/signer.ts`: PEM loading and local Ed25519/secp256k1 signing.
- `packages/agent-pay-client/src/api.ts`: authenticated AgentPay HTTP client.
- `packages/agent-pay-client/src/checkedCall.ts`: check-before-sign and response hashing flow.
- `apps/mcp-server/src/apiClient.ts`, `tools.ts`, `mcp.ts`: three payment-auditor tools using the client package.
- `apps/mcp-server/src/trust/x402Signer.ts`: compatibility re-export, removing copied cryptography.
- `scripts/x402-buyer.ts`: compatibility wrapper over the client package.
- `apps/cli/src/main.ts`: dependency-free command parser over the client package.

### Registry and fixtures

- `contracts/agent-pay-registry/src/lib.rs`: testable v2 recorder and duplicate semantics.
- `contracts/agent-pay-registry/src/contract.rs`: caller-derived recorder access and receipt anchor entry point.
- `contracts/agent-pay-registry/tests/agent_pay_registry_tests.rs`: unauthorized, duplicate, and append-only tests.
- `packages/agent-pay-core/test/fixtures/tab402-payment-required.json`: captured real Tab402 402.
- `packages/agent-pay-core/test/fixtures/tab402-transaction.json`: captured real official Casper RPC transaction.

---

### Task 1: Canonical Payment Types And x402 Normalization

**Files:**
- Create: `packages/agent-pay-core/src/payment/types.ts`
- Create: `packages/agent-pay-core/src/payment/canonical.ts`
- Create: `packages/agent-pay-core/src/payment/normalize.ts`
- Create: `packages/agent-pay-core/src/payment/index.ts`
- Modify: `packages/agent-pay-core/src/index.ts`
- Modify: `packages/agent-pay-core/package.json`
- Test: `packages/agent-pay-core/test/payment/canonical.test.ts`
- Test: `packages/agent-pay-core/test/payment/normalize.test.ts`
- Fixture: `packages/agent-pay-core/test/fixtures/tab402-payment-required.json`

**Interfaces:**
- Produces `OriginalRequest`, `PaymentTerms`, `PaymentRequirement`, `AuthorizationIntent`, `PaymentAssetEvidence`, `OperatorPolicy`, `ProviderDecision`, `PaymentDecision`, `SettlementProof`, and `PurchaseReceipt`.
- Produces `canonicalJson(value): string`, `artifactHash(value): string`, `normalizeOriginalRequest(input): OriginalRequest`, and `normalizePaymentRequired(input, request): NormalizeResult`.

- [ ] **Step 1: Add failing canonicalization and real Tab402 parser tests**

```ts
expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } }))
  .toBe('{"a":{"x":3,"y":2},"z":1}');
expect(() => canonicalJson({ amount: 1n })).toThrow(/BigInt/);

const result = normalizePaymentRequired(tab402Fixture, {
  method: "POST",
  url: "https://tab402.fly.dev/v1/speak",
  bodyHash: "0".repeat(64),
  bodyBytes: 36,
  capturedAt: "2026-07-15T21:06:48.000Z",
  adapterVersion: "test"
});
expect(result.ok).toBe(true);
if (result.ok) {
  expect(result.terms).toMatchObject({
    network: "casper:casper-test",
    amount: "100000000",
    asset: "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf",
    payTo: "00b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8",
    resourceComparison: { sameHost: true, sameScheme: false }
  });
}
```

- [ ] **Step 2: Run the new tests and confirm the imports fail**

Run: `npm test --workspace @agent-pay/core -- --run test/payment/canonical.test.ts test/payment/normalize.test.ts`
Expected: FAIL because `src/payment` does not exist.

- [ ] **Step 3: Implement strict normalized types and parsing**

```ts
export type PaymentVerdict = "pay" | "review" | "block";
export type SettlementVerdict = "match" | "mismatch" | "pending" | "unverifiable";

export type PaymentTerms = {
  x402Version: 2;
  acceptanceIndex: number;
  scheme: "exact";
  network: "casper:casper-test";
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: { url: string; description: string; mimeType: string };
  resourceComparison: { sameHost: boolean; sameScheme: boolean; samePath: boolean };
  extra: { name: string; version: string; decimals: string | null; symbol: string | null };
  requirementHash: string;
};

export type NormalizeResult =
  | { ok: true; request: OriginalRequest; terms: PaymentTerms; advisories: Reason[] }
  | { ok: false; reasons: Reason[] };
```

Reject non-object payloads, non-v2 versions, duplicate/ambiguous Casper acceptances, non-decimal
amounts, malformed package/payee hashes, invalid URLs, timeouts outside `1..900`, and extra decimals
outside `0..255`. Keep the observed HTTPS URL authoritative and emit
`resource_scheme_mismatch` for Tab402 instead of rewriting its declared HTTP URL.

- [ ] **Step 4: Run core tests and type-check**

Run: `npm test --workspace @agent-pay/core && npm run lint --workspace @agent-pay/core`
Expected: all old and new core tests pass.

- [ ] **Step 5: Commit locally**

```bash
git add packages/agent-pay-core
git commit -m "feat(core): normalize Casper x402 payment terms"
```

### Task 2: Casper Signatures And Authorization Binding

**Files:**
- Create: `packages/agent-pay-core/src/payment/casperSignature.ts`
- Create: `packages/agent-pay-core/src/payment/authorization.ts`
- Modify: `packages/agent-pay-core/src/payment/index.ts`
- Modify: `packages/agent-pay-core/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `packages/agent-pay-core/test/payment/casperSignature.test.ts`
- Test: `packages/agent-pay-core/test/payment/authorization.test.ts`

**Interfaces:**
- Produces `publicKeyToAccountAddress(publicKeyHex): string`.
- Produces `verifyCasperMessageSignature({ message, publicKeyHex, signatureHex }): boolean` compatible with CSPR.click's `Casper Message:\n` prefix.
- Produces `buildAuthorizationIntent(input): AuthorizationIntent`, `authorizationDigest(intent): string`, and `verifyAuthorizationSignature(intent, signatureHex): boolean`.

- [ ] **Step 1: Write deterministic Ed25519 and secp256k1 vectors**

```ts
const action = canonicalOperatorAction({
  kind: "provider_pin",
  operatorPublicKey: edPublicKey,
  revision: 1,
  nonce: "11".repeat(32)
});
const bytes = new TextEncoder().encode(`Casper Message:\n${action}`);
expect(verifyCasperMessageSignature({ action, publicKeyHex: edPublicKey, signatureHex: edSignature(bytes) }))
  .toBe(true);
expect(verifyCasperMessageSignature({ action: `${action}x`, publicKeyHex: edPublicKey, signatureHex: edSignature(bytes) }))
  .toBe(false);
```

Authorization tests must mutate `from`, `to`, `value`, `validAfter`, `validBefore`, nonce, asset,
network, token name, token version, and public key one at a time and assert verification fails.

- [ ] **Step 2: Run tests red**

Run: `npm test --workspace @agent-pay/core -- --run test/payment/casperSignature.test.ts test/payment/authorization.test.ts`
Expected: FAIL on missing signature functions.

- [ ] **Step 3: Implement Casper-compatible cryptography**

```ts
export function verifyCasperMessageSignature(input: CasperMessageSignature): boolean {
  const message = new TextEncoder().encode(`Casper Message:\n${input.message}`);
  const { algorithm, key } = parsePublicKey(input.publicKeyHex);
  const signature = parseSignature(input.signatureHex, algorithm);
  return algorithm === "ed25519"
    ? ed25519.verify(signature, message, key)
    : secp256k1.verify(signature, sha256(message), key);
}
```

Use `buildDomain`, `hashTypedData`, and `CASPER_DOMAIN_TYPES` for the x402 digest. Keep secp256k1's
protocol behavior (`sha256(eip712Digest)` before signing/verifying) and Ed25519's direct digest
behavior. Derive account hashes as BLAKE2b-256 over `<algorithm UTF-8> + 0x00 + raw public key`.

- [ ] **Step 4: Run core tests twice to detect random-vector flakiness**

Run: `npm test --workspace @agent-pay/core && npm test --workspace @agent-pay/core`
Expected: both runs pass with identical vector assertions.

- [ ] **Step 5: Commit locally**

```bash
git add packages/agent-pay-core pnpm-lock.yaml
git commit -m "feat(core): bind Casper x402 authorizations"
```

### Task 3: Payment-Specific Policy Engine

**Files:**
- Create: `packages/agent-pay-core/src/payment/policy.ts`
- Modify: `packages/agent-pay-core/src/payment/types.ts`
- Modify: `packages/agent-pay-core/src/payment/index.ts`
- Test: `packages/agent-pay-core/test/payment/policy.test.ts`

**Interfaces:**
- Produces `evaluatePayment(input: PaymentEvaluationInput): PaymentDecision`.
- Consumes normalized terms, optional authorization, payment-asset evidence, signed policy data,
  active provider pin/deny, spent/reserved totals, replay state, and a caller-supplied clock.

- [ ] **Step 1: Add a verdict table with explicit reason assertions**

```ts
it.each([
  ["no authorization", base({ authorization: null }), "review", "authorization_required"],
  ["no provider pin", base({ providerDecision: null }), "review", "provider_unapproved"],
  ["missing package", base({ evidence: evidence({ packageExists: false }) }), "block", "asset_package_not_found"],
  ["wrong amount", base({ authorization: intent({ amount: "1" }) }), "block", "authorization_field_mismatch"],
  ["daily cap", base({ spent: "900", reserved: "100", terms: terms({ amount: "1" }) }), "block", "policy_daily_cap_exceeded"],
  ["mintable token", base({ evidence: evidence({ mintAuthorityOpen: true }) }), "pay", "mint_authority_open"],
])("%s", (_name, input, verdict, code) => {
  const result = evaluatePayment(input);
  expect(result.verdict).toBe(verdict);
  expect([...result.reasons, ...result.advisories].map(item => item.code)).toContain(code);
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run: `npm test --workspace @agent-pay/core -- --run test/payment/policy.test.ts`
Expected: FAIL on missing evaluator.

- [ ] **Step 3: Implement fail-closed deterministic evaluation**

```ts
const verdict: PaymentVerdict = reasons.some(reason => reason.result === "block")
  ? "block"
  : reasons.some(reason => reason.result === "review")
    ? "review"
    : "pay";

return {
  checkId: input.checkId,
  verdict,
  basis: verdict === "pay" ? "operator_pinned" : null,
  reasons,
  advisories,
  policyHash: artifactHash(input.policy),
  authorizationDigest: input.authorization ? authorizationDigest(input.authorization) : null,
  reservation: verdict === "pay" ? { amount: input.terms.amount, expiresAt: reservationExpiry(input) } : null
};
```

Ensure missing mandatory structural evidence is REVIEW, provider pins cannot override structural,
policy, replay, freshness, or authorization failures, and investment signals remain advisories.

- [ ] **Step 4: Run focused and full core suites**

Run: `npm test --workspace @agent-pay/core -- --run test/payment/policy.test.ts && npm test --workspace @agent-pay/core`
Expected: PASS.

- [ ] **Step 5: Commit locally**

```bash
git add packages/agent-pay-core
git commit -m "feat(core): evaluate pre-payment policy"
```

### Task 4: Exact Casper Settlement Decoder

**Files:**
- Create: `packages/agent-pay-core/src/payment/settlement.ts`
- Modify: `packages/agent-pay-core/src/payment/types.ts`
- Modify: `packages/agent-pay-core/src/payment/index.ts`
- Fixture: `packages/agent-pay-core/test/fixtures/tab402-transaction.json`
- Test: `packages/agent-pay-core/test/payment/settlement.test.ts`

**Interfaces:**
- Produces `decodeCasperX402Transaction(rpcEnvelope): DecodeSettlementResult`.
- Produces `compareSettlement({ checkId, approved, rpcEnvelope, rpcEndpoint, observedAt }): SettlementProof`.

- [ ] **Step 1: Add the captured transaction and mutation tests**

```ts
const proof = compareSettlement({
  checkId: "check-tab402",
  approved: tab402ApprovedAuthorization,
  rpcEnvelope: tab402TransactionFixture,
  rpcEndpoint: "https://node.testnet.casper.network/rpc",
  observedAt: "2026-07-15T21:10:00.000Z"
});
expect(proof.verdict).toBe("match");
expect(proof.decoded).toMatchObject({
  chainName: "casper-test",
  packageHash: "50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf",
  entryPoint: "transfer_with_authorization",
  amount: "100000000"
});
```

Clone the fixture in memory and mutate each target/named argument, execution error, transaction
version, and chain. Expect MISMATCH for finalized differences, PENDING for missing execution info,
and UNVERIFIABLE for unsupported shapes.

- [ ] **Step 2: Run settlement tests red**

Run: `npm test --workspace @agent-pay/core -- --run test/payment/settlement.test.ts`
Expected: FAIL on missing decoder.

- [ ] **Step 3: Implement structural decoding without recursive key search**

```ts
const version1 = asRecord(asRecord(transaction)?.Version1);
const payload = asRecord(version1?.payload);
const fields = asRecord(payload?.fields);
const named = parseNamedArgs(asRecord(fields?.args)?.Named);
const target = parseByPackageHash(fields?.target);

return {
  transactionHash: requireHex64(version1?.hash),
  chainName: requireString(payload?.chain_name),
  packageHash: target,
  entryPoint: parseCustomEntryPoint(fields?.entry_point),
  from: parseKey(named.get("from")),
  to: parseKey(named.get("to")),
  amount: parseInteger(named.get("amount")),
  validAfter: parseInteger(named.get("valid_after")),
  validBefore: parseInteger(named.get("valid_before")),
  nonce: parseByteList(named.get("nonce")),
  publicKey: parsePublicKeyArg(named.get("public_key")),
  signature: parseByteList(named.get("signature"))
};
```

Never use initiator as payer. Validate `from` against the public-key-derived account hash and verify
the on-chain signature against the approved digest.

- [ ] **Step 4: Run the first full regression gate**

Run: `npm test && npm run lint && npm run build`
Expected: all baseline and new tests pass; all workspaces and contract build.

- [ ] **Step 5: Commit locally**

```bash
git add packages/agent-pay-core
git commit -m "feat(core): verify exact Casper x402 settlements"
```

### Task 5: Casper RPC Payment-Asset Evidence

**Files:**
- Create: `apps/report-api/src/auditor/casperRpc.ts`
- Test: `apps/report-api/test/auditor/casperRpc.test.ts`

**Interfaces:**
- Produces `CasperRpcClient.call(method, params, signal): Promise<unknown>`.
- Produces `loadPaymentAssetEvidence({ network, packageHash, declaredMetadata }): Promise<PaymentAssetEvidence>`.
- Produces `getTransaction(hash): Promise<unknown>`.

- [ ] **Step 1: Add package, contract, metadata, timeout, and malformed-RPC tests**

Use a local HTTP server that returns a ContractPackage for `hash-<package>`, its latest active
contract, a Contract containing the exact eight-argument `transfer_with_authorization` entry point,
and URef CLValues for `name`, `symbol`, and `decimals`.

```ts
expect(await adapter.loadPaymentAssetEvidence(input)).toMatchObject({
  packageExists: true,
  activeContractHash: "81ad8086b869c0ad6b06ce38bedb82542411531b930962be5479c88f144ef4df",
  authorizationEntrypoint: true,
  name: "Casper X402 Token",
  symbol: "X402",
  decimals: 9,
  missing: []
});
```

- [ ] **Step 2: Run the adapter tests red**

Run: `npm test --workspace @agent-pay/report-api -- --run test/auditor/casperRpc.test.ts`
Expected: FAIL on missing adapter.

- [ ] **Step 3: Implement bounded RPC and exact package traversal**

Call `query_global_state` with `{ state_identifier: null, key: "hash-<package>", path: [] }`, select the
highest non-disabled package version, query its contract hash, inspect its explicit entry-point
array, then query only the `name`, `symbol`, and `decimals` named-key URefs. Record block/API version
and source errors. Use `AbortSignal.timeout(5000)` and never fall back to CSPR.cloud for structural
truth.

- [ ] **Step 4: Run report-api tests**

Run: `npm test --workspace @agent-pay/report-api && npm run lint --workspace @agent-pay/report-api`
Expected: PASS.

- [ ] **Step 5: Commit locally**

```bash
git add apps/report-api
git commit -m "feat(api): collect Casper payment asset evidence"
```

### Task 6: Durable SQLite Repository And Atomic Reservations

**Files:**
- Create: `apps/report-api/src/auditor/repository.ts`
- Create: `apps/report-api/src/auditor/sqliteRepository.ts`
- Test: `apps/report-api/test/auditor/sqliteRepository.test.ts`

**Interfaces:**
- Produces `AuditorRepository` with challenge, session, policy, provider decision, token, check,
  reservation, settlement, observation, receipt, and anchor-job methods.
- Produces `openSqliteRepository(path): AuditorRepository & { close(): void }`.

- [ ] **Step 1: Add migration, restart, concurrency, and idempotency tests**

```ts
const first = openSqliteRepository(databasePath);
first.saveCheck(check);
expect(first.reserve({ checkId: check.id, operatorKey, asset, amount: "60", dailyCap: "100", expiresAt })).toEqual({ ok: true });
expect(first.reserve({ checkId: second.id, operatorKey, asset, amount: "60", dailyCap: "100", expiresAt })).toEqual({ ok: false, reason: "policy_daily_cap_exceeded" });
first.close();

const reopened = openSqliteRepository(databasePath);
expect(reopened.getCheck(check.id)?.id).toBe(check.id);
expect(reopened.reservedTotal(operatorKey, asset, utcDay)).toBe("60");
```

- [ ] **Step 2: Run repository tests red**

Run: `npm test --workspace @agent-pay/report-api -- --run test/auditor/sqliteRepository.test.ts`
Expected: FAIL on missing repository.

- [ ] **Step 3: Implement explicit migrations and transactions**

Use `DatabaseSync`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, and a `schema_migrations`
table. Store canonical JSON plus indexed identity/status columns. Wrap cap calculation and reservation
insert in one `BEGIN IMMEDIATE` transaction. Use decimal strings and sum with `BigInt` in application
code rather than SQLite numeric coercion. Expire reservations before each cap calculation.

- [ ] **Step 4: Run repository tests three times**

Run: `for run in 1 2 3; do npm test --workspace @agent-pay/report-api -- --run test/auditor/sqliteRepository.test.ts || exit 1; done`
Expected: all three runs pass and temporary database files are removed.

- [ ] **Step 5: Commit locally**

```bash
git add apps/report-api
git commit -m "feat(api): persist payment audits atomically"
```

### Task 7: Signed Operator Auth, Policies, Pins, And Agent Tokens

**Files:**
- Create: `apps/report-api/src/auditor/auth.ts`
- Create: `apps/report-api/src/auditor/routes.ts`
- Test: `apps/report-api/test/auditor/auth.test.ts`
- Test: `apps/report-api/test/auditor/policy-routes.test.ts`

**Interfaces:**
- Produces one-use five-minute challenges and one-hour bearer/cookie sessions.
- Produces signed immutable policy revisions and provider pin/deny revisions.
- Produces 32-byte random agent tokens stored only as SHA-256 hashes and bound to payer keys/scopes.

- [ ] **Step 1: Add signature, replay, revision, token, and authorization tests**

```ts
await request(app).post("/v1/policies/revisions").send(signedRevision).expect(401);
const session = await createSignedSession(app, operator);
await request(app).post("/v1/policies/revisions").set("authorization", session).send(signedRevision).expect(201);
await request(app).post("/v1/policies/revisions").set("authorization", session).send(signedRevision).expect(409);
await request(app).post("/v1/provider-decisions").set("authorization", agentToken).send(pin).expect(403);
```

Include wrong-origin challenge, expired challenge, altered canonical action, wrong public key,
revision skip, duplicate nonce, expired session, revoked token, wrong scope, and wrong payer tests.

- [ ] **Step 2: Run auth tests red**

Run: `npm test --workspace @agent-pay/report-api -- --run test/auditor/auth.test.ts test/auditor/policy-routes.test.ts`
Expected: FAIL because the routes are absent.

- [ ] **Step 3: Implement signed actions and constant-shape errors**

```ts
export type ApiErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
  field: string | null;
  expected: unknown;
  received: unknown;
};
```

Hash high-entropy bearer tokens with SHA-256, compare hashes with `timingSafeEqual`, set session
cookies `HttpOnly; Secure; SameSite=Strict`, require matching Origin on cookie-authenticated writes,
and require a signed canonical action for policy/provider/token changes even inside a session.

- [ ] **Step 4: Run auth tests and report-api regression**

Run: `npm test --workspace @agent-pay/report-api`
Expected: all legacy and auditor tests pass.

- [ ] **Step 5: Commit locally**

```bash
git add apps/report-api
git commit -m "feat(api): add signed operator controls"
```

### Task 8: Payment Check Service And HTTP Routes

**Files:**
- Create: `apps/report-api/src/auditor/service.ts`
- Create: `apps/report-api/src/auditor/runtime.ts`
- Modify: `apps/report-api/src/auditor/routes.ts`
- Modify: `apps/report-api/src/app.ts`
- Modify: `apps/report-api/src/server.ts`
- Test: `apps/report-api/test/auditor/check-routes.test.ts`

**Interfaces:**
- Produces `POST /v1/checks`, `GET /v1/checks/:id`, and `POST /v1/checks/:id/cancel`.
- Uses idempotency keys and creates a reservation only for PAY.

- [ ] **Step 1: Add first-use, pinned, tamper, replay, and restart API tests**

```ts
const first = await request(app).post("/v1/checks").set(agentAuth).send(checkBody).expect(201);
expect(first.body.decision.verdict).toBe("review");
expect(first.body.decision.reasons.map((reason: Reason) => reason.code)).toContain("provider_unapproved");

await installSignedPin(operatorSession, first.body.checkId, exactTuple);
const allowed = await request(app).post("/v1/checks").set(agentAuth).send(checkBody).expect(201);
expect(allowed.body.decision).toMatchObject({ verdict: "pay", basis: "operator_pinned" });

const tampered = await request(app).post("/v1/checks").set(agentAuth).send(withAmount(checkBody, "100000001")).expect(201);
expect(tampered.body.decision.verdict).toBe("block");
```

- [ ] **Step 2: Run route tests red**

Run: `npm test --workspace @agent-pay/report-api -- --run test/auditor/check-routes.test.ts`
Expected: FAIL with 404.

- [ ] **Step 3: Wire normalization, evidence, policy, and reservation in one service**

Create the check with `crypto.randomUUID()`, preserve all reason diffs, bind it to the authenticated
operator/agent/payer, and persist evidence before deciding. If the atomic reservation loses a race,
replace the provisional PAY with BLOCK `policy_daily_cap_exceeded` before returning. Existing
`/reports/*`, `/card/*`, `/feed`, `/resolve`, and `/tokens` handlers remain unchanged.

- [ ] **Step 4: Run API and core suites**

Run: `npm test --workspace @agent-pay/core && npm test --workspace @agent-pay/report-api`
Expected: PASS.

- [ ] **Step 5: Commit locally**

```bash
git add apps/report-api
git commit -m "feat(api): expose pre-payment checks"
```

### Task 9: Settlement Proofs, Response Observations, And Receipts

**Files:**
- Create: `packages/agent-pay-core/src/payment/receipt.ts`
- Modify: `packages/agent-pay-core/src/payment/index.ts`
- Modify: `apps/report-api/src/auditor/service.ts`
- Modify: `apps/report-api/src/auditor/routes.ts`
- Test: `packages/agent-pay-core/test/payment/receipt.test.ts`
- Test: `apps/report-api/test/auditor/settlement-routes.test.ts`
- Test: `apps/report-api/test/auditor/receipt-routes.test.ts`

**Interfaces:**
- Produces settlement verification, response observation, receipt retrieval/share, and stateless receipt verification routes from the design spec.

- [ ] **Step 1: Add real MATCH, field MISMATCH, PENDING, RPC failure, and tamper tests**

```ts
const settlement = await request(app)
  .post(`/v1/checks/${checkId}/verify-settlement`)
  .set(agentAuth)
  .send({ transactionHash: TAB402_TX_HASH })
  .expect(200);
expect(settlement.body.proof.verdict).toBe("match");

const verification = verifyPurchaseReceipt(receipt);
expect(verification.verified).toBe(true);
expect(verifyPurchaseReceipt({ ...receipt, response: { ...receipt.response, bodyHash: "f".repeat(64) } }).verified).toBe(false);
```

- [ ] **Step 2: Run receipt tests red**

Run: `npm test --workspace @agent-pay/core -- --run test/payment/receipt.test.ts && npm test --workspace @agent-pay/report-api -- --run test/auditor/settlement-routes.test.ts test/auditor/receipt-routes.test.ts`
Expected: FAIL on missing functions/routes.

- [ ] **Step 3: Implement immutable proof and receipt transitions**

Only a current PAY check accepts a transaction hash. Consume reservations on MATCH; quarantine them
on MISMATCH; retain them through PENDING; leave them unchanged on temporary UNVERIFIABLE. Accept only
status, content type, byte length, and SHA-256 body hash as response observation. Build a receipt
after settlement and observation, persist its canonical hash, and never mutate it after anchor.

- [ ] **Step 4: Run full regression gate twice**

Run: `npm test && npm run lint && npm run build && npm test`
Expected: both complete test passes are green.

- [ ] **Step 5: Commit locally**

```bash
git add packages/agent-pay-core apps/report-api
git commit -m "feat: verify x402 purchases and receipts"
```

### Task 10: SSRF-Resistant 402 Probe

**Files:**
- Create: `apps/report-api/src/auditor/probe.ts`
- Modify: `apps/report-api/src/auditor/routes.ts`
- Test: `apps/report-api/test/auditor/probe.test.ts`

**Interfaces:**
- Produces authenticated `POST /v1/probes` for GET/POST JSON calls with no caller-supplied secrets.

- [ ] **Step 1: Add public target and SSRF rejection tests**

Cover loopback, RFC1918, link-local, IPv6 local/link-local, decimal/octal IP forms, DNS resolution to
private IP, redirect to private IP, more than three redirects, non-HTTPS production URL, oversized
request/response, timeout, custom auth/cookie headers, and malformed `PAYMENT-REQUIRED`.

- [ ] **Step 2: Run probe tests red**

Run: `npm test --workspace @agent-pay/report-api -- --run test/auditor/probe.test.ts`
Expected: FAIL on missing route.

- [ ] **Step 3: Implement constrained acquisition**

Resolve every hop with `dns.promises.lookup({ all: true, verbatim: true })`, reject any forbidden
address before connecting, disable automatic redirects, revalidate each Location, allow only
`accept`, `content-type`, and AgentPay user-agent headers, limit JSON request bodies to 64 KiB,
responses to 1 MiB, redirects to three, and total time to five seconds. Return normalized terms and
hashes; do not persist response bodies.

- [ ] **Step 4: Run probe and full API tests**

Run: `npm test --workspace @agent-pay/report-api`
Expected: PASS.

- [ ] **Step 5: Commit locally**

```bash
git add apps/report-api
git commit -m "feat(api): safely probe x402 services"
```

### Task 11: Shared Local Client And MCP Tools

**Files:**
- Create: `packages/agent-pay-client/package.json`
- Create: `packages/agent-pay-client/tsconfig.json`
- Create: `packages/agent-pay-client/src/index.ts`
- Create: `packages/agent-pay-client/src/signer.ts`
- Create: `packages/agent-pay-client/src/api.ts`
- Create: `packages/agent-pay-client/src/checkedCall.ts`
- Test: `packages/agent-pay-client/test/signer.test.ts`
- Test: `packages/agent-pay-client/test/checkedCall.test.ts`
- Modify: `apps/mcp-server/package.json`
- Modify: `apps/mcp-server/src/apiClient.ts`
- Modify: `apps/mcp-server/src/tools.ts`
- Modify: `apps/mcp-server/src/mcp.ts`
- Modify: `apps/mcp-server/src/trust/x402Signer.ts`
- Modify: `scripts/x402-buyer.ts`
- Modify: `pnpm-lock.yaml`
- Test: `apps/mcp-server/test/tools.test.ts`
- Test: `apps/mcp-server/test/stdio.test.ts`
- Test: `scripts/test/x402-buyer.test.ts`

**Interfaces:**
- Produces `checkX402Payment`, `verifyX402Settlement`, `getPaymentReceipt`, and `checkedX402Call`.
- MCP exposes `check_x402_payment`, `verify_x402_settlement`, and `get_payment_receipt`.

- [ ] **Step 1: Add signer-boundary and MCP contract tests**

```ts
await expect(checkedX402Call({ ...input, signer })).resolves.toMatchObject({ settlement: { verdict: "match" } });
expect(signer.sign).toHaveBeenCalledTimes(1);

await expect(checkedX402Call({ ...input, api: apiReturning("block"), signer })).rejects.toThrow(/BLOCK/);
expect(signer.sign).not.toHaveBeenCalled();
```

Assert AgentPay API requests contain public key and authorization fields but never PEM content or a
private-key field. Assert existing buyer signatures remain byte-identical for fixed vectors.

- [ ] **Step 2: Run client/MCP/script tests red**

Run: `npm test --workspace @agent-pay/mcp-server && npm run test:scripts -- --run scripts/test/x402-buyer.test.ts`
Expected: new tool tests fail before implementation; existing tests remain green.

- [ ] **Step 3: Move signing behind the local client boundary**

The client captures the first 402, builds an unsigned intent, calls AgentPay, aborts unless PAY,
recomputes the returned digest locally, signs, sends `PAYMENT-SIGNATURE` to the paid service, hashes
the response locally, and asks AgentPay to verify the returned transaction hash. Replace copied MCP
and script cryptography with compatibility exports from `@agent-pay/client`.

- [ ] **Step 4: Run client, MCP, script, core, and API tests**

Run: `npm test --workspace @agent-pay/client && npm test --workspace @agent-pay/mcp-server && npm run test:scripts && npm test --workspace @agent-pay/core && npm test --workspace @agent-pay/report-api`
Expected: PASS.

- [ ] **Step 5: Commit locally**

```bash
git add packages/agent-pay-client apps/mcp-server scripts package.json pnpm-lock.yaml
git commit -m "feat: add non-custodial AgentPay clients"
```

### Task 12: Developer CLI

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/main.ts`
- Create: `apps/cli/src/output.ts`
- Test: `apps/cli/test/cli.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `agentpay check`, `verify-settlement`, `call`, `policy show|set`, `provider pin|deny|list`, and `receipt show|verify`.
- Exit codes: `0` success/PAY/MATCH, `2` REVIEW/PENDING, `3` BLOCK/MISMATCH, `4` UNVERIFIABLE/input/transport error.

- [ ] **Step 1: Add spawned CLI tests for output and exit codes**

```ts
expect(await runCli(["check", "--file", fixture], apiReturning("pay"))).toMatchObject({ code: 0 });
expect(await runCli(["check", "--file", fixture], apiReturning("review"))).toMatchObject({ code: 2 });
expect(await runCli(["verify-settlement", "--check", "id", "--tx", "f".repeat(64)], apiReturning("mismatch"))).toMatchObject({ code: 3 });
```

- [ ] **Step 2: Run CLI tests red**

Run: `npm test --workspace @agent-pay/cli`
Expected: FAIL before CLI files exist.

- [ ] **Step 3: Implement dependency-light command parsing and JSON output**

Use `node:util.parseArgs`; default to concise text on TTY and canonical JSON with `--json`. Read API
URL/token from flags or `AGENT_PAY_API_URL`/`AGENT_PAY_API_TOKEN`. Read secret key only for `call` or
signed operator commands. Never echo token or key paths in errors.

- [ ] **Step 4: Run CLI tests twice and workspace lint**

Run: `npm test --workspace @agent-pay/cli && npm test --workspace @agent-pay/cli && npm run lint --workspace @agent-pay/cli`
Expected: PASS twice.

- [ ] **Step 5: Commit locally**

```bash
git add apps/cli pnpm-lock.yaml
git commit -m "feat(cli): expose payment audit workflow"
```

### Task 13: Registry v2 Receipt Anchors

**Files:**
- Modify: `contracts/agent-pay-registry/src/lib.rs`
- Modify: `contracts/agent-pay-registry/src/contract.rs`
- Modify: `contracts/agent-pay-registry/tests/agent_pay_registry_tests.rs`
- Modify: `contracts/agent-pay-registry/scripts/deploy-testnet.sh`
- Create: `contracts/agent-pay-registry/scripts/record-receipt-testnet.sh`
- Create: `apps/report-api/src/auditor/registry.ts`
- Modify: `apps/report-api/src/auditor/service.ts`
- Test: `apps/report-api/test/auditor/registry.test.ts`
- Modify: `apps/mcp-server/src/casperClient.ts`
- Test: `apps/mcp-server/test/casperClient.test.ts`

**Interfaces:**
- Adds `record_purchase_receipt(receipt_hash, policy_hash, settlement_tx_hash, outcome)`.
- Recorder is configured at install, caller-derived, owner-rotatable, and enforced.
- Receipt hash is append-only; duplicate exact publication is idempotent and conflicting overwrite reverts.
- `report-api` publishes finalized receipts with a dedicated recorder key and retries durable anchor jobs; the key is never reused as a buyer key.

- [ ] **Step 1: Add model and contract-boundary failure tests**

```rust
assert_eq!(registry.record_receipt(&recorder, receipt.clone()), Ok(receipt.clone()));
assert_eq!(registry.record_receipt(&attacker, other), Err(RegistryError::Unauthorized));
assert_eq!(registry.record_receipt(&recorder, receipt.clone()), Ok(receipt));
assert_eq!(registry.record_receipt(&recorder, conflicting), Err(RegistryError::ReceiptConflict));
```

- [ ] **Step 2: Run Rust and Casper-client tests red**

Run: `cargo test --manifest-path contracts/agent-pay-registry/Cargo.toml && npm test --workspace @agent-pay/report-api -- --run test/auditor/registry.test.ts && npm test --workspace @agent-pay/mcp-server -- --run test/casperClient.test.ts`
Expected: new v2 tests fail before implementation.

- [ ] **Step 3: Implement access-controlled append-only anchors**

Store owner and recorder account hashes in named keys at installation. Read the immediate caller from
runtime context, reject non-recorder calls with user error codes, validate all hashes as lowercase
64-hex, key receipt dictionary entries by receipt hash, store block time from runtime, and never
accept a caller-supplied timestamp or recorder identity. Preserve legacy read behavior but stop using
legacy decision records for new receipt claims. The report API publisher submits the v2 call with
`AGENT_PAY_REGISTRY_RECORDER_KEY_PATH`, confirms execution through configured RPC, and marks an anchor
job complete only after it reads back the same receipt hash. Missing configuration leaves the receipt
`off_chain_verified`; it never fabricates an anchored state.

- [ ] **Step 4: Run full regression and WASM build**

Run: `cargo test --manifest-path contracts/agent-pay-registry/Cargo.toml && npm test && npm run lint && npm run build`
Expected: Rust, TypeScript, scripts, legacy flows, and contract WASM all pass.

- [ ] **Step 5: Commit locally**

```bash
git add contracts/agent-pay-registry apps/report-api apps/mcp-server
git commit -m "feat(registry): harden purchase receipt anchors"
```

### Task 14: Three-Target Integration, Retest, And UI Handoff Contract

**Files:**
- Create: `apps/report-api/test/auditor/fixtures-e2e.test.ts`
- Create: `scripts/verify-payment-auditor-e2e.ts`
- Create: `docs/agentpay-payment-auditor-api.md`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Adds `npm run auditor:e2e` with live and `--captured` modes.
- Documents exact JSON DTOs and states for Claude's later UI implementation.

- [ ] **Step 1: Add captured and local-facilitator E2E tests**

Exercise: raw Tab402 402 -> REVIEW -> signed pin -> PAY -> captured real RPC MATCH -> response
observation -> receipt verification; changed amount and payee -> BLOCK; mutated transaction ->
MISMATCH. Exercise the existing AgentPay report endpoint and a local casper-x402 reference provider
through the same normalizer.

- [ ] **Step 2: Run the captured E2E from a clean process**

Run: `npm run auditor:e2e -- --captured`
Expected: exits 0 and prints check ID, `PAY`, transaction hash, `MATCH`, and verified receipt hash.

- [ ] **Step 3: Write the non-UI handoff contract**

Document every `/v1` endpoint, auth header/cookie, request/response DTO, reason code, UI state,
privacy rule, and fixture command. Include explicit labels: `Approved by you`, `Response observed`,
`Settlement matched`, and `Off-chain verified; anchor pending`.

- [ ] **Step 4: Run repeated final verification**

Run in order:

```bash
npm test
npm test
npm run lint
npm run build
npm run auditor:e2e -- --captured
cargo test --manifest-path contracts/agent-pay-registry/Cargo.toml
git diff --check
```

Expected: every command exits 0. Compare the final test count with the 191-test baseline and require
all 191 original tests plus every new test to pass.

- [ ] **Step 5: Run an optional live read-only compatibility check**

Run: `npm run auditor:e2e -- --live-tab402 --no-settle`
Expected: a real 402 is parsed; the observed HTTPS/declared HTTP advisory is reported; no payment is
signed or sent.

- [ ] **Step 6: Commit locally and report status without pushing**

```bash
git add apps/report-api/test/auditor/fixtures-e2e.test.ts scripts/verify-payment-auditor-e2e.ts docs/agentpay-payment-auditor-api.md package.json README.md
git commit -m "test: verify AgentPay payment auditor end to end"
git status --short --branch
```

Expected: branch is ahead only by local commits; `docs/finals-upgrade-board.md` and
`hackathon-skills-v1.0.tar.gz` remain untouched and untracked; no remote push occurs.
