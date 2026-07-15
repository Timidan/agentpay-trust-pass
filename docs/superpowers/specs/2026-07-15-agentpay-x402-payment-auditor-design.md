# AgentPay Casper x402 Payment Auditor - Design Spec

**Date:** 2026-07-15
**Status:** Draft for user review
**Authors:** Timidan + Codex, with two independent Claude reviews
**Supersedes after approval:** `docs/finals-upgrade-board.md`

## 1. Decision

AgentPay will ship as an independent, non-custodial payment auditor for Casper x402 services.

> AgentPay checks a Casper x402 bill before an AI agent signs it, then verifies that the actual
> Casper transaction matched what the agent approved.

The three public answers before payment are **PAY**, **REVIEW**, and **BLOCK**. Settlement has a
separate result: **MATCH**, **MISMATCH**, **PENDING**, or **UNVERIFIABLE**.

This is a deeper version of the qualified BUIDL, not a new payment endpoint or a replacement
product. The original AgentPay already paid for evidence, verified that evidence, applied a
deterministic policy, and recorded a decision on Casper. The finals version applies the same audit
role to the payment request itself, keeps token and wallet evidence as inputs, and adds exact
post-settlement verification.

AgentPay does not become a wallet, facilitator, gateway, marketplace, escrow service, or trading
agent. The hosted AgentPay service never receives a buyer private key and never signs a buyer's
payment.

## 2. Why This Product

Casper already has the main payment and agent rails: x402 transport and facilitators, JSON-RPC and
CSPR.cloud data, CSPR.click wallet connectivity, CSPR.trade/MCP services, and contract tooling such
as Odra. The finals field also contains gateways, routers, wallets, spending controls, receipts,
escrow, and other AgentPay-named projects.

Building another payment rail would be difficult to distinguish and would weaken continuity with
the qualified submission. AgentPay instead owns the buyer-side verification gap:

1. What did the HTTP service request?
2. What did the operator allow?
3. What exact EIP-712 authorization will the wallet sign?
4. What did Casper actually execute?
5. Can those facts be recomputed from one receipt?

The strongest technical differentiator is item 4. Generic caps and receipts are common; an
independent decoder that compares the approved authorization with the finalized Casper transaction
is not.

## 3. Product Contract

AgentPay makes four bounded claims:

1. **Terms:** it parsed the service's x402 requirement and bound it to the original HTTP request.
2. **Policy:** it evaluated those terms and the draft authorization against a signed operator
   policy.
3. **Settlement:** it independently read Casper RPC and compared the finalized transaction with the
   approved authorization field by field.
4. **Observation:** an AgentPay client observed an HTTP response and integrity-bound its status and
   content hash to the receipt.

AgentPay does not claim that:

- an API response is factually correct;
- an operator-approved provider is a verified legal identity;
- a payment token is a good investment;
- a successful transaction proves service delivery;
- an on-chain receipt hash makes the receipt's claims true.

The hosted checker cannot prevent custom software from ignoring BLOCK and using a wallet directly.
AgentPay's official MCP and CLI adapters enforce the decision by refusing to invoke the local signer
unless the current check is PAY. Post-settlement verification exposes a bypass as MISMATCH or as an
unlinked transaction. This is policy enforcement at the supported signer boundary, not a claim of
on-chain custody or universal wallet control.

Public copy uses concrete payment language. "Trust Firewall", "Trust Pass", "safety layer", and
similar abstract labels are not product names or headline descriptions.

## 4. Users And Ownership

### 4.1 Human operator - primary customer

The operator funds or supervises one or more agents. In the web console they:

- connect a Casper account with CSPR.click;
- review a first-use or changed payment request;
- sign policy and provider-pin revisions;
- issue and revoke scoped agent API tokens;
- inspect checks, mismatches, and receipts.

The operator does not approve every payment. They approve durable rules and exact provider tuples so
matching repeat calls can run automatically.

### 4.2 Agent - primary runtime caller

An agent uses HTTP or MCP to submit a 402 response plus its unsigned payment authorization. It gets
a structured verdict and reason codes. On PAY, a local adapter asks the agent's own signer to sign
the exact approved digest, sends the payment to the service, and asks AgentPay to verify settlement.

### 4.3 Developer - integrator and diagnostician

A developer uses the CLI to inspect normalized terms, test policies, run a checked x402 call, verify
a transaction, and verify a receipt. CLI output and exit codes use the same fields and reason codes
as HTTP, MCP, and the web console.

The same `check_id`, policy hash, evidence snapshot, verdict, authorization digest, settlement proof,
and receipt move across all three surfaces. There are not three separate products.

## 5. UX Approach

Three custody approaches were considered:

| Approach | Description | Decision |
|---|---|---|
| A. Operator console | Agent signs locally; UI manages policies and reviews | Closest fit, but incomplete without signed operator actions |
| B. Hosted wallet | AgentPay stores keys and executes payments | Rejected: custody risk and loss of audit independence |
| C. Read-only explorer | AgentPay only inspects pasted requests and transactions | Rejected: too detached from the real payment workflow |

