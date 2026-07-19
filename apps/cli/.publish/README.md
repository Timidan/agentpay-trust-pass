# @timidan/agentpay-cli

AgentPay checks a Casper x402 charge before payment. It also verifies that the
settled payment matches the approved terms. Use this CLI to create sessions,
issue agent tokens, run checks, verify settlements, and read receipts.

- [npm package](https://www.npmjs.com/package/@timidan/agentpay-cli)
- [live application](https://agentpay.timidan.xyz)
- [source code](https://github.com/Timidan/agentpay-trust-pass)

## Requirements

Use Node.js 22 or a later version.

## Install

```bash
npm install --global @timidan/agentpay-cli
agentpay --help
```

The CLI uses `https://agentpay.timidan.xyz/api` by default.

## Create an agent token

Run this command with a Casper Testnet key:

```bash
agentpay agent-token issue \
  --name my-agent \
  --key ./testnet_secret_key.pem \
  --json
```

The command proves control of the key and creates the operator session. It
returns the agent token in the `token` field. If you omit `--scope`, the token
gets these scopes:

- `checks:write`
- `settlements:write`
- `observations:write`
- `receipts:read`

Set the returned value as `AGENT_PAY_API_TOKEN`. Store it in a local secret
store or process environment. Do not put it in source control.

## Check a captured charge

Create `charge.json`. Use the exact request and `PAYMENT-REQUIRED` values from
the paid service. Replace every value in angle brackets.

```json
{
  "request": {
    "method": "GET",
    "url": "https://service.example/resource",
    "bodyHash": "0000000000000000000000000000000000000000000000000000000000000000",
    "bodyBytes": 0,
    "capturedAt": "<current-ISO-8601-time>",
    "adapterVersion": "my-client/1"
  },
  "paymentRequired": {
    "x402Version": 2,
    "resource": {
      "url": "https://service.example/resource",
      "description": "Paid service",
      "mimeType": "application/json"
    },
    "accepts": [
      {
        "scheme": "exact",
        "network": "casper:casper-test",
        "asset": "<64-character-WCSPR-package-hash>",
        "amount": "10000",
        "payTo": "00<64-character-account-hash>",
        "maxTimeoutSeconds": 300,
        "extra": {
          "name": "Wrapped CSPR",
          "version": "1",
          "decimals": "9",
          "symbol": "WCSPR"
        }
      }
    ]
  },
  "authorization": null,
  "idempotencyKey": "my-service-check-001"
}
```

Run the check:

```bash
agentpay check --file ./charge.json --json
```

The JSON result contains `check.id` and `check.decision.verdict`. A valid
unsigned request normally returns `REVIEW` until the payer details are ready.
AgentPay can also return `PAY` or `BLOCK`. Read the returned reasons before you
sign anything.

## Run the full checked call

Use a real Casper x402 service. The CLI captures the 402 response, asks
AgentPay for a decision, signs locally only after `PAY`, settles, verifies the
transaction, and saves the receipt.

```bash
agentpay call \
  --url https://service.example/paid-endpoint \
  --key ./testnet_secret_key.pem \
  --json
```

The service must return an x402 version 2 `PAYMENT-REQUIRED` header for Casper
Testnet WCSPR.

## Commands

```text
agentpay session create --key <secret.pem>
agentpay agent-token list
agentpay agent-token issue --name <name> --key <secret.pem> [--scope <scope>] [--payer <public-key>]
agentpay agent-token revoke --id <token-id> --key <secret.pem>
agentpay check --file <input.json>
agentpay verify-settlement --check <id> --tx <hash>
agentpay call --url <https://service> --key <secret.pem> [--method GET|POST]
agentpay policy show
agentpay policy set --file <policy.json> --key <secret.pem>
agentpay provider list
agentpay provider pin|deny --origin <origin> --payee <address> --asset <hash> --ceiling <amount> --key <secret.pem>
agentpay receipt show --id <receipt-id> --key <secret.pem>
agentpay receipt verify --file <receipt.json>
```

Use `--api-url` to select another AgentPay deployment. Use `--token` to supply
an agent token for one command. Use `--session-token` for an operator command.
Use `--json` for stable machine-readable output.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | `PAY`, settlement `match`, or another successful command. |
| `2` | `REVIEW` or settlement `pending`. |
| `3` | `BLOCK` or settlement `mismatch`. |
| `4` | Invalid input, an unavailable result, or another command error. |

## Fix common errors

- If npm reports an engine error, install Node.js 22 or later.
- If the CLI reports that a key is required, pass `--key` or set
  `CASPER_SECRET_KEY_PATH`.
- If the API returns `401`, create a new token and set
  `AGENT_PAY_API_TOKEN`.
- If the API returns `403`, add the required token scope or use the token with
  its bound payer key.
- If settlement is `pending`, wait for Casper finality and run
  `verify-settlement` again.

The CLI reads the secret key locally. It never sends the key to AgentPay.
