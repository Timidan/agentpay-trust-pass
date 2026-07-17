# @timidan/agentpay-cli

AgentPay checks an x402 charge before your agent signs it, and proves the settled
Casper payment matched the terms you approved. This CLI is the developer surface:
sessions, scoped agent tokens, payment checks, settlement verification, and receipts.

```bash
npm install -g @timidan/agentpay-cli
agentpay --help
```

## Quick start

```bash
# Prove control of a Casper key and get a short-lived operator session token.
# No registration required; the key never leaves your machine.
agentpay session create --key ./testnet_secret_key.pem --json

# Issue a scoped token for an autonomous agent (operator session required).
agentpay agent-token issue --name my-agent --key ./testnet_secret_key.pem --scope checks:write

# Check a captured x402 charge: returns PAY, REVIEW, or BLOCK with reasons.
agentpay check --file ./charge.json

# After paying: verify the on-chain settlement matches the approved charge.
agentpay verify-settlement --check <id> --tx <hash>

# One-shot checked call: capture, check, sign locally on PAY, settle, verify.
agentpay call --url https://service.example/paid-endpoint --key ./testnet_secret_key.pem
```

The CLI talks to the hosted AgentPay API by default
(`https://agentpay.timidan.xyz/api`); point `--api-url` at your own deployment to
self-host. Signing always happens locally: the CLI never sends a private key
anywhere.

## All commands

```
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

Source and full documentation:
[github.com/Timidan/agentpay-trust-pass](https://github.com/Timidan/agentpay-trust-pass)
