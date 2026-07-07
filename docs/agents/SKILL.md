---
name: agentpay-trust-signal
description: Use AgentPay before deciding whether to approve, reject, or review a Casper token or package. AgentPay sells x402-paid evidence reports, verifies Merkle proofs, scores the subject with deterministic rules, and records the decision on Casper.
---

# AgentPay Trust Signal

Install:

```sh
curl $AGENT_PAY_BASE_URL/skill.md
```

That request returns this file with `$AGENT_PAY_BASE_URL` replaced by the
serving AgentPay origin. Treat this skill as the source of truth for agent
integration.

AgentPay is an evidence and payment rail for autonomous agents. It quotes an
x402-paid report, releases the report only after a Casper x402 payment, verifies
the report against a Merkle dataset root, scores the subject with deterministic
rules, and records the decision on Casper.

AgentPay never asks for, receives, stores, or transmits your private key. Your
agent signs the x402 payment with its own Casper key. If you use the local MCP
`assess_subject` shortcut, the MCP process reads your local `CASPER_SECRET_KEY_PATH`
and signs locally.

## Channels

### Primary: MCP server

Use the MCP server when your agent supports MCP tools/resources.

Stdio entrypoint:

```json
{
  "mcpServers": {
    "agent-pay": {
      "command": "pnpm",
      "args": ["--filter", "@agent-pay/mcp-server", "stdio"],
      "env": {
        "REPORT_API_URL": "$AGENT_PAY_BASE_URL",
        "AGENT_PAY_PUBLIC_ORIGIN": "$AGENT_PAY_BASE_URL"
      }
    }
  }
}
```

Skill resource:

```text
skill://agentpay
```

Read that MCP resource to load this same contract without HTTP.

### Secondary: HTTP bridge

The MCP bridge exposes the same tools over HTTP:

```sh
curl "$AGENT_PAY_BASE_URL/tools"
```

Call a tool:

```sh
curl -X POST "$AGENT_PAY_BASE_URL/tools/quote_report" \
  -H "Content-Type: application/json" \
  -d '{"subject":"hash-<64 hex package hash>","reportApiUrl":"$AGENT_PAY_BASE_URL"}'
```

If your deployment runs the bridge and seller API on separate origins, use the
bridge origin for `/tools/...` and pass the seller API origin as `reportApiUrl`.
All URLs in this skill use `$AGENT_PAY_BASE_URL` so a served skill can be
rewritten safely for one public origin.

## Tools

### `quote_report`

Quotes an x402 price for an AgentPay report scoped to a subject: a token package
hash or a Casper account. A subject is required.

Input:

```json
{
  "subject": "hash-<64 hex package hash> or account-hash-<64 hex> or public key",
  "reportApiUrl": "$AGENT_PAY_BASE_URL"
}
```

Output:

```json
{
  "quoteId": "string",
  "reportId": "string",
  "reportHash": "string",
  "datasetId": "string",
  "datasetRoot": "64 hex chars",
  "amount": "string",
  "asset": "string",
  "network": "string",
  "expiresAt": "ISO timestamp",
  "expiresInSeconds": 300,
  "paymentResource": {
    "url": "$AGENT_PAY_BASE_URL/reports/buy/<quoteId>",
    "description": "string",
    "mimeType": "application/json"
  },
  "paymentRequirements": [
    {
      "scheme": "exact",
      "network": "casper:casper-test",
      "asset": "64 hex package hash",
      "amount": "string",
      "payTo": "00 + 64 hex chars",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "Cep18x402",
        "version": "1",
        "decimals": "2",
        "symbol": "CSPR"
      }
    }
  ],
  "paymentConfigurationRequired": false,
  "paymentConfigurationReason": null,
  "paymentReadiness": {
    "status": "ready | configuration_required | facilitator_unavailable | facilitator_unsupported",
    "reason": null,
    "checkedAt": "ISO timestamp",
    "facilitatorUrl": "string",
    "checks": [],
    "supportedKind": {
      "x402Version": 2,
      "scheme": "exact",
      "network": "casper:casper-test",
      "feePayer": "64 hex chars or null"
    }
  },
  "sourceSummary": [
    {
      "product": "string",
      "network": "string",
      "subject": "string",
      "observedAt": "ISO timestamp",
      "recordHash": "string",
      "facts": {}
    }
  ]
}
```

