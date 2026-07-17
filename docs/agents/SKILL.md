---
name: agentpay
description: Check a Casper x402 charge before signing it, verify what settled, or run a paid check on a Casper token, CSPR.name, or account.
---

# AgentPay

AgentPay handles two related jobs:

1. It checks an x402 charge before the buyer signs it and returns `PAY`,
   `REVIEW`, or `BLOCK`.
2. It can buy a live check of a Casper token or account, verify every evidence
   proof, apply fixed rules, and record the result on Casper Testnet.

The payment audit API does not read a buyer key. The buyer or CLI signs only
after a `PAY` result. The one-call MCP assessment is different: the MCP process
uses its configured `CASPER_SECRET_KEY_PATH` to pay the Testnet check fee and
record the result. Do not send a private key in an HTTP or MCP payload.

## Live Casper sources

- **CSPR.trade** resolves a listed token symbol to its exact Mainnet package
  hash. For example, `assess_subject` can accept a symbol instead of making the
  caller guess a contract.
- **CSPR.name** resolves a human-readable Mainnet name to its current account.
  AgentPay validates the expiry and cross-checks the returned public key against
  the account hash before reading that account from Casper.
- **CSPR.live** supplies public indexed package versions, holders, and
  contract-age data without exposing a server credential.
- **Casper JSON-RPC** reads account state, total supply, supply controls, and
  transaction execution independently of the indexer.
- **CSPR.cloud** is optional. A deployment can use it for token discovery or a
  hosted x402 facilitator, but AgentPay does not depend on it for token
  evidence.

Evidence can come from `casper-mainnet` or `casper-testnet`. The x402 check fee
and AgentPay registry record use `casper:casper-test`. Every quote and verdict
states both networks so they cannot be confused.

## Connect

Read this contract from a running AgentPay API:

```sh
curl "$AGENT_PAY_BASE_URL/skill.md"
```

For MCP over stdio:

```json
{
  "mcpServers": {
    "agent-pay": {
      "command": "npx",
      "args": ["--yes", "@timidan/agentpay-mcp"],
      "env": {
        "AGENT_PAY_API_TOKEN": "<scoped-agent-token>"
      }
    }
  }
}
```

The published package uses `https://agentpay.timidan.xyz/api` by default.
Override `REPORT_API_URL`, `AGENT_PAY_API_URL`, and
`AGENT_PAY_RESOURCE_BASE_URL` together to use another deployment. Add
`CASPER_SECRET_KEY_PATH` and the registry settings only for one-call paid
assessments; payment checks never need the MCP process to hold a buyer key.

The MCP resource URI is `skill://agentpay`.

For the HTTP bridge, set `AGENT_PAY_MCP_URL` to the full bridge base URL. The
hosted AgentPay deployment uses `https://agentpay.timidan.xyz/bridge` while
`AGENT_PAY_BASE_URL` is `https://agentpay.timidan.xyz/api`.

