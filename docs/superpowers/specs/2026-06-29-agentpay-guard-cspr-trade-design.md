# AgentPay Guard — pre-trade trust overlay on cspr.trade

**Date:** 2026-06-29
**Status:** Approved (brainstorm) — pending Codex spec review
**Area:** new `apps/extension` + `apps/report-api` (`/guard` endpoint)

## Goal

Make AgentPay notable by surfacing its trust verdict **where the risk actually happens** — on cspr.trade, *before* a user swaps. A browser extension injects an inline CLEAR / CAUTION / DANGER overlay onto the cspr.trade swap page for the token the user is about to receive. This is the "scam-shield before you swap" pattern (Wallet Guard / Blockaid) for Casper, reusing AgentPay's existing verdict engine + its existing CSPR.trade MCP integration.

## Decisions (from brainstorm)

- **Shape:** browser-extension overlay (we control it; no cspr.trade partnership).
- **Scope:** robust auto-detect of *any* selected token, with an **inline** verdict.
- **Spike result (confirmed live):** `https://cspr.trade/` swap renders **without wallet-connect** (no gate); the "You receive" side has a **"Choose token"** selector that, once picked, shows the token **symbol** as readable text. cspr.trade is a hashed-class Vite SPA, so detection must be **text/structure-based**, not class-based. cspr.trade pairs (via their MCP `get_pairs`) carry `token0`/`token1` objects with `symbol` — the basis for symbol→hash resolution.

## Architecture (3 units)

### 1. `apps/extension` — AgentPay Guard (MV3)
- **content script** on `https://cspr.trade/*`: a `MutationObserver` watches the receive-token selector; when the selected **symbol** changes, debounce (~400ms) and request a verdict. Detection is resilient: locate the token-select control by structure/text near the "You receive" region; ignore `Choose token`, `Loading...`, and the pay-side `CSPR`.
- **overlay**: rendered into a **shadow DOM** (so cspr.trade CSS can't clash), pinned next to the receive field. States: `loading | clear | caution | danger | unknown`. Shows the aspect, the top signal (e.g. "top wallet 64%"), and a "see evidence ↗" link to AgentPay.
- **popup**: on/off toggle + AgentPay base-URL config + link to the app.

### 2. `GET /guard` — resolver + verdict (report-api)
- `GET /guard?symbol=<sym>` (also accept `?hash=<pkg>` to skip resolution).
- Resolve `symbol → token package hash` from cspr.trade `get_pairs` (`token0`/`token1`), scoped to cspr.trade's tradeable set (avoids cross-token ambiguity). Cache the symbol→hash map (TTL ~10m).
- Run the existing assess: `fetchSubjectTokenState(hash)` + `scoreSubject` → verdict.
- Response: `{ symbol, hash, aspect, holders, topHolderPct, flags, network }`. On no match: `{ aspect: "unknown", reason: "not_listed" }`.
- Best-effort + cached; CORS is already enabled on the app.

### 3. Overlay UI component
- Self-contained, themed to AgentPay's aspect colors, injected into the shadow root by the content script. No dots/glow (house rule).

## Data flow

```
cspr.trade swap page
  └─ content script: MutationObserver → selected token symbol
       └─ GET $AGENT_PAY_BASE_URL/guard?symbol=<sym>
            └─ report-api: get_pairs (cspr.trade MCP) → symbol→hash
                 └─ fetchSubjectTokenState(hash) + scoreSubject  (MAINNET)
                      └─ { aspect, holders, topHolderPct, flags }
       └─ render inline overlay (CLEAR / CAUTION / DANGER)
```

## Network + dependencies

- cspr.trade pairs are **mainnet**, so `/guard` assesses on **mainnet** CSPR.cloud. Needs `CSPR_CLOUD_ACCESS_TOKEN`; without it the overlay shows CAUTION/"not checked" (honest degrade).
- Reuses: `csprCloud.ts` (holders/concentration), `scoreSubject` (`@agent-pay/core`), the CSPR.trade MCP client in `liveEvidence.ts`.

## Risks & mitigations

1. **Hashed-class SPA DOM** → detect by text/structure + `MutationObserver`; never depend on a hashed class name. Snapshot-test the detector against a saved cspr.trade DOM.
2. **`token0/token1` hash field name unconfirmed** → confirm the exact field in the first impl step; fallback to CSPR.cloud symbol search if absent.
3. **Symbol ambiguity** → resolve only within cspr.trade's own pair set.
4. **Token not in any pair** → `unknown` / "not listed yet."
5. **Rate limits** → cache `/guard` results + the symbol→hash map.
6. **cspr.trade markup changes** → detector is the only fragile surface; keep it small and isolated.

## Scope / files

- **New** `apps/extension/`: `manifest.json` (MV3), `src/content.ts`, `src/overlay.ts` + `overlay.css`, `src/popup.html` + `popup.ts`, build (vite or tsc → `dist/`), README (load unpacked).
- **New** `report-api`: `GET /guard` route + `resolveSymbolToHash()` in `csprCloud.ts`.
- Loaded **unpacked** for the demo (no Chrome Web Store submission).

## Testing

- Unit: `resolveSymbolToHash` (symbol→hash, miss → unknown), `/guard` (verdict mapping, cache).
- Detector: unit-test against a saved cspr.trade swap-DOM snapshot (symbol extraction + ignore-list).
- Manual: load unpacked on live cspr.trade, pick tokens, confirm overlay.

## Demo

Load the unpacked extension → open cspr.trade → "Choose token" → pick a token → AgentPay Guard flashes the verdict **inline, before you can swap**.

## Out of scope (now)

Chrome Web Store submission; multi-DEX support; any write/transaction action (Guard is read-only/advisory).