### `payment_status`

Checks whether AgentPay's configured Casper x402 facilitator path is ready to
accept payment.

Input:

```json
{ "reportApiUrl": "$AGENT_PAY_BASE_URL" }
```

Output: the `paymentReadiness` object shown under `quote_report`.

### `registry_status`

Checks whether AgentPay's Casper registry recording path is configured and
reachable.

Input:

```json
{}
```

Output:

```json
{
  "status": "ready | configuration_required | rpc_unavailable",
  "reason": "string or null",
  "checkedAt": "ISO timestamp",
  "checks": [],
  "registryPackageHash": "64 hex chars or null",
  "recordScript": "string",
  "rpc": {
    "url": "string",
    "apiVersion": "string or null",
    "chainspecName": "string or null",
    "latestBlockHeight": 0,
    "latestBlockHash": "string or null"
  }
}
```

### `buy_report`

Buys the evidence report with an x402 payment payload.

Input:

```json
{
  "reportApiUrl": "$AGENT_PAY_BASE_URL",
  "quoteId": "quote id from quote_report",
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {},
    "resource": {},
    "payload": "buyer-signed Casper x402 payload"
  }
}
```

Output:

```json
{
  "datasetId": "string",
  "datasetRoot": "64 hex chars",
  "reportId": "string",
  "report": {
    "id": "string",
    "product": "string",
    "network": "string",
    "subject": "string",
    "observedAt": "ISO timestamp",
    "sourceUrl": "string",
    "facts": {},
    "rawHash": "string"
  },
  "reportHash": "string",
  "proof": [{ "position": "left | right", "hash": "64 hex chars" }],
  "evidence": [],
  "paymentReceiptHash": "string",
  "payment": {
    "scheme": "x402",
    "status": "settled",
    "transactionHash": "64 hex chars",
    "confirmation": {
      "rpcUrl": "string",
      "method": "info_get_transaction",
      "apiVersion": "string or null",
      "executionState": "executed | pending | unknown",
      "blockHash": "string or null",
      "attempts": 1,
      "observedAt": "ISO timestamp"
    },
    "facilitatorHash": "string"
  }
}
```

### `verify_report`

Verifies a report Merkle proof against the dataset root.

Input:

```json
{
  "reportApiUrl": "$AGENT_PAY_BASE_URL",
  "record": {
    "id": "string",
    "product": "string",
    "network": "string",
    "subject": "string",
    "observedAt": "ISO timestamp",
    "sourceUrl": "string",
    "facts": {},
    "rawHash": "string"
  },
  "proof": [{ "position": "left", "hash": "64 hex chars" }],
  "datasetRoot": "64 hex chars"
}
```

Output:

```json
{ "verified": true }
```

### `record_decision`

Records an AgentPay trust decision through the Casper boundary.

Input:

```json
{
  "datasetId": "string",
  "datasetRoot": "64 hex chars",
  "reportHash": "string",
  "paymentReceiptHash": "string",
  "decision": "approved | rejected | needs_review"
}
```

Output:

```json
{
  "mode": "submitted",
  "txHash": "string",
  "hashKind": "transaction | deploy",
  "confirmation": {
    "rpcUrl": "string",
    "method": "info_get_transaction | info_get_deploy",
    "apiVersion": "string or null",
    "executionState": "executed | pending | unknown",
    "blockHash": "string or null",
    "attempts": 1,
    "observedAt": "ISO timestamp"
  },
  "input": {
    "datasetId": "string",
    "datasetRoot": "64 hex chars",
    "reportHash": "string",
    "paymentReceiptHash": "string",
    "decision": "approved | rejected | needs_review"
  }
}
```

### `assess_subject`

Runs the full Trust Signal rail: quote, pay x402, verify Merkle proofs, score
deterministically, narrate, and stamp the verdict on Casper.

Input:

```json
{
  "subject": "64 hex chars or hash-<64 hex chars>",
  "reportApiUrl": "$AGENT_PAY_BASE_URL"
}
```

Output:

