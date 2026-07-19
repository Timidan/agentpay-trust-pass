# AgentPay final-round demo transcript

This is a two-minute proof tour of every AgentPay capability family. Record the
six clips below separately, then join them in the listed order. The words in
block quotes are spoken. The text in brackets is a screen action and is not
spoken.

Before recording, run `pnpm production:check`. Use only fresh production pages
and real Testnet results. Label every earlier result **Completed Testnet run**.
Never imply that a prepared clip happened during the recording.

## Recording setup

Prepare these six clips before recording the voice-over:

1. **Token and share:** a completed official Testnet WCSPR check, its four
   evidence rows, receipt links, the **Share** action, and the published result
   in **Shared results**.
2. **Wallet:** a completed public account check showing existence, funding, key
   control, verdict, and receipt.
3. **Payment decision:** `/audit` with Casper Wallet connected, AgentPay's live
   `0.00001 WCSPR` charge read, provider approved, daily limit saved, and exact
   payment details prepared. Stop before **Run check**.
4. **Completed payment:** an earlier completed Testnet payment showing **PAY**,
   **MATCH**, service response, receipt, settlement explorer link, and Casper
   receipt record. Download its receipt JSON for the CLI clip. Add the visible
   label **Completed Testnet run**.
5. **Evidence console:** a completed `/app` report with valid Merkle proof and
   registry record, followed by the **Tamper one fact** failure.
6. **Agent and developer access:** `/agents` beside a terminal showing the two
   npm install commands, one successful live MCP tool call, and one successful
   `agentpay receipt verify` result. Use the exact commands in
   [`live-demo.md`](live-demo.md#prepare-the-terminal-clip).

Keep browser zoom at 100%. Crop private wallet details and tokens. Do not show a
secret key, API token, or facilitator credential.

## 0:00 - Product

[Open production. Show the live status row, then cut to **Payment checker**.]

> This is AgentPay. It checks a Casper x402 charge before a person or agent
> signs, returns PAY, REVIEW, or BLOCK, and creates a receipt anchored on Casper
> Testnet.

## 0:12 - Token and wallet checks

[Cut across the prepared WCSPR evidence rows and receipt. Click **Share**, show
the result in **Shared results**, then cut to the prepared wallet result.]

> This WCSPR result marks every signal as passed, flagged, or not checked.
> AgentPay bought current evidence over x402, verified it, and made the receipt
> shareable. The wallet check uses the same path to confirm an account exists,
> is funded, and shows its key-control setup before funds move.

## 0:36 - Check before payment

[On the prepared payment tab, point to the HTTPS service, official WCSPR asset,
recipient, amount, provider approval, and daily limit. Click **Run check** and
show **PAY**. Briefly expose the REVIEW and BLOCK meanings in the decision key.]

> This service asks for 0.00001 WCSPR. AgentPay checks the provider, recipient,
> asset, amount, and my limits. Missing approval produces REVIEW. Unsafe terms
> produce BLOCK. Only approved terms produce PAY.

## 1:01 - Verify after payment

[Cut to the clearly labeled completed payment. Show **MATCH**, service response,
receipt, settlement link, and Casper record.]

> In this completed Testnet run, the buyer signed locally and the CSPR.cloud
> facilitator settled WCSPR. AgentPay verified the on-chain transfer, received
> MATCH, captured the service response, and anchored the receipt. The receipt
> binds the request, decision, payment, and response.

## 1:25 - Prove the evidence

[Cut to the completed **Evidence console**. Show quote, x402 receipt, valid
Merkle proof, and registry record. Click **Tamper one fact** and show failure.]

> The evidence console exposes the full rail: quote, x402 settlement, Merkle
> proof, and registry record. Change one fact, and verification fails.

## 1:40 - Agents and developers

[Cut to `/agents` and the terminal. Show the published npm links, MCP tool
result, CLI offline verification result, and HTTP example.]

> Developers install the CLI from npm. Agents run the npm MCP server or use
> HTTP. This MCP call reached the live service, and the CLI verified a receipt
> offline. Private keys stayed local.

## 1:56 - Close

[End on the AgentPay wordmark and the Casper receipt link.]

> Check before signing. Then prove what happened.

## Capability coverage

| Capability family | Visible proof in the video |
|---|---|
| Live production | Public URL and live service status |
| Token intelligence | Official WCSPR lookup, four explicit evidence states, verdict, and receipt |
| Counterparty intelligence | Account existence, funding, key control, verdict, and receipt |
| Public verification | Shared result and copyable receipt links |
| Pre-payment policy | Captured x402 terms, provider approval, limit, and PAY / REVIEW / BLOCK |
| Non-custodial settlement | Local wallet signing and CSPR.cloud WCSPR settlement |
| Post-payment verification | MATCH, paid service response, immutable receipt, and Casper anchor |
| Evidence integrity | Quote, x402 release, Merkle proof, registry record, and tamper failure |
| Human access | Web application |
| Developer access | Published npm CLI and offline receipt verification |
| Agent access | Published npm MCP server, live tool result, HTTP bridge, and tool list |

## Recovery line

If the live decision is not PAY, do not submit a payment. Keep the result on
screen and say:

> AgentPay has not approved this charge. I will show the reason instead of
> bypassing the check.
