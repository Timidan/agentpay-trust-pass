# @timidan/agentpay-mcp

AgentPay checks a Casper x402 charge before an agent signs it. It returns
`PAY`, `REVIEW`, or `BLOCK`, verifies the payment that settled, and keeps a
receipt tied to the approved terms.

## Add AgentPay to an MCP client

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["--yes", "@timidan/agentpay-mcp"],
      "env": {
        "AGENT_PAY_API_TOKEN": "<scoped-agent-token>"
      }
    }
  }
}
```

The package uses `https://agentpay.timidan.xyz/api` by default. Set
`REPORT_API_URL`, `AGENT_PAY_API_URL`, and `AGENT_PAY_RESOURCE_BASE_URL` to use
another AgentPay deployment.

Public quote, payment-status, and proof-verification tools do not need a token.
Payment checks, settlement verification, and receipt access require a scoped
AgentPay token. Create one with the AgentPay CLI:

```bash
npm install -g @timidan/agentpay-cli
agentpay agent-token issue --name my-agent --key ./testnet_secret_key.pem --scope checks:write
```

The Casper key is read by the local CLI or MCP process. It is never sent to
AgentPay. The one-call paid assessment tools also require local Testnet buyer
and registry settings; read `skill://agentpay` for the complete contract.

Source and documentation:
[github.com/Timidan/agentpay-trust-pass](https://github.com/Timidan/agentpay-trust-pass)