```json
{
  "aspect": "CLEAR | CAUTION | DANGER",
  "decision": "approved | needs_review | rejected",
  "flags": [{ "code": "string", "severity": "danger | caution", "message": "string" }],
  "notChecked": ["string"],
  "rationale": "string",
  "notCheckedNote": "string",
  "subject": { "kind": "cep18_token", "packageHash": "64 hex chars", "raw": "string" },
  "paymentReceiptHash": "string",
  "settlementTxHash": "string",
  "decisionTxHash": "string",
  "datasetRoot": "64 hex chars",
  "policyHash": "64 hex chars",
  "explorerUrl": "https://testnet.cspr.live/transaction/<hash>"
}
```

## Flow

### One-call MCP flow

Use `assess_subject` when your agent can run the local MCP server with its own
Casper signing key available:

```json
{
  "method": "tools/call",
  "params": {
    "name": "assess_subject",
    "arguments": {
      "subject": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "reportApiUrl": "$AGENT_PAY_BASE_URL"
    }
  }
}
```

The MCP process quotes the report, signs the x402 payload locally with your
Casper key, buys the report, verifies each evidence proof, computes the verdict,
and records the decision.

### Manual flow

Use the manual flow when your agent has its own payment/signing path.

1. Quote:

```sh
curl -X POST "$AGENT_PAY_BASE_URL/tools/quote_report" \
  -H "Content-Type: application/json" \
  -d '{"subject":"hash-<64 hex package hash>","reportApiUrl":"$AGENT_PAY_BASE_URL"}'
```

2. Sign the x402 requirement with your own Casper key. The accepted requirement
   is `paymentRequirements[0]`; the protected resource is `paymentResource`.
   Do not send AgentPay a private key.

3. Buy with a `PAYMENT-SIGNATURE` header against the seller API:

```sh
curl -X POST "$AGENT_PAY_BASE_URL/reports/buy/$QUOTE_ID" \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: $BUYER_SIGNED_X402_PAYLOAD" \
  -d '{}'
```

4. Verify the released report:

```sh
curl -X POST "$AGENT_PAY_BASE_URL/tools/verify_report" \
  -H "Content-Type: application/json" \
  -d '{
    "reportApiUrl": "$AGENT_PAY_BASE_URL",
    "record": { "id": "...", "product": "...", "network": "...", "subject": "...", "observedAt": "...", "sourceUrl": "...", "facts": {}, "rawHash": "..." },
    "proof": [{ "position": "left", "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
    "datasetRoot": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }'
```

5. Score locally from the released evidence or use `assess_subject`. If you
   score locally, follow the same verdict vocabulary and decision mapping below.

6. Record the decision:

```sh
curl -X POST "$AGENT_PAY_BASE_URL/tools/record_decision" \
  -H "Content-Type: application/json" \
  -d '{
    "datasetId": "agent-pay-live-...",
    "datasetRoot": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "reportHash": "sha256:...",
    "paymentReceiptHash": "sha256:...",
    "decision": "approved"
  }'
```

## Verdict vocabulary

AgentPay uses exactly three aspects:

| aspect | decision | meaning |
| --- | --- | --- |
| `CLEAR` | `approved` | No danger/caution flags and mandatory checked signals resolved. |
| `CAUTION` | `needs_review` | A caution flag exists or a mandatory signal was not checked. Pause for review. |
| `DANGER` | `rejected` | A danger rule fired. Do not approve the subject. |

The deterministic rule engine is authoritative. It extracts signals from the
verified evidence, runs pure rules, and returns the aspect/decision. The LLM
narrator is optional and can only explain the verdict; it cannot change or
override `CLEAR`, `CAUTION`, `DANGER`, or the recorded decision.

Rule signals include `mintAuthorityOpen`, `supplyRenounced`, `holderCount`,
`topHolderPct`, `contractAgeBlocks`, `lpHolderCount`, and `liquidityDepth`.
Danger flags include open mint authority, non-renounced supply, single LP
holder, and extreme holder concentration. A very new contract is a caution.

## Security rules

- Never send AgentPay a private key, seed phrase, PEM file, or raw wallet
  secret.
- Pay with your own Casper key. `PAYMENT-SIGNATURE` carries the signed x402
  payload, not the key.
- Verify the Merkle proof before acting on a paid report.
- Treat `DANGER` as a hard rejection. Treat `CAUTION` as human review. Treat
  `CLEAR` as acceptable only if your own policy also allows the action.
