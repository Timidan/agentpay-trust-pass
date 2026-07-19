# AgentPay live demo

Production: [agentpay.timidan.xyz](https://agentpay.timidan.xyz)

Spoken judge script: [live-demo-transcript.md](live-demo-transcript.md)

AgentPay checks an x402 charge before the buyer signs it. It checks the
service, recipient, token, amount, authorization, and spending rules; returns
PAY, REVIEW, or BLOCK; then verifies the Casper settlement and produces a
receipt.

## Preflight

Run this before the judging session:

```bash
pnpm production:check
curl -fsS https://agentpay.timidan.xyz/api/reports/payment-status | jq
```

Require every check to pass. The payment-status response must say `ready`,
identify `0.00001 WCSPR` on `casper:casper-test`, and list the configured
facilitator as supporting x402 v2 `exact` payments. Then open the production
site in a fresh browser tab and confirm the status cards say:

- Agent bridge live
- x402 payments ready
- Registry ready
- Full token data ready

For the full signed-payment demo, use a Casper Wallet account that holds
Testnet WCSPR and supports typed-data signing. WCSPR can be obtained by wrapping
Testnet CSPR at [testnet.cspr.trade](https://testnet.cspr.trade). Never display
or paste a private key in the browser, terminal, or recording.

## Recommended judge flow

This path takes about five minutes and needs no wallet or account setup.

### 1. Establish the product

1. Open [agentpay.timidan.xyz](https://agentpay.timidan.xyz).
2. Point to the captured x402 charge in the first viewport.
3. Say: "AgentPay reads the charge before an agent signs it, decides whether it
   matches the buyer's rules, and proves what settled afterward."
4. Scroll to **Live AgentPay status** and show that the bridge, x402 payment
   service, registry, and token evidence are live.

Do not spend time reading the landing page. Move directly into a check.

### 2. Check WCSPR before buying it

1. Open **Token check**, or go directly to
   [agentpay.timidan.xyz/check](https://agentpay.timidan.xyz/check).
2. Enter `WCSPR` in **Token symbol or package hash**.
3. Click **Check this token**.
4. Wait for the live check to finish. AgentPay covers the Testnet service fee.
5. Read the verdict that appears. Do not promise CLEAR, CAUTION, or DANGER in
   advance; the result must reflect the current evidence.
6. Show the four evidence rows: supply control, contract age, holder count, and
   top-holder share. Call out anything marked **not checked** instead of hiding
   it.
7. Show the proof section:
   - evidence root
   - x402 receipt
   - settlement transaction
   - Casper record
8. Open one Casper explorer link to prove that the receipt is not a UI-only
   result.
9. Click **Copy AgentPay check receipt**.

What this proves: a consumer can enter a token symbol, AgentPay buys current
evidence over x402, checks it, verifies the paid result, and returns a portable
receipt.

### 3. Publish and verify the result

1. Click **Share** on the completed token result.
2. Wait for the button to say **Shared / link copied**.
3. Open **Shared results**, or go to
   [agentpay.timidan.xyz/feed](https://agentpay.timidan.xyz/feed).
4. Open the result that was just published.

Explain that the feed contains only results their owners chose to publish. It
is not an invented global history.

### 4. Check a real Casper account

1. Open **Wallet check**, or go to
   [agentpay.timidan.xyz/counterparty](https://agentpay.timidan.xyz/counterparty).
2. Enter the public AgentPay Testnet account:

   ```text
   account-hash-731349cf6f3c4756e74066db530e56ae67cfe70f770575e786fad0572ad20785
   ```

3. Click **Check this account**.
4. Show the resolved account, existence and funding evidence, key-control
   setup, verdict, and receipt.

What this proves: the same payment-backed evidence path can check who controls
a Casper account before an agent sends funds or grants access.

### 5. Show the agent interface

1. Open **Agents**, or go to
   [agentpay.timidan.xyz/agents](https://agentpay.timidan.xyz/agents).
2. Show the MCP configuration, HTTP bridge example, and tool list.
3. Point out that agents call the same checks demonstrated in the UI; AgentPay
   does not have a separate mocked agent path.

End with: "People use the web app, developers use the CLI, and agents use MCP
or HTTP. All of them reach the same checks and receipts."

## Flagship payment-checker flow

This is the primary live demo. It uses the official Testnet WCSPR contract and
the configured Casper x402 facilitator. The facilitator pays settlement gas
while the connected buyer authorizes the exact WCSPR transfer.

1. Open [agentpay.timidan.xyz/audit](https://agentpay.timidan.xyz/audit).
2. Click **Connect Casper Wallet** and approve the login message. This is not a
   transaction and does not move funds.
3. Click **Use AgentPay's own charge**.
4. Click **Read charge**.
5. Show the exact `0.00001 WCSPR` amount, Testnet network, official WCSPR
   contract, recipient, payment window, paid resource, and charge ID.
6. Click **Run check**. The first result may be REVIEW because the buyer has
   not approved this provider, set a daily limit, or prepared authorization.
7. Complete only the actions AgentPay requests: approve the provider, save a
   daily limit above the charge, and rerun after each change.
8. Click **Prepare payment details**, then rerun the check. Preparing the exact
   payer, recipient, amount, token, and validity window still moves no funds.
9. Confirm the final decision is **PAY**. If it is REVIEW or BLOCK, read the
   reason and do not send the payment.
10. Click **Pay with Casper Wallet** and approve the exact WCSPR authorization.
11. Wait for the settlement, service-response, receipt, and Casper-record
    panels to complete.
12. Open the Testnet explorer links for both the WCSPR settlement and receipt
    record. The settlement panel must say **MATCH**.

If the installed wallet cannot sign Casper x402 typed data, stop after the
decision and use the operator flow below. Do not turn a wallet compatibility
issue into a claim that AgentPay signed or settled the payment.

## Automated rehearsal

This drives the same public `/audit` UI through wallet login, charge parsing,
policy decisions, typed-data signing, CSPR.cloud settlement, response
comparison, receipt creation, and Casper anchoring. It uses a local Testnet key
only to emulate Casper Wallet in the automated browser.

The official Testnet WCSPR package hash is:

```text
hash-3d80df21ba4ee4d66a2a1f60c32570dd5685e4b279f6538162a5fd1314847c1e
```

From the repository root:

```bash
AGENTPAY_E2E_WEB_URL=https://agentpay.timidan.xyz \
AGENT_PAY_API_URL=https://agentpay.timidan.xyz/api \
CASPER_SECRET_KEY_PATH=.agentpay-testnet-key/funded_secret_key.pem \
AGENTPAY_E2E_AUTH=wallet \
AGENTPAY_E2E_VIEWPORT=desktop \
node --import tsx scripts/e2e-auditor-ui.ts
```

Repeat with `AGENTPAY_E2E_VIEWPORT=mobile` for the responsive run. Each run
sends `0.00001 WCSPR` and writes a full-page screenshot to `/tmp`. Success
prints JSON containing all of these values:

```text
"verdict":"pay"
"unpaidStatus":402
"walletPaymentSent":true
"settlementVerdict":"match"
"receiptRecorded":true
"receiptAnchored":true
"horizontalOverflow":0
```

Known live proofs from the 18 July 2026 rehearsal:

- Desktop settlement: [28048959f0e059dbc4b0b69f0d99d41bdcd19e05b72128fbbf0442ac3c185c98](https://testnet.cspr.live/transaction/28048959f0e059dbc4b0b69f0d99d41bdcd19e05b72128fbbf0442ac3c185c98)
- Desktop receipt record: [ad6dfb831d4fb8273d8c54d41ea9e2ad48e1d94aea18b94006ee3b94a7470b87](https://testnet.cspr.live/transaction/ad6dfb831d4fb8273d8c54d41ea9e2ad48e1d94aea18b94006ee3b94a7470b87)
- Mobile settlement: [e5b5bd3cb72347246de27979f889ca62c66503696ab16e5cc3cc99cd89130b69](https://testnet.cspr.live/transaction/e5b5bd3cb72347246de27979f889ca62c66503696ab16e5cc3cc99cd89130b69)
- Mobile receipt record: [eb557178a60c5b06ecf10ea3efb5d8c4e0a236fec6c4a7f8da826d33c94fdb1d](https://testnet.cspr.live/transaction/eb557178a60c5b06ecf10ea3efb5d8c4e0a236fec6c4a7f8da826d33c94fdb1d)

## Recovery rules

- If preflight fails, do not spend Testnet funds. Show the existing shared
  result and explain the failed service by name.
- If a live check returns **not checked**, show it. Missing evidence is part of
  the verdict, not a UI error.
- If the verdict changes between rehearsals, use the current verdict. Never
  describe a fixed expected color.
- If Casper confirmation is slow, keep the pending state visible and open the
  transaction in the Testnet explorer.
- If wallet signing is unavailable, use the local-signer operator flow. Never
  paste private key material into AgentPay.
- Keep the known settlement and registry evidence in
  [`dorahacks-submission.md`](dorahacks-submission.md) available only as a
  fallback. Present it as an earlier confirmed run, not as the current one.
