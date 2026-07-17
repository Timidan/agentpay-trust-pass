# Integrate your agent with AgentPay

AgentPay checks a Casper x402 charge before your agent signs it. It verifies the
service, recipient, token, amount, authorization, and local spending policy,
then returns `PAY`, `REVIEW`, or `BLOCK`. AgentPay also offers paid token and
account checks backed by live Casper evidence and a verifiable receipt.

This is the human orientation. The machine-readable skill is the source of
truth for exact tool names, request bodies, response shapes, and security
rules:

```sh
curl $AGENT_PAY_BASE_URL/skill.md
```

The skill is also available to MCP clients as `skill://agentpay`.

## The integration in five moves

Everything is agent -> AgentPay. Private keys stay with the agent or local CLI.
The web UI never asks a user to paste or upload one.

1. For local stdio MCP, create a scoped AgentPay API token. For the hosted HTTP
   bridge, use the separate bridge bearer token supplied by the operator.
2. Capture the service request and its real x402 `402 Payment Required`
   response.
3. Call `check_x402_payment`. Stop on `REVIEW` or `BLOCK`.
4. On `PAY`, sign the approved authorization locally and retry the service.
5. Call `verify_x402_settlement`, then keep the receipt returned by
   `get_payment_receipt`.

The hosted API is `https://agentpay.timidan.xyz/api`; the hosted tool bridge is
`https://agentpay.timidan.xyz/bridge`. Protected bridge calls require a bearer
token. Do not use the scoped API token as the bridge token: they protect
different boundaries.

Token and account checks are a second surface built on the same paid evidence
rail. Use `assess_subject` or `assess_account` when you want `CLEAR`, `CAUTION`,
or `DANGER` for a Casper asset or counterparty. Those verdicts come from fixed
rules. Narration can explain a result but cannot change it.
