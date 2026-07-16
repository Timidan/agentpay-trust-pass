# AgentPay UI Handoff

Date: 2026-07-16

## Product Contract

AgentPay checks a Casper x402 charge before the buyer signs it, then proves that the executed transfer and service response matched the approved terms.

The UI is a control surface for the existing backend. Do not change payment, policy, settlement, receipt, or registry semantics to simplify a screen. Do not add fixture transactions, pretend wallet connections, fake checks, or simulated anchored states.

## Users

1. People use the web app to inspect a charge, understand PAY / REVIEW / BLOCK, approve providers, set limits, follow settlement, and verify a receipt.
2. Agents use HTTP, MCP, or `@agent-pay/client`; the UI may show their activity but must not imply AgentPay holds their signing key.
3. Developers use `agentpay` CLI and need copyable IDs, hashes, failure reasons, and API/MCP integration details.

The primary UI workflow is for a person. Agent and developer surfaces should remain visible as integration paths, not compete with the main task.

## Main Workflow

1. Accept a service URL and HTTP method, then call `POST /v1/probes` to capture its real x402 response.
2. Submit the normalized request and `paymentRequired` data to `POST /v1/checks` with an `Idempotency-Key`.
3. Render the backend decision exactly: `PAY`, `REVIEW`, or `BLOCK`.
4. For REVIEW, show the precise unresolved reason and let the operator create a PIN or DENY provider record. Re-run a new check; never mutate the old result.
5. For PAY, make clear that approval is not payment. Signing stays in the wallet/client. The backend must never receive a buyer private key.
6. After the buyer submits, call `POST /v1/checks/:id/verify-settlement` with the real Casper transaction hash.
7. After an exact match, record the bounded service response with `POST /v1/checks/:id/response-observations`.
8. Read `GET /v1/receipts/:id` until its separate `anchorState` reaches a terminal state.

## Backend-Owned States

Payment decisions:

| State | UI meaning |
|---|---|
| `PAY` | Terms satisfy policy. The buyer may sign locally. |
| `REVIEW` | Operator action or missing evidence is required. |
| `BLOCK` | A hard rule failed. Payment must not proceed. |

Settlement verdicts must remain distinct: `match`, `pending`, `mismatch`, and `unverifiable`. Never collapse a pending or unverifiable transaction into success or failure.

Receipt anchor states returned by the API:

| State | UI meaning |
|---|---|
| `off_chain_verified` | Receipt hash verifies locally; no anchor job exists. |
| `pending` | A registry job exists or a submitted transaction is awaiting execution/readback. |
| `anchored` | Casper execution succeeded and exact dictionary readback matched. |
| `failed` | Registry submission or execution reached a terminal failure. |

The receipt body is immutable. `anchorState` is dynamic and must be rendered outside the receipt hash calculation.

## HTTP Surface

All auditor routes are under `/v1` on the report API.

| Area | Routes |
|---|---|
| Operator auth | `POST /auth/challenges`, `POST /auth/sessions` |
| Policy | `GET /policies/current`, `POST /policies/revisions` |
| Providers | `GET /provider-decisions`, `POST /provider-decisions` |
| Agent access | `POST /agent-tokens`, `DELETE /agent-tokens/:id` |
| Payment check | `POST /probes`, `POST /checks`, `GET /checks/:id`, `POST /checks/:id/cancel` |
| Settlement | `POST /checks/:id/verify-settlement` |
| Receipt | `POST /checks/:id/response-observations`, `GET /receipts/:id`, `POST /receipts/verify` |
| Sharing | `POST /receipts/:id/shares`, `DELETE /receipts/:id/shares/:shareId` |

Use the structured API error fields: `code`, `message`, `retryable`, `field`, `expected`, and `received`. Do not replace actionable backend reasons with generic toast text.

## Authentication

- Operator sessions are created from a Casper-signed, origin-bound challenge.
- Agent tokens have explicit `checks:write`, `settlements:write`, `observations:write`, and `receipts:read` scopes.
- Provider records and policy revisions are signed, versioned, and append-only.
- Session or agent bearer tokens may reach the API. Buyer private keys may not.
- Never persist bearer tokens in source, URL query parameters, analytics, or browser logs. Receipt share tokens are the only query-token exception and are revocable/expiring.