```sh
curl "$AGENT_PAY_MCP_URL/tools"
curl -X POST "$AGENT_PAY_MCP_URL/tools/payment_status" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Server and agent calls to protected HTTP tools require:

```text
Authorization: Bearer <MCP_SERVER_AUTH_TOKEN>
```

Only `payment_status` and `registry_status` are public status calls. A
deployment may also allow browser-origin calls to `assess_subject` and
`assess_account` under a Testnet budget. That browser exception requires an
exact allowed `Origin`; it is not an unauthenticated server API.

## Tools

| Tool | Use |
| --- | --- |
| `check_x402_payment` | Check captured x402 terms and an unsigned Casper authorization before signing. |
| `verify_x402_settlement` | Compare an executed Casper transaction with the exact approved charge. |
| `get_payment_receipt` | Read the receipt and its Casper anchor state. |
| `quote_report` | Price a live token or account check. Accepts a CSPR.trade symbol, CSPR.name, or exact Casper identifier. |
| `buy_report` | Pay an accepted quote and release its evidence. |
| `verify_report` | Verify one released evidence record against the dataset root. |
| `assess_subject` | Resolve, quote, pay, verify, score, and record a token or account check in one call. |
| `assess_account` | Run the one-call flow for a CSPR.name, account hash, or public key. |
| `record_decision` | Record an already verified check result on Casper Testnet. |
| `payment_status` | Check x402 facilitator readiness. |
| `registry_status` | Check Casper registry readiness. |

## Check a charge

Capture the original service request and the server's x402 response before
signing. Submit those values with the unsigned authorization intent:

```json
{
  "request": {
    "method": "GET",
    "url": "https://service.example/resource",
    "bodyHash": "<64 hex>",
    "bodyBytes": 0,
    "capturedAt": "<ISO timestamp>",
    "adapterVersion": "my-agent/1"
  },
  "paymentRequired": {
    "x402Version": 2,
    "resource": {},
    "accepts": []
  },
  "authorization": {
    "payerPublicKey": "<Casper public key>",
    "from": "00<64 hex>",
    "to": "00<64 hex>"
    "amount": "<integer>",
    "validAfter": "<Unix seconds>",
    "validBefore": "<Unix seconds>",
    "nonce": "<64 hex>",
    "network": "casper:casper-test",
    "asset": "<64 hex package hash>",
    "tokenName": "<on-chain token name>",
    "tokenVersion": "<authorization domain version>",
    "digest": "<64 hex>"
  },
  "idempotencyKey": "<stable retry key>"
}
```

Call `check_x402_payment`. Act on the result as follows:

| Result | Action |
| --- | --- |
| `PAY` | The checked terms match active policy. The buyer may sign locally. |
| `REVIEW` | Stop and request operator review. A required approval or fact is missing. |
| `BLOCK` | Do not sign. A hard rule failed. |

After the buyer submits the transaction, call `verify_x402_settlement` with the
returned `checkId` and the exact transaction hash. Treat only `match` as a
successful settlement. Then read the receipt with `get_payment_receipt`.

## Check a CSPR.trade token

This is the shortest live-project path:

```json
{
  "subject": "WCSPR",
  "evidenceNetwork": "casper-mainnet"
}
```

Call `assess_subject`. AgentPay asks CSPR.trade for the exact package hash,
reads Mainnet evidence for that package, pays the check fee over x402 on
Testnet, verifies all Merkle leaves, applies the token policy, and records the
decision on Testnet.

The result includes:

```json
{
  "aspect": "CLEAR | CAUTION | DANGER",
  "decision": "approved | needs_review | rejected",
  "subject": {},
  "resolvedToken": {
    "symbol": "string",
    "packageHash": "hash-<64 hex>",
    "network": "casper-mainnet",
    "source": "CSPR.trade"
  },
  "evidenceNetwork": "casper-mainnet",
  "payment": {
    "amount": "raw integer base units",
    "amountDisplay": "human-readable decimal amount",
    "asset": "<64 hex package hash>",
    "assetSymbol": "string",
    "assetDecimals": 9,
    "network": "casper:casper-test"
  },
  "flags": [],
  "passed": [],
  "notChecked": [],
  "datasetRoot": "<64 hex>",
  "paymentReceiptHash": "<64 hex>",
  "settlementTxHash": "<64 hex>",
  "decisionTxHash": "<64 hex>",
  "settlementExplorerUrl": "https://testnet.cspr.live/transaction/<hash>",
  "explorerUrl": "https://testnet.cspr.live/transaction/<hash>"
}
```

For an exact token package, pass `hash-<64 hex>` and choose
`casper-mainnet` or `casper-testnet`. For an account, use `assess_account`
with a `.cspr` name, `account-hash-<64 hex>` value, or Casper public key.

For example:

```json
{
  "account": "alice.cspr",
  "evidenceNetwork": "casper-mainnet"
}
```

The result includes `resolvedAccount` with the CSPR.name, canonical account
hash, optional public key, expiry, and source URL. CSPR.name is Mainnet-only;
the check fee and AgentPay registry record still use Casper Testnet.

## Evidence verdicts

| Verdict | Meaning |
| --- | --- |
| `CLEAR` | Every fact required by this policy was read and every required check passed. Review the evidence before acting. |
| `CAUTION` | A caution rule fired or AgentPay could not read a required fact. |
| `DANGER` | A required check found a concrete risk. Do not continue until you understand it. |

Token CLEAR requires all of these facts:

- the CEP-18 mint and burn functions are disabled;
- contract age is at least 1,000 blocks;
- holder count was read;
- top-holder concentration was read and is below 95%.

Account checks cover only facts AgentPay can prove from Casper state: account
existence, CSPR balance, associated keys, and action thresholds. They do not
prove a person's identity or promise that an account is trustworthy.

## Manual paid-report flow

Use this path when the caller has its own x402 signer:

1. Call `quote_report` with `subject` and `evidenceNetwork`.
2. Confirm `paymentReadiness.status` is `ready`.
3. Sign `paymentRequirements[0]` for `paymentResource` locally.
4. Call `buy_report` with the quote ID and signed x402 payload.
5. Check that the paid `datasetId`, `datasetRoot`, `evidenceNetwork`, payment
   amount, asset, and network match the accepted quote.
6. Call `verify_report` for every evidence leaf.
7. Apply the deterministic policy or call the one-call assessment tool.

Never accept a paid report whose network, payment details, dataset identity, or
Merkle proof differs from the quote.
