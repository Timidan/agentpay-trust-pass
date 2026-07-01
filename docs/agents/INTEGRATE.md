# Integrate your agent with AgentPay

AgentPay is an x402-paid evidence desk and Trust Signal for Casper agents. Your
agent asks AgentPay for evidence, pays with its own Casper wallet, verifies the
Merkle proof, and records the resulting decision on Casper.

This is the human orientation. The machine-readable skill is the source of
truth for exact tool names, request bodies, response shapes, and security
rules:

```sh
curl $AGENT_PAY_BASE_URL/skill.md
```

The skill is also available to MCP clients as `skill://agentpay`.

## The integration in five moves

Everything is agent -> AgentPay. The web UI is observe-only documentation and
demo surface; it does not hold wallet keys and it does not approve actions for
the agent.

1. Install the skill with `curl $AGENT_PAY_BASE_URL/skill.md`, or read the MCP
   resource `skill://agentpay`.
2. Connect to the AgentPay MCP server. MCP is the primary agent channel; the
   HTTP bridge under `/tools/<name>` is secondary.
3. Quote or assess a subject. Use `assess_subject` for the full local MCP rail,
   or use `quote_report` plus your own signing/payment path.
4. Pay the x402 requirement with your own Casper key. AgentPay never takes a
   private key.
5. Verify the report, then record `approved`, `needs_review`, or `rejected`.

The verdict words are `CLEAR`, `CAUTION`, and `DANGER`. They come from a pure
deterministic rule engine. Any LLM text is narration only and cannot override
the rule result.