The selected design is **A+**: an operator console backed by signed Casper policy revisions, with
local agent signing and automatic repeat payments.

CSPR.click is used for human identity, session challenges, policy changes, pins, denies, and token
administration. It is not placed in every autonomous payment loop. Agent and CLI signers remain on
the user's machine. This follows Casper's agent direction: explicit human control over scope, then
machine execution inside that scope.

## 6. Primary Product Flows

### 6.1 First use

1. An agent calls a service and receives HTTP 402.
2. The local AgentPay adapter captures the original method, URL, body hash, selected safe headers,
   and the 402 payment requirement.
3. The adapter creates an unsigned `transfer_with_authorization` intent with a payer public key,
   payer account hash, payee, amount, validity window, and nonce.
4. AgentPay normalizes the request, checks the payment asset, evaluates policy, and binds the exact
   EIP-712 digest.
5. A provider with no valid identity proof or operator pin returns REVIEW. The payment is not
   signed.
6. The check appears immediately in the operator's review queue. The UI shows the observed HTTPS
   origin, declared resource, payee, asset, amount, network, warnings, and exact policy effect.
7. The operator signs an exact provider pin or denies the tuple through CSPR.click.
8. The agent rechecks the same request. If every hard check passes, AgentPay returns PAY with
   `basis: operator_pinned` and the approved authorization digest.
9. The local signer signs only that digest. The hosted AgentPay service never receives the key.
10. After the call, AgentPay independently verifies the finalized Casper transaction and records
    the client-observed response hash in a purchase receipt.

### 6.2 Repeat use

1. A later request matches the pinned origin, payee, asset, network, resource scope, and ceiling.
2. The signed operator policy still permits the spend and the authorization is fresh and unique.
3. AgentPay returns PAY without interrupting the operator.
4. Any material tuple change reopens REVIEW or produces BLOCK, according to the reason matrix.

### 6.3 Failure proof

Changing the amount, payee, asset package, network, nonce, validity window, payer, or authorization
digest is visible as an expected-versus-received diff. A hard mismatch returns BLOCK before signing.
If a different transaction is nevertheless submitted, post-settlement verification returns
MISMATCH and the receipt cannot display a matched purchase.

## 7. Architecture

```text
paid HTTP service
    | 402 requirement
    v
local AgentPay adapter (HTTP/MCP/CLI)
    | original request + 402 + unsigned authorization
    v
report-api
    |-- x402 normalizer and canonical hasher
    |-- payment-asset evidence adapter
    |-- signed operator policy engine
    |-- authorization binder
    |-- Casper RPC settlement verifier
    |-- receipt builder and registry publisher
    `-- SQLite repository
          ^
          |
web operator console + CSPR.click

On PAY only:
local signer -> paid service/facilitator -> Casper Testnet
                                      |
                                      `-> transaction hash -> report-api verifier
```

### 7.1 Repository boundaries

- `packages/agent-pay-core`: pure schemas, canonicalization, hashing, reason codes, policy evaluation,
  authorization comparison, settlement comparison, and receipt verification. It performs no
  network, filesystem, database, wallet, or UI work.
- `apps/report-api`: the hosted authority for checks, policy namespaces, reservations, RPC reads,
  evidence acquisition, durable storage, receipt construction, and registry publication.
- `apps/mcp-server`: a thin AgentPay API client plus optional local checked-call orchestration. A
  configured key path is read only by the local process, never transmitted to AgentPay.
- `apps/cli`: the same thin client and local orchestration exposed as shell commands.
- `apps/web`: the operator console. It never contains a buyer private key and does not perform a
  paid checkout in P0.
- `contracts/agent-pay-registry`: a minimal v2 receipt-hash anchor with recorder attribution and
  append-only semantics. It does not decide whether a payment is safe.

The web and MCP applications do not open the database directly. All durable state is owned by
`report-api`, preventing duplicated business rules and storage races.

### 7.2 External dependencies and their exact jobs

| Dependency | Job | Not delegated to it |
|---|---|---|
| Casper JSON-RPC | Transaction and contract-state truth | Policy, normalization, or receipt interpretation |
| CSPR.click | Human connection and signatures | Agent payment custody or per-call approval |
| Casper x402 libraries | Typed authorization construction and validation | Operator policy or settlement verdict |
| CSPR.cloud | Optional metadata/indexing enrichment | Final settlement truth |
| Paid service facilitator | Submit/settle the service payment | AgentPay verdict or receipt verification |

The official or operator-configured Casper RPC is the settlement source of truth. CSPR.cloud
unavailability may remove enrichment but cannot turn an unverified transaction into MATCH.

## 8. Canonical Data Model

Every AgentPay artifact hash uses RFC 8785 JSON Canonicalization Scheme bytes and SHA-256. The x402
authorization digest continues to use its protocol-defined EIP-712 algorithm. Raw secrets,
authorization headers, cookies, and response bodies are never stored.