## Verified Testnet Trail

| Artifact | Value |
|---|---|
| Registry install | `2c53ec7d38757c7c252fa16acc4c099d1c53136c852f908821989ac42f0fa4e6` |
| Registry package | `hash-050b717617b9c79535983d9e0cc2ba21dd379ce3450498601dba64324a2dcd1a` |
| Registry contract | `hash-b5e129dca5548f1bbe225db73042d08ab5b35cc976c3ac955bf2fe2a8cd92ee3` |
| Checked settlement | `2491e2cfc3fc2c299ebdfb25725a8c8a194918b813f8c7596eec13bce3cd7911` |
| Purchase receipt | `0f253ef7ce564e046d23abf42c8cabdad7b1deeab2fa4fafd2e3619f93cdf231` |
| Receipt anchor | `eb30265877e0bbb549efa6f09dbd8beb29efc31191724ce082fca45b6dddddfc` |
| Recorder account | `account-hash-0a6c747e7b07f063349ef66909a82c84e29095eaf7774df62428d09e49aa8b80` |

Use explorer links derived from these values when useful. Label them Testnet. Do not hard-code them as the result of every future payment.

## Existing Non-UI Clients

- Shared client: `packages/agent-pay-client`
- CLI: `apps/cli`; includes `check`, `verify-settlement`, `call`, policy/provider controls, and receipt show/verify
- MCP: `apps/mcp-server`; includes `check_x402_payment`, `verify_x402_settlement`, and `get_payment_receipt`
- Canonical rules and receipt verification: `packages/agent-pay-core`

Reuse canonical types and verification functions. Do not reimplement decision logic in React.

## Local Run

```bash
npm run dev
```

Expected endpoints:

- web: `http://127.0.0.1:5173`
- report API: `http://127.0.0.1:4021`
- MCP HTTP bridge: `http://127.0.0.1:3001`

For the captured Testnet setup, load the uncommitted local environment before starting the report API. Never expose its secrets through Vite environment variables.

## Verification Baseline

- `npm run lint`: pass across all six workspaces.
- `npm run smoke`: pass, including 396 JS/TS tests, one opt-in external probe skipped, 8 Rust tests, every workspace build, strict Wasm validation, and live API/MCP probes.
- Strict registry Wasm: 106,836 bytes, MVP plus mutable-globals only.
- `pnpm audit --prod`: no known vulnerabilities.
- Semgrep TypeScript/Node scan: 65 paths, zero findings, zero scan errors.
- `npm run submission:check`: every local and Casper evidence gate passes; only the intentionally unset public GitHub and walkthrough URLs remain.
- `git diff --name-only -- apps/web`: empty at handoff.

The current production web bundle is about 630 kB before gzip and emits Vite's chunk-size warning. Treat code splitting as a UI performance task, not a reason to change backend contracts.

## UI Acceptance

- A first-time user can describe AgentPay after the first screen without protocol jargon: it checks a charge before payment.
- One continuous workflow covers probe, decision, operator action, local signing handoff, settlement, response, receipt, and anchor status.
- PAY, REVIEW, and BLOCK are visually distinct and always include concrete reasons.
- Pending, unavailable, failed, and not-checked states remain honest and recoverable.
- Long hashes, account addresses, and error fields fit on mobile and desktop without overlap.
- No key material crosses into the report API, browser logs, or committed files.
- Existing `apps/web` tests remain green, and Playwright verifies the complete desktop/mobile workflow against the real local API.

## Guardrails

- Keep the qualified paid-evidence and token-check features available, but present them as AgentPay-protected services rather than separate product identities.
- The hosted CSPR.cloud facilitator is supported but not yet proven end to end; the captured run used the self-hosted open-source facilitator.
- Token risk fields without a real source must say `not checked`; never convert absence into a clean verdict.
- The v2 registry is on Casper Testnet, not mainnet.
- Do not push until the owner reviews the UI and final evidence.
