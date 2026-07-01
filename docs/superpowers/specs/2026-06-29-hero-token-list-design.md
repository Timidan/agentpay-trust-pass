# Hero token list that drives the verdict reveal

**Date:** 2026-06-29
**Status:** Approved (brainstorm)
**Area:** `apps/web` landing hero

## Goal

AgentPay is a token *discoverability / trust* protocol, not a swapper. Replace the
hero's swap card with a **token list ("recent checks")**. Hovering/focusing a row
drives the existing WebGL `VerdictReveal` to that token's verdict; when idle the
list auto-advances so the hero animates on its own. This also fixes the prior
problem where the reveal read as a faint backdrop with the verdict word hidden —
the reveal is now the visible focal because it is *about the selected token*.

## Decisions (approved)

- **Concept:** list drives the reveal (selecting a token plays its verdict).
- **Data:** hybrid — **real verdict signals** from the existing `getFeed()`
  (`FeedEntry { id, aspect, subjectShortHash, cardImageUrl }`), **sample charts**
  generated per token (most CEP-18 tokens have no price feed; see
  `docs/research` Casper data findings). No new CSPR.cloud wiring / no browser API key.
- **Idle auto-rotate:** ON (pauses on hover/focus; disabled under reduced motion).
- **Keep `HeroSwapScene`:** leave it defined in `App.tsx` (unused/available), do **not** delete.

## Components

- **`hero-tokens.ts` (new)** — `HeroToken { id, aspect, shortHash, chart }` and
  `getHeroTokens(): Promise<HeroToken[]>`. Maps `getFeed()` entries → `HeroToken`,
  generating a stable per-token chart (seeded by the short hash). **Falls back to
  ~5 seed tokens** when the feed is empty or the backend is unreachable, so the
  hero never looks broken (and jsdom tests pass).
- **`chart-asset.ts` (modify)** — `drawTokenChart(seed?: number)` gains an optional
  seed (mulberry32 PRNG) so each token keeps a stable chart. No-seed call stays random.
- **`HeroTokenList.tsx` (new)** — renders rows (verdict lamp + short hash), marks the
  selected row, exposes `onSelect(index)` and hover/focus → select. Lives in the hero
  card slot (replacing the `HeroSwapScene` render).
- **`HeroVerdictReveal.tsx` (modify)** — becomes **controlled**: takes a `token`
  prop and replays `VerdictReveal` when it changes. Drops internal self-cycling.
- **`App.tsx` / `AgentPayHero` (modify)** — owns `tokens` + `selectedIndex`, fetches
  `getHeroTokens()` once, runs the idle auto-rotate timer (paused on hover/focus, off
  under reduced motion). Renders `<HeroVerdictReveal token={selected}/>` (lazy, focal)
  + `<HeroTokenList .../>` (card). `HeroSwapScene` stays defined but unrendered.

## Data flow

```
AgentPayHero
  ├─ useEffect: getHeroTokens() → setTokens (seed fallback on error/empty)
  ├─ state: selectedIndex (default 0), auto-rotate timer (idle only)
  ├─ <Suspense><HeroVerdictReveal token={tokens[selectedIndex]} /></Suspense>   // backdrop focal
  └─ <HeroTokenList tokens selectedIndex onSelect onHoverStart onHoverEnd />     // card slot
```

## Composition / accessibility

- Reveal becomes the visible focal (verdict word readable); list is the right card.
- Reduced motion / no WebGL: reveal shows the selected verdict statically; list still
  works (DOM). Rows are real buttons (keyboard focus selects → drives reveal).

## Testing

- Keep all existing tests green (the landing `<App/>` renders in 7 evidence-flow tests).
- `getHeroTokens()` must resolve to seed tokens when `getFeed()` rejects (jsdom) so the
  hero renders without a backend.
- Add: hero renders the token list (seed fallback); selecting a row updates the reveal's
  aspect (assert `.vr-root` aspect class / verdict word changes).

## Out of scope (later)

- Real holders/price per row via CSPR.cloud (drops into the `HeroToken` shape later).
- Replacing generated charts with real DEX price series where `fungible-token-rate` exists.