### 8.1 `OriginalRequest`

- HTTP method, normalized absolute URL, observed scheme, origin, and path;
- SHA-256 body hash and byte length;
- hashes of explicitly allowed content negotiation headers;
- capture timestamp and adapter version.

### 8.2 `PaymentTerms`

- x402 version and selected acceptance index;
- scheme, CAIP-2 network, asset package hash, integer atomic amount, and payee account hash;
- resource URL, description, MIME type, timeout, and preserved extension hashes;
- observed-versus-declared resource comparison;
- canonical requirement hash.

Amounts remain atomic integers in core logic. Display decimals come from verified on-chain token
metadata, not solely from untrusted `extra` fields.

### 8.3 `AuthorizationIntent`

- EIP-712 domain and type version;
- payer public key and derived payer account hash;
- `from`, `to`, `amount`, `valid_after`, `valid_before`, and 32-byte nonce;
- asset package, network, digest, and optional final signature hash.

### 8.4 `EvidenceSnapshot`

- observed Casper block hash and height;
- payment package existence and active contract hash;
- required entry point and parameter shape;
- on-chain name, symbol, decimals, supply/admin signals when available;
- payee account existence and optional CSPR.name display label;
- explicit `missing` and `source_errors` arrays;
- canonical evidence hash.

### 8.5 `PolicyDecision`

- `check_id`, operator account, policy version/hash, and evaluation time;
- PAY, REVIEW, or BLOCK;
- stable reason codes with expected and received values;
- decision basis: `operator_pinned` in P0 and `signed_offer` when that P1 adapter is enabled;
- advisories, reservation amount, and expiry;
- hashes of the request, terms, authorization, and evidence.

### 8.6 `SettlementProof`

- transaction hash, RPC URL identifier, block hash/height, and finality observation;
- decoded transaction version, chain, target, entry point, and named arguments;
- execution result and field-level comparison;
- MATCH, MISMATCH, PENDING, or UNVERIFIABLE;
- proof hash and verification time.

### 8.7 `PurchaseReceipt`

- schema version and immutable receipt ID;
- all hashes above plus the complete non-secret normalized artifacts;
- signed policy revision and operator-pin reference;
- settlement proof;
- response observation: observer version, status, content type, byte length, and content hash;
- on-chain registry anchor status and transaction hash;
- canonical receipt hash.

## 9. Pre-Payment Evaluation

### 9.1 Definitive verdict requirement

PAY is only possible when the request includes an unsigned authorization intent. A pasted 402
without payer and authorization fields may be parsed and inspected, but its state is REVIEW with
`authorization_required`. The UI calls this "Needs payer details", not "safe".

The evaluator runs in this order:

1. schema and size validation;
2. original-request and declared-resource binding;
3. network and payment-scheme support;
4. payment-asset structural evidence;
5. provider identity or operator pin;
6. operator policy and atomic spend reservation;
7. authorization field equality, signature digest construction, freshness, and replay checks.

The first BLOCK does not hide later failures. All independently computable reasons are returned so
the UI can show one complete diff.

### 9.2 Verdict matrix

**BLOCK** is required for:

- malformed or ambiguous x402 terms;
- unsupported payment scheme or network;
- missing asset package, wrong package, or missing `transfer_with_authorization` entry point;
- declared decimals that change the displayed value relative to on-chain decimals;
- operator deny, amount/cumulative cap breach, disallowed asset, payee, origin, or resource;
- expired or not-yet-valid authorization;
- reused nonce or active replay key;
- any inequality between selected terms and `from/to/amount/validity/nonce/public_key` intent;
- invalid recognized signed offer when signed-offer support is enabled.

**REVIEW** is required for:

- first use with no valid signed provider proof and no active operator pin;
- missing payer or authorization intent in an interactive inspection;
- a provider tuple changed outside a hard deny rule;
- mandatory evidence temporarily unavailable;
- unrecognized x402 extensions that claim identity or modify payment semantics;
- testnet resource inconsistencies allowed by the operator's policy template.

**PAY** requires:

- no BLOCK reason;
- all mandatory structural evidence;
- an active provider basis supported by the running build (`operator_pinned` in P0);
- a signed operator policy that allows the exact request;
- an exact, fresh, unreplayed authorization intent;
- an atomically reserved amount inside the configured limits.

PAY may include non-payment advisories, but every advisory remains visible in the API, UI, and
receipt. A provider pin can satisfy the operator's provider decision; it cannot override malformed
terms, asset structure, policy limits, authorization mismatch, expiry, or replay.

### 9.3 Spend reservations

To prevent concurrent agents from passing the same daily cap, a PAY verdict creates an atomic,
short-lived reservation in SQLite. It is consumed only by a matching finalized settlement and is
released on expiry or explicit cancellation. A check cannot be reused after consumption. The
reservation expiry cannot exceed the authorization's `valid_before` value.

### 9.4 Signed policy contract

