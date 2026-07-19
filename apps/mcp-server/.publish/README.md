# @timidan/agentpay-mcp

AgentPay checks a Casper x402 charge before an agent signs it. It returns
`PAY`, `REVIEW`, or `BLOCK`. It can then verify the settled payment and read
the payment receipt.

- [npm package](https://www.npmjs.com/package/@timidan/agentpay-mcp)
- [live application](https://agentpay.timidan.xyz)
- [source code](https://github.com/Timidan/agentpay-trust-pass)

## Requirements

Use Node.js 22 or a later version.

## Run the first call

Add this configuration to your MCP client:

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["--yes", "@timidan/agentpay-mcp"]
    }
  }
}
```

Call this public tool:

```json
{
  "name": "quote_report",
  "arguments": {
    "subject": "WCSPR",
    "evidenceNetwork": "casper-testnet"
  }
}
```

The result contains a quote ID, x402 payment terms, and the payment-readiness
state. This call does not sign or settle a payment.

The package uses `https://agentpay.timidan.xyz/api` by default.

## Enable protected tools

Install the AgentPay CLI. Then create a token for the payer key:

```bash
npm install --global @timidan/agentpay-cli
agentpay agent-token issue \
  --name my-agent \
  --key ./testnet_secret_key.pem \
  --json
```

If you omit `--scope`, the CLI grants the four scopes required for the full
payment flow:

| Scope | Use |
|---|---|
| `checks:write` | Check a charge before signing. |
| `settlements:write` | Verify the Casper settlement. |
| `observations:write` | Record the service response. |
| `receipts:read` | Read a payment receipt. |

Add the returned token to the MCP configuration:

```json
{
  "env": {
    "AGENT_PAY_API_TOKEN": "<token-from-agentpay-cli>"
  }
}
```

The token is bound to the payer public key. The CLI reads the secret key on
your machine. It does not send the key to AgentPay.

## Tools

| Tool | Use |
|---|---|
| `quote_report` | Get the price and Casper x402 terms for a check. |
| `payment_status` | Check the payment asset, destination, network, and facilitator. |
| `registry_status` | Check the AgentPay registry on Casper Testnet. |
| `buy_report` | Submit a signed x402 payment and get the report. |
| `verify_report` | Verify the report Merkle proof. |
| `record_decision` | Record a report decision on Casper. |
| `assess_subject` | Run the complete paid token check. |
| `assess_account` | Run the complete paid account check. |
| `check_x402_payment` | Return `PAY`, `REVIEW`, or `BLOCK` before signing. |
| `verify_x402_settlement` | Compare the settled transaction with the approved terms. |
| `get_payment_receipt` | Read the receipt and its Casper anchor state. |

Public quote, status, and report-proof tools do not need an AgentPay token.
Payment checks, settlement verification, and receipt access need the token.
The one-call paid assessment tools also need local Testnet buyer and registry
settings. Read the bundled `skill://agentpay` resource for those settings.

## Configuration

| Variable | Use |
|---|---|
| `AGENT_PAY_API_TOKEN` | Set the scoped token for protected tools. |
| `REPORT_API_URL` | Set a different report API. |
| `AGENT_PAY_API_URL` | Set a different payment-check API. |
| `AGENT_PAY_RESOURCE_BASE_URL` | Set a different hosted resource base URL. |

## Fix common errors

- If `npx` reports an engine error, install Node.js 22 or later.
- If a tool returns `401`, create a new token and set `AGENT_PAY_API_TOKEN`.
- If a tool returns `403`, add the required scope or use the token with its
  bound payer key.
- If settlement is not ready, call `payment_status` and use its reason field.
- If a paid assessment needs configuration, read `skill://agentpay` and set
  the listed Testnet values.

Do not put a Casper secret key, AgentPay token, or bridge token in source
control.
