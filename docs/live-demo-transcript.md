# AgentPay two-minute demo transcript

The words in block quotes are spoken. The text in brackets is a screen action.

Before the demo, run `pnpm production:check`. Confirm that every check passes.
Use a Testnet wallet with WCSPR. Keep a completed receipt open in another tab.

## 0:00 - What AgentPay does

[Open [agentpay.timidan.xyz](https://agentpay.timidan.xyz), then open
**Payment checker**.]

> This is AgentPay. It checks a Casper x402 charge before the buyer signs it.
> It checks the service, destination, token, amount, and buyer limits. It
> returns PAY, REVIEW, or BLOCK. AgentPay never holds the buyer's key or sends
> the payment.

## 0:25 - Check a live charge

[Connect Casper Wallet. Click **Use AgentPay's own charge**, then **Read
charge**.]

> This is a real HTTP 402 charge for 0.00001 WCSPR on Casper Testnet. The wallet
> login proves control of this session. It moves no funds.

[Click **Run check**. Complete only the provider or limit actions shown by
AgentPay. Click **Prepare payment details**, then run the check again.]

> A new provider or limit can produce REVIEW. After I approve the exact rules,
> AgentPay returns PAY. Preparing the details does not sign the payment.

## 1:05 - Pay and prove the result

[Click **Pay with Casper Wallet** and approve the WCSPR authorization.]

> Now the wallet signs the exact payment. After settlement, AgentPay reads the
> Casper transaction and compares it with what I approved.

[Point to **MATCH**, **Service response**, **Receipt**, and **Casper record**.]

> MATCH proves that the correct transfer settled. AgentPay records the paid
> service response. The receipt connects the request, decision, payment, and
> response. Its hash is recorded on Casper for later verification.

## 1:45 - Close

[Open **Agents** and show the tool list.]

> People use the web application. Developers use the CLI. Agents use MCP or
> HTTP. They use the same checks and receipts: check before signing, then prove
> what happened after payment.

## Recovery line

If the result is not PAY, do not submit the payment. Say:

> AgentPay has not approved this charge. I will use the reason on the screen
> instead of bypassing the check.