An operator policy is an immutable, signed revision containing:

- operator public key, policy ID, monotonically increasing revision, issue time, and effective time;
- allowed CAIP-2 networks and x402 schemes;
- allowed payer public keys for each agent token;
- per-asset daily atomic caps and UTC accounting windows;
- maximum authorization lifetime and concurrent reservations;
- explicit origin, payee, asset, and resource denies;
- evidence freshness limits and which optional token signals require REVIEW;
- testnet tolerance flags, including whether a pinned HTTPS origin may accept a declared HTTP
  resource advisory.

There is no silent unlimited policy. Until the operator signs a policy with an asset cap, checks for
that asset remain REVIEW. When approving a provider, the UI presets the per-call ceiling to the
current quoted atomic amount; the operator may raise it deliberately before signing. The finals
template permits only `casper:casper-test`, uses a maximum 900-second total authorization window,
requires the remaining lifetime to fit the service's `maxTimeoutSeconds`, treats investment-style
token signals as advisories, and still hard-blocks tuple, authorization, replay, and structural asset
failures. The 900-second window is required by the observed Casper x402 flow, which uses an earlier
`valid_after` value while leaving no more than the service timeout after submission.

### 9.5 Reason-code contract

Reason codes are stable machine identifiers. Copy may improve without changing integrations.

| Code | Default result | Meaning |
|---|---|---|
| `invalid_payment_required` | BLOCK | The 402 payload is malformed, oversized, or ambiguous |
| `unsupported_x402_version` | BLOCK | The payload is not supported x402 v2 |
| `unsupported_scheme` | BLOCK | The selected acceptance is not Casper exact payment |
| `unsupported_network` | BLOCK | CAIP-2 network is outside signed policy |
| `resource_scheme_mismatch` | REVIEW on testnet | Observed and declared schemes differ |
| `resource_origin_mismatch` | BLOCK | Observed and declared hosts differ |
| `asset_package_not_found` | BLOCK | Casper cannot resolve the selected package |
| `authorization_entrypoint_missing` | BLOCK | The payment contract lacks the required entry point |
| `asset_decimals_mismatch` | BLOCK | Declared decimals conflict with on-chain state |
| `evidence_unavailable` | REVIEW | A mandatory evidence source is not fresh or reachable |
| `provider_unapproved` | REVIEW | No active positive provider basis exists |
| `provider_tuple_changed` | REVIEW | The request no longer matches an active pin |
| `signed_offer_invalid` | BLOCK | An enabled recognized proof fails validation |
| `operator_denied` | BLOCK | A signed deny matches the request |
| `policy_cap_missing` | REVIEW | No signed cap covers this asset |
| `policy_per_call_exceeded` | BLOCK | Amount exceeds the provider ceiling |
| `policy_daily_cap_exceeded` | BLOCK | Settled plus reserved amount exceeds the daily cap |
| `authorization_required` | REVIEW | No complete unsigned authorization intent was supplied |
| `authorization_field_mismatch` | BLOCK | Terms and authorization differ; field diff is attached |
| `authorization_not_yet_valid` | BLOCK | `valid_after` is in the future outside clock tolerance |
| `authorization_expired` | BLOCK | `valid_before` or check reservation has expired |
| `authorization_replay` | BLOCK | Nonce or replay key has already been used or reserved |
| `settlement_pending` | PENDING | Transaction is not finalized yet |
| `settlement_rpc_unavailable` | UNVERIFIABLE | No configured RPC supplied authoritative data |
| `settlement_shape_unsupported` | UNVERIFIABLE | Transaction version or layout is not understood |
| `settlement_field_mismatch` | MISMATCH | Finalized transaction differs from approval |
| `settlement_execution_failed` | MISMATCH | Finalized execution contains an error |

## 10. Provider Approval And Identity

P0 does not invent `/.well-known/agentpay-service.json`. The product model permits only two positive
bases:

1. `signed_offer`: a recognized x402 signed-offer extension whose valid signature binds the observed
   origin, resource, payee, asset, network, amount constraints, issue time, and expiry;
2. `operator_pinned`: a Casper-signed operator decision for an exact tuple.

P0 implements `operator_pinned`. The core schema reserves `signed_offer`, but it cannot produce PAY
until the recognized extension verifier in P1 is enabled and covered by compatibility tests. This
keeps the finals build from treating an assumed or partially implemented signature format as proof.

An absent signed offer means identity is unknown, not dangerous. An invalid recognized signature is
a BLOCK because represented proof was altered or false.

An operator pin contains:

- operator public key and monotonically increasing policy revision;
- observed HTTPS origin;
- payee account hash;
- payment asset package and CAIP-2 network;
- optional resource path prefix;
- per-call atomic ceiling and expiry;
- check ID that prompted the approval;
- canonical action hash and Casper signature.

The UI labels this basis **Approved by you**, never **Verified provider**. A CSPR.name result may be
shown as a display label, but it is not proof that a domain controls a payee.

