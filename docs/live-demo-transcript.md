# AgentPay final-round one-take demo

Record this as one continuous screen recording. Speak the quoted lines while
you use the product. Do not record separate clips, stop the recording, or add
a voice-over later.

The recording can use browser tabs that you prepared immediately beforehand.
Those tabs must contain real production results, not screenshots or videos.
Call an earlier settlement a **completed Testnet run** when you show it.

## Exact live inputs

From the repository root, run these checks just before you prepare the browser:

```bash
pnpm production:check
pnpm demo:inputs
```

`pnpm demo:inputs` calls production, verifies that the fresh endpoint returns
HTTP 402 with a `PAYMENT-REQUIRED` header, and prints the complete values to
use. It does not print placeholders. Copy its `URL` into **Payment checker**,
select `POST`, and use `{}` as the request body. The URL is a real x402 purchase
endpoint under:

```text
https://agentpay.timidan.xyz/api/reports/buy/<fresh-quote-id>
```

The quote ID is generated live and expires after five minutes. Generate it
again if the page says the charge expired. Do not put an old quote URL in the
recording.

The helper obtains that URL from this public production request:

```text
GET https://agentpay.timidan.xyz/api/reports/quote?subject=hash-8df5d26790e18cf0404502c62ce5dc9025800ad6975c97466e20506c39c505b6&network=casper-mainnet
```

Use these fixed inputs:

| Screen | Real input |
|---|---|
| Token check | `WCSPR` |
| Current mainnet WCSPR package resolved by AgentPay | `hash-8df5d26790e18cf0404502c62ce5dc9025800ad6975c97466e20506c39c505b6` |
| Wallet check | `account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785` |
| Payment method | `POST` |
| Payment body | `{}` |
| x402 charge | `0.00001 WCSPR` (`10000` base units) |
| Payment network | `casper:casper-test` |
| Testnet WCSPR payment package | `hash-3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e` |

The token check and the payment asset are intentionally different network
uses. The token screen checks the live mainnet WCSPR listing. The x402 fee is
paid with the official Testnet WCSPR package, so the demo does not spend real
mainnet funds.

Use this exact public HTTP bridge call in the terminal. It needs no secret:

```bash
curl -fsS -X POST https://agentpay.timidan.xyz/bridge/tools/payment_status \
  -H 'Content-Type: application/json' \
  --data '{}'
```

The response must contain `"status":"ready"`, `"x402Version":2`, and
`"network":"casper:casper-test"`.

## Prepare one continuous take

Open these tabs in this order. Preparation is not part of the recording.

1. `/` scrolled to **Live AgentPay status**.
2. `/check` with a fresh completed `WCSPR` result at its evidence rows.
3. `/feed` with the result you just shared visible.
4. `/counterparty` with a fresh completed check for the account above.
5. `/audit` with Casper Wallet connected, the fresh x402 URL read, provider
   approval and daily limit saved, and payment details prepared. Stop before
   the final **Run check**.
6. A second `/audit` tab holding a completed Testnet payment with **PAY**,
   **MATCH**, service response, settlement link, receipt, and Casper record.
7. `/app` with a completed evidence run and an untampered Merkle proof.
8. `/agents` at the npm packages and tool examples.
9. A terminal with successful `pnpm demo:mcp` output and a downloaded receipt
   ready for offline verification.

Use `Ctrl+Tab` to move forward. Keep browser zoom at 100 percent. Hide wallet
balances if desired, and never show a private key, API token, bridge token, or
facilitator credential.

Prepare the terminal before recording:

```bash
pnpm demo:mcp
npm install --global @timidan/agentpay-cli
RECEIPT=$(ls -t "$HOME"/Downloads/agentpay-*.json | head -n 1)
agentpay receipt verify --file "$RECEIPT" --json
```

The receipt command uses the newest real receipt downloaded from the completed
payment screen. Do not use a hand-written JSON file.

## Spoken transcript and actions

### 0:00 - Live product

[Start recording on the production status row. Point to each ready state, then
open the first viewport briefly.]

> This is AgentPay on Casper. Before a wallet signs, it checks the x402 service,
> recipient, token, amount, expiry, and rules. Live status shows the payment
> path, registry, data, and agent bridge are ready.

### 0:16 - Token, sharing, and wallet

[Move to the completed `WCSPR` tab. Keep `WCSPR`, the resolved package hash,
the four evidence rows, and receipt links visible. Move to **Shared results**,
then to the completed wallet result.]

> My real token input is WCSPR. AgentPay buys current Casper evidence over x402,
> labels passed, flagged, and missing facts, and creates a shareable receipt.
> This result was shared by choice. This wallet result checks AgentPay's public
> Testnet account for existence, funding, and key control.

### 0:43 - Check before payment

[Move to the prepared payment tab. Point to the full HTTPS endpoint, `POST`,
`0.00001 WCSPR`, Testnet, the recipient, provider approval, and daily limit.
Click **Run check** and show the decision and reasons.]

> This fresh HTTPS endpoint asks for 0.00001 WCSPR on Casper Testnet. AgentPay
> compares the exact charge with my approval and daily limit. REVIEW asks me to
> decide. BLOCK prevents signing. PAY permits the wallet step.

### 1:08 - Verify the completed payment

[Move to the completed payment tab. Do not claim it happened during this
recording. Show **MATCH**, the service response, settlement explorer link,
receipt, and Casper record.]

> This is a completed Testnet run, not a simulation. The buyer signed locally,
> CSPR.cloud settled WCSPR, and MATCH proves the transfer matched approval. The
> receipt binds the request, decision, payment, response, and Casper record.

### 1:30 - Break the proof

[Move to **Evidence console**. Show the valid Merkle proof, click **Tamper one
fact**, and keep the failed verification visible.]

> The evidence console verifies the Merkle proof. I change one fact, and the
> proof fails.

### 1:40 - Agents and developers

[Move to `/agents`, then the terminal. Show the published npm packages,
successful MCP result, run the public HTTP bridge command above, and show the
offline receipt verification result.]

> People use the web app; developers use the CLI; agents use the npm MCP server
> or HTTP. This live bridge call returns ready, and the CLI verifies the receipt
> offline. Private keys stayed local.

### 1:56 - Close

[Return to the AgentPay wordmark or completed receipt.]

> AgentPay checks before signing, then proves what happened.

## Capability coverage

| Capability | Visible proof in the one-take recording |
|---|---|
| Live production | Public URL and ready status responses |
| Token intelligence | Real `WCSPR` input, four evidence states, verdict, and receipt |
| Counterparty intelligence | Real Testnet account input, existence, funding, key control, and receipt |
| Public verification | Opt-in shared result |
| Pre-payment policy | Fresh x402 endpoint, exact terms, limits, and PAY, REVIEW, or BLOCK |
| Settlement | Completed WCSPR transfer and MATCH |
| Delivery proof | Paid service response, receipt, and Casper record |
| Evidence integrity | Valid Merkle proof followed by **Tamper one fact** failure |
| Human access | Web application |
| Developer access | Published CLI package and offline receipt verification |
| Agent access | Published npm MCP server and live HTTP bridge call |

## Recovery line

If the fresh decision is not PAY, do not send a payment. Keep the reason on
screen, move to the completed Testnet tab, and say:

> AgentPay has not approved this charge, so I will not bypass it. This completed
> Testnet run shows the settlement path after a valid PAY decision.
