# AgentPay Agent Connection Design

Date: 2026-06-10

## Context

AgentPay is an agent-first financial product. The public landing page should introduce the trust and payment-proof promise, then route users into the product. The console should not behave as if a user or agent is already connected.

The current product flow already avoids committed business evidence, mock receipts, and fake settlement data. It quotes live Casper product evidence, enforces the x402 payment gate, verifies the released proof, and records decisions only through configured Casper paths. The missing product boundary is the actor state: the UI needs an explicit connection step before any agent can quote evidence or continue settlement.

## Decision

Build an agent identity boundary first.

This is the smallest honest product slice because AgentPay is for autonomous agents buying proof-backed Casper evidence. A human Casper wallet connection is still valuable, but it should not be introduced until the project chooses a real Casper wallet integration and payment-payload signing path. The next iteration should not add a fake wallet, fake signed-in user, placeholder auth provider, or secret field that is not verified by the backend.

## User Experience

The landing page keeps its public role:

- Primary CTA: open the AgentPay console.
- No settlement or quote execution from the hero.
- No claim that a user is connected.

The console starts locked:

- Show a compact `Connect agent` panel at the top of the console.
- Ask for a non-secret agent identifier, such as an agent name, handle, or runtime label.
- Explain that the identifier is held only in React memory for the current page lifetime and is lost on refresh.
- If backend auth verification is not configured, say so directly and persistently: `Local session only. Backend auth is not configured.`
- Keep `Quote live evidence` disabled until the agent is connected.
- After connection, show an agent summary, the local-only indicator, and a `Disconnect` action.
- `Reset` clears quote/payment/proof state but should keep the agent connection. Disconnect is explicit.

## Data Flow

The first implementation should keep the identifier local unless the backend exposes an auth contract:

1. User opens the console.
2. UI renders disconnected state.
3. User enters a non-secret runtime agent identifier.
4. UI validates only local shape: non-empty after trimming, maximum 64 characters.
5. UI stores the identifier in React state only.
6. UI unlocks `Quote live evidence`.
7. Existing quote, buy, verify, and record calls continue through the current API path.

This is not a security control. It changes product state and user intent in the browser only. The x402 payment requirement remains the only server-side gate in this slice, and the API remains callable without this UI state. If a later backend verifier is added, the API client can attach a real credential as an authorization header and the server can reject invalid agents. That is outside this slice unless the backend contract already exists.

## Components

Add one focused component:

- `AgentPayConnectionPanel`: renders disconnected, connected, and local-only states.

Update the app shell:

- `App` owns `agentConnection` state.
- `AgentPayHero` remains public and does not receive connection state.
- Console header receives connection state and disables quote until connected.
- Continue settlement, verify, and record actions are also locked when disconnected.
- The payment payload form remains part of the existing x402 continuation flow.

## State

Use a small discriminated union:

```ts
type AgentConnectionState =
  | { status: "disconnected" }
  | { status: "connected"; label: string; localOnly: true };
```

The label is user-entered and non-secret. Do not collect payment keys, API keys, wallet secrets, bearer tokens, private keys, or x402 payment payloads in this field.

Do not persist the identifier in `localStorage`, `sessionStorage`, committed fixtures, query params, cookies, or environment files.

## Error Handling

- Empty identifier: keep the console locked and show an inline validation message.
- Oversized identifier: reject locally at 64 characters to avoid accidental paste of unrelated secrets or files.
- Secret-looking input: reject obvious private key, bearer token, and JSON payment payload shapes with copy that directs users to the x402 payment payload field instead. This is a best-effort hygiene guard, not a guarantee that every secret shape can be detected.
- Different agent connects while quote/payment/proof state exists: clear quote, payment, verification, receipt, registry status, payment payload text, and errors before accepting the new agent label.
- Same-label reconnect after disconnect: keep historical quote/payment/proof state visible, but keep mutation actions locked until the agent is connected again.
- Disconnect during an active quote, payment continuation, verification, or registry record: disable new actions immediately, clear payment payload text, but allow the in-flight request to complete; if it completes after disconnect, surface the result as historical run output and keep all mutation actions locked until another agent connects.
- Backend auth not configured: show local-only messaging, not a success claim.

## Testing

Add focused web tests:

- The console starts locked and `Quote live evidence` is disabled.
- Entering a non-secret identifier connects the agent and unlocks quote.
- Empty identifier does not connect.
- Oversized or secret-looking input does not connect.
- Reset keeps the agent connected.
- Disconnect locks quote again.
- Connecting as a different agent clears previous flow state.
- Continue settlement is locked when disconnected.
- Disconnect during an in-flight request keeps mutation actions locked after completion and surfaces the completed result as historical output.
- Existing x402 flow still works after connecting.

Existing API, MCP, and contract tests should remain unchanged unless backend auth is introduced. Test-only strings may use clearly artificial labels such as `desk-agent-alpha`, but app behavior must not ship a committed demo credential, fake payment payload, fake receipt, or fake Casper interaction.

## Non-Goals

- No fake wallet connection.
- No new wallet dependency.
- No persistent session storage.
- No backend authorization claims unless a verifier is actually implemented.
- No secret credential input until a backend verifier exists.
- No mock payment payload generator.
- No committed demo agent credential.

## Success Criteria

- The product reads as agent aware, not as a random open dapp.
- The public landing page does not expose operator actions.
- The console has a clear local actor-intent boundary before live Casper product interaction.
- The implementation preserves the no-mock-data rule.
- The flow remains compatible with real x402 payment payload continuation and Casper registry recording.