For the finals testnet policy, an HTTP resource declared by a service reached over HTTPS is a REVIEW
advisory that an operator may explicitly accept in a pin. It is never silently normalized away.
Mainnet policy is outside P0 and will treat a downgrade as BLOCK by default.

## 11. Payment-Asset Evidence

The existing token and wallet evidence service remains load-bearing, but its policy semantics change
when the token is being spent rather than considered as an investment.

Mandatory payment-asset checks are:

- the package exists on the selected Casper network;
- the active contract and runtime can be resolved;
- `transfer_with_authorization` exists with the expected parameter structure;
- the selected package hash exactly matches the 402 terms and authorization domain;
- on-chain decimals match any declared decimals;
- the asset is allowed or pinned by the signed operator policy.

Mint authority, supply mutability, holder concentration, token age, and liquidity remain evidence.
They may produce REVIEW under an operator policy, but they are not default BLOCK reasons for a
service-credit token. A centralized or mintable payment token can be intentional. This prevents the
old investment-risk rules from incorrectly rejecting legitimate x402 payment assets.

## 12. Authorization Binding

The local adapter creates the draft authorization before asking a wallet to sign. AgentPay computes
the EIP-712 digest with `@casper-ecosystem/casper-eip-712` and returns that digest on PAY.

The local signer boundary must enforce:

1. it receives the canonical typed data returned or recomputed from the approved check;
2. the wallet-returned digest equals `approved_authorization_digest`;
3. the returned public key equals the intended payer public key;
4. the signature verifies locally before the payload is sent;
5. any post-check mutation requires a new check.

The hosted API may receive the public key, typed fields, digest, and signature hash. It never receives
the private key or a wallet recovery secret.

## 13. Casper Settlement Verification

`info_get_transaction` from official or configured Casper RPC is decoded independently of the paid
service and its facilitator. For the Casper x402 exact scheme, MATCH requires all of the following:

- CAIP-2 network maps to transaction `payload.chain_name`;
- transaction is a supported `Version1` shape;
- target is `Stored.ByPackageHash` with the exact payment asset package;
- entry point is exactly `transfer_with_authorization`;
- named arguments `from`, `to`, `amount`, `valid_after`, `valid_before`, `nonce`, `public_key`, and
  `signature` equal the approved authorization;
- `from` is the account hash derived from `public_key`;
- the transaction's EIP-712 signature is valid for the approved digest and public key;
- execution is finalized and `error_message` is null.

The transaction initiator is not used as the payer source of truth. A facilitator or fee sponsor may
submit a transaction; in other flows the payer may submit it directly. AgentPay uses the authorization
arguments and verifies their relationship instead of inferring intent from the initiator.

Results are defined as:

- **MATCH:** every required field matches and execution finalized successfully;
- **MISMATCH:** the transaction finalized but one or more required fields differ, the signature is
  invalid, or execution failed;
- **PENDING:** the transaction is known or plausibly in flight but not finalized before the current
  poll deadline;
- **UNVERIFIABLE:** RPC is unavailable, the transaction is unknown after the bounded lookup window,
  or its version/shape is unsupported.

Unknown data never defaults to MATCH. RPC retries use bounded exponential backoff and fail over only
to configured Casper RPC endpoints. Every proof records which endpoint supplied the final data.

### 13.1 Feasibility proof captured on 2026-07-15

The public Tab402 endpoint returned a real x402 v2 requirement for
`POST https://tab402.fly.dev/v1/speak`:

- network `casper:casper-test`;
- amount `100000000` atomic units;
- asset package `50ec5690bde5e72f5152cb5154119eb706961e376b19050534a95a13ead8baaf`;
- payee `00b728a64f7e93d583c1b6f291ff26f4fd2f257d51ed1bb788c417b4b5225436d8`;
- timeout 300 seconds;
- declared resource `http://tab402.fly.dev/v1/speak`, despite the observed HTTPS request;
- no signed-offer extension.

Casper Testnet transaction
`2458f77bcd56ae960c02d0dfba616c63f3008c7ee7e87bcfd861c4da87e774b4` was returned by
`https://node.testnet.casper.network/rpc` as a structured Version1 transaction. It exposes the exact
package target, `transfer_with_authorization` entry point, all eight named authorization arguments,
and a finalized execution result with no error. The amount, asset, and payee match the live 402.

This proves that exact post-settlement comparison is implementable without a proprietary indexer.
The captured 402 and RPC response become immutable regression fixtures; the live endpoint remains an
optional E2E target.

## 14. Receipts And On-Chain Anchor

A receipt binds request, terms, evidence, policy, authorization, settlement, and response observation.
Verification recomputes every canonical hash and rechecks Casper RPC. A modified amount, payee,
request, policy, response hash, or transaction reference invalidates the receipt.

Response language is deliberately narrow:

- **Response observed:** the AgentPay local client received bytes and recorded their hash.
- **Settlement matched:** Casper executed the approved authorization.
- **Receipt verified:** canonical hashes, signatures, and referenced Casper data recompute.

None means the response content was correct.

The existing registry's public, caller-supplied decision records are not sufficient as an
authoritative AgentPay receipt. P0 includes a minimal registry v2 upgrade:

- only the configured AgentPay recorder can publish an AgentPay receipt anchor;
- the contract derives recorder attribution from runtime context;
- receipt hashes are append-only and cannot be overwritten;
- contract block time is authoritative;
- the anchor stores only receipt hash, policy hash, settlement transaction hash, outcome, and
  recorder attribution;
- recorder rotation is owner-controlled and observable.

The anchor proves only that the configured AgentPay recorder published a specific receipt hash at a
Casper block. Independent receipt and RPC verification still establishes the actual fields. Until
registry v2 is deployed and verified, the public UI must label receipts **Off-chain verified** and
must not show an AgentPay on-chain attestation claim.

## 15. Persistence And Authentication

### 15.1 Persistence

`report-api` owns one SQLite database through Node's built-in `node:sqlite` API. This is the minimum
durable component for the single-instance finals deployment and avoids a hosted database dependency.
It uses WAL mode, foreign keys, explicit migrations, transactions for reservations and receipt
finalization, and a persistent droplet volume with automated snapshots.

Storage is behind repository interfaces so a future PostgreSQL adapter does not change core logic.
The database stores operators, signed policy revisions, pins/denies, hashed API tokens, checks,
reservations, evidence snapshots, settlements, response observations, receipts, and anchor jobs.

### 15.2 Human authentication

1. The API issues a one-use, five-minute challenge containing domain, network, nonce, issue time,
   expiry, and requested action.
2. CSPR.click `signMessage` signs the canonical challenge.
3. The API verifies the signature and issues a short-lived HttpOnly, Secure, SameSite cookie.
4. Every policy, pin, deny, or API-token revision also carries its own signed canonical action and a
   monotonically increasing revision, preventing replay and hidden server-side edits.

### 15.3 Agent authentication

Operators issue revocable API tokens scoped to checks, settlement verification, and receipt
observations. Each token also names an agent and its allowed payer public keys. Tokens are displayed
once, stored only as hashes server-side, and cannot change policy or submit a check for a different
payer. MCP and CLI use these tokens over HTTPS. Public receipt verification requires no
authentication.

### 15.4 Privacy and sharing

Checks, policies, provider decisions, and receipts are private to the operator by default. Their GET
and list endpoints require the operator session or a correctly scoped agent token. An operator may
create an expiring, read-only receipt share token; revoking it does not alter the receipt or its
on-chain hash. `POST /v1/receipts/verify` accepts a caller-supplied receipt and returns a result
without publishing or retaining that receipt. Registry v2 stores hashes only, so request URLs and
response metadata are not disclosed on-chain.

## 16. Interfaces

### 16.1 HTTP

- `POST /v1/auth/challenges` - issue a signed-session or operator-action challenge.
- `POST /v1/auth/sessions` - verify a CSPR.click challenge signature.
- `GET /v1/policies/current` - return the signed active policy.
- `POST /v1/policies/revisions` - install a signed policy revision.
- `POST /v1/provider-decisions` - install a signed pin or deny revision.
- `POST /v1/agent-tokens` and `DELETE /v1/agent-tokens/:id` - manage scoped runtime access.
- `POST /v1/probes` - perform an authenticated, rate-limited public URL probe and capture a 402.
- `POST /v1/checks` - create or re-evaluate a payment check.
- `GET /v1/checks/:id` - retrieve normalized terms, evidence, reasons, and status.
- `POST /v1/checks/:id/cancel` - release an unused reservation.
- `POST /v1/checks/:id/verify-settlement` - fetch and compare a Casper transaction.
- `POST /v1/checks/:id/response-observations` - record client-observed response metadata and hash.
- `GET /v1/receipts/:id` - return the human and machine-readable receipt.
- `POST /v1/receipts/:id/shares` and `DELETE /v1/receipts/:id/shares/:shareId` - manage expiring,
  read-only receipt links.
- `POST /v1/receipts/verify` - verify an uploaded receipt without storing it.

All errors use a stable envelope with `code`, `message`, `retryable`, `field`, `expected`, and
`received`. HTTP status is transport state; product verdicts remain explicit response fields.

### 16.2 MCP

- `check_x402_payment`
- `verify_x402_settlement`
- `get_payment_receipt`
- `call_x402_service` for optional local checked-call orchestration

MCP cannot anonymously pin, deny, or mutate policy. Administrative actions remain signed HTTP/UI/CLI
operations.

### 16.3 CLI

- `agentpay check`
- `agentpay verify-settlement`
- `agentpay call`
- `agentpay policy show|set`
- `agentpay provider pin|deny|list`
- `agentpay receipt show|verify`

Exit codes are `0=PAY/MATCH/verified`, `2=REVIEW/PENDING`, `3=BLOCK/MISMATCH`, and
`4=UNVERIFIABLE/client error`.

## 17. Web Operator Console

The first screen is the usable console, not a marketing landing page.

### 17.1 Information architecture

- **Review queue:** first-use and changed requests, ordered by urgency and authorization expiry.
- **Checks:** all PAY, REVIEW, and BLOCK decisions with service, amount, agent, and time.
- **Policies:** readable limits and exact signed revision history.
- **Providers:** pinned and denied origin/payee/asset tuples.
- **Receipts:** settlement and delivery states with independent verification.
- **Integrate:** concise HTTP, MCP, and CLI examples using the operator's selected environment.

### 17.2 Check detail

One continuous payment record, not a grid of generic metric cards:

1. observed service and requested resource;
2. amount, asset, payee, network, and authorization validity;
3. policy rules beside the fields they evaluated;
4. evidence and missing evidence;
5. expected-versus-received diffs;
6. operator action for REVIEW;
7. settlement proof and response observation after payment.

Buttons are concrete commands: **Approve provider**, **Deny provider**, **Cancel reservation**, and
**Verify transaction**. Hashes and raw JSON remain available in expandable technical sections.

### 17.3 Required states

The UI implements loading, empty queue, disconnected operator, invalid signature, expired challenge,
terms-only review, first-use review, pin-signing, denied, PAY, BLOCK, reservation expired, settlement
pending, RPC unavailable, MATCH, MISMATCH, response observed, response failed, receipt pending anchor,
receipt anchored, and tampered receipt states.

The responsive target is 320 px through wide desktop. There is no horizontal overflow, nested-card
layout, decorative glass, generic hero, hidden focus state, or motion without reduced-motion behavior.
Playwright screenshots and browser console checks are release gates.

## 18. Safe 402 Acquisition

Agents normally capture the 402 locally and submit structured data. The UI also supports:

1. pasting a raw x402 requirement or `PAYMENT-REQUIRED` header;
2. probing a public service URL with GET/POST and a JSON body.

Server-side probes are HTTPS-only, except explicit localhost development mode. They resolve DNS and
reject private, loopback, link-local, multicast, and metadata-service addresses on every redirect.
They have strict connect/read timeouts, a redirect limit, request and response size limits, JSON-only
request bodies, no user-supplied authorization/cookie headers, and redacted logs. The response body is
not persisted; only allowed 402 fields and hashes are kept.

Authenticated or arbitrary-header calls run in the local CLI/MCP adapter, not through the hosted
probe service.

## 19. Compatibility Targets And Demo Choice

AgentPay supports all three provider targets through the same protocol path:

| Target | Purpose | Expected finals use |
|---|---|---|
| Tab402 public endpoint | Independent live Casper x402 compatibility | Preferred live demo after a reliability run |
| Existing AgentPay report endpoint | Continuity with the qualified BUIDL and paid token/wallet evidence | Controlled public fallback and regression target |
| Local official casper-x402 reference provider | Deterministic protocol and failure testing | CI and offline demo fallback |

The demo target is chosen by a pre-demo health check, not by changing product logic. Tab402 is used
when its 402 and settlement path pass. The existing AgentPay endpoint is used when a fully controlled
live target is safer. The local reference uses captured real fixtures and is visibly labeled
**Captured Casper Testnet run**; it never displays a fake transaction hash or pretends to be live.

One coherent demonstration covers all three users:

1. A developer starts `agentpay call` or the equivalent MCP tool.
2. The first third-party request returns REVIEW and appears in the human operator's web queue.
3. The operator connects CSPR.click and signs an exact provider pin.
4. The agent rechecks, gets PAY, signs locally, and calls the service.
5. The UI moves from PENDING to MATCH using the real Casper transaction.
6. A tampered amount or payee returns BLOCK with a field-level diff.
7. The receipt verifies request, policy, authorization, settlement, and observed response hash.

## 20. Scope

### 20.1 P0 - finals product

- Canonical x402 v2 Casper requirement parsing and original-request binding.
- Payment-specific token/account evidence with explicit missing evidence.
- Signed operator sessions, policies, provider pins/denies, and scoped agent tokens.
- Atomic per-call and cumulative spend reservations.
- Unsigned authorization intent binding before any local signature.
- Exact Casper Version1 `transfer_with_authorization` settlement decoding.
- Durable checks, policies, evidence, receipts, and restart recovery in SQLite.
- Hardened registry v2 receipt-hash anchor, with honest off-chain verification while an individual
  anchor transaction is pending.
- Shared HTTP, MCP, CLI, and operator-console concepts and reason codes.
- Safe URL probe plus raw 402 import.
- Tab402, AgentPay report endpoint, and local casper-x402 compatibility fixtures.
- Responsive Playwright E2E and public deployment at `agentpay.timidan.xyz`.

### 20.2 P1 - only after every P0 gate passes

- Recognized signed-offer verification when present in a provider response.
- Signed service response receipts when a service supports them.
- Service history derived only from AgentPay-observed receipts.
- A second independent public provider if one is more reliable than the current targets.
- CSPR.cloud enrichment that does not affect settlement truth.

### 20.3 Explicit cuts

- Hosted buyer wallet or key custody.
- Direct checkout from the web console.
- New facilitator, gateway, router, escrow, refund, or dispute system.
- Marketplace, universal reputation score, or service directory.
- Custom AgentPay provider manifest presented as an x402 standard.
- Broad token investment scoring as a hard payment gate.
- Mainnet payments during the finals build.
- Generic redesign work that does not serve the check, review, settlement, or receipt flows.

## 21. Error And Recovery Rules

- RPC outage returns UNVERIFIABLE and queues a bounded retry; it never changes a prior MISMATCH to
  MATCH without a new proof.
- Evidence-source outage returns REVIEW unless cached evidence is inside its signed freshness window.
- A policy changes only for new checks. Existing receipts retain the exact signed policy revision.
- A pin revision invalidates affected open PAY reservations so agents must recheck.
- A process restart reconstructs reservations and background anchor jobs from SQLite.
- Duplicate check submissions with the same idempotency key return the original check.
- Duplicate settlement submissions are idempotent; conflicting transaction hashes are rejected.
- An expired PAY cannot be revived. The agent creates a new authorization nonce and check.
- A finalized MISMATCH quarantines the reservation instead of releasing it automatically. The
  decoded actual spend, when trustworthy, is counted against operator limits until the operator
  resolves the incident.
- Registry publication failure leaves a verifiable off-chain receipt and a visible pending/failed
  anchor state; it does not invalidate a proven settlement.

## 22. Test Strategy And Release Gates

### 22.1 Core tests

- Table tests for every reason code and verdict transition.
- Property tests for canonicalization, hash stability, amount integer safety, and order independence.
- Authorization tests for every field mutation, replay, expiry edge, public-key/account-hash
  derivation, digest, and signature curve.
- Payment-asset tests proving investment-only signals do not incorrectly hard-block service tokens.
- Receipt round-trip and one-field tamper tests.

### 22.2 Integration tests

- Real captured Tab402 402 parses to the exact network, amount, asset, and payee.
- Its HTTPS/declared-HTTP difference and absent signed offer produce REVIEW before pinning.
- A signed exact pin allows a fresh authorization; tuple drift reopens REVIEW or BLOCK.
- A permissive or malicious facilitator cannot make altered settlement fields return MATCH.
- The captured real Testnet RPC transaction decodes to all eight authorization fields.
- Unknown transaction versions and RPC errors return UNVERIFIABLE.
- Reservations remain atomic under concurrent checks and recover after restart.
- A receipt survives restart; any changed field fails verification.
- Registry v2 rejects unauthorized recorders and duplicate/overwrite attempts.
- Probe tests cover SSRF, DNS rebinding, redirects, oversized bodies, timeouts, malformed headers, and
  secret redaction.

### 22.3 End-to-end tests

- First-use REVIEW -> CSPR.click-signed pin -> agent PAY -> local signature -> live Testnet settlement
  -> MATCH -> response observation -> receipt.
- Changed amount, payee, asset, network, and authorization each stop before the signer.
- Desktop and mobile UI complete the review and receipt flows without overlap, horizontal scrolling,
  console errors, inaccessible controls, or stale status.
- Public TLS deployment survives service restart and retains policies, checks, and receipts.
- The offline fallback is visibly labeled and resolves every displayed transaction against captured
  official RPC data.

### 22.4 Submission gate

AgentPay is ready for finals resubmission only when:

1. a judge can explain the product after the first check screen;
2. no hosted AgentPay process reads a buyer key;
3. PAY is impossible without a complete authorization intent and positive provider basis;
4. a real Casper transaction returns MATCH only after exact decoding;
5. tampering produces an obvious BLOCK or MISMATCH;
6. receipts persist, verify independently, and use honest delivery language;
7. registry v2 is deployed, unauthorized and duplicate writes are rejected, and pending anchors are
   labeled honestly;
8. the three-user flow passes through the public UI, HTTP/MCP, and CLI surfaces;
9. the public deployment passes desktop/mobile E2E with no console errors;
10. README, submission copy, screenshots, and video describe the same bounded product.

## 23. Success Criteria

The finals upgrade succeeds when AgentPay is usable without demo-specific shortcuts:

- an operator can connect, define limits, approve one provider, and supervise multiple agents;
- an agent can autonomously check and pay repeat Casper x402 calls without exposing its key;
- a developer can integrate or diagnose the same flow from HTTP, MCP, or CLI;
- a verifier can recompute whether a finalized Casper payment matched the approved authorization;
- token and wallet evidence strengthen the payment decision without making false investment claims;
- every public statement distinguishes operator approval, cryptographic proof, observed delivery, and
  factual correctness.

That complete product naturally produces a simple demo: first use asks the operator, repeat use pays
automatically, and any changed bill is stopped or exposed.
