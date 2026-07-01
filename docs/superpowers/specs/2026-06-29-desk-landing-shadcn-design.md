# Design: Promote the Desk landing to the real landing, on shadcn

**Date:** 2026-06-29
**Status:** Approved design — pending spec review, then implementation plan
**Scope:** `apps/web` frontend only

## 1. Goal

Make `LandingDesk` the single shipped landing page, grounded on the app's shadcn
design system, theme-consistent with the console, and dark-mode-capable —
**without redesigning its look**. Then delete everything this makes dead.

This is **Approach A** (token bridge + control swap), chosen over a deeper
component extraction (B) or a full re-skin (C), because the user likes the
current Desk look and the priority is consistency + cleanup, not a visual
redesign.

### Non-goals (explicitly out of scope)
- Console/backend wiring or env configuration (a separate workstream).
- The phosphor-vs-lucide icon-set duplication (app-wide; not this task).
- Any visual redesign of Desk's layout, rail, feed, or artifacts.
- `LandingTrail` as a future option — we are deleting it.

## 2. Current state (verified)

- **Shipped landing today** is inline in `apps/web/src/App.tsx`:
  `AgentPayHero` (App.tsx:748), `AgentPayHowItWorks` (App.tsx:1120),
  `AgentPayProofModel` (App.tsx:1159), rendered in the default return branch at
  App.tsx:388–411.
- **`LandingDesk`** (`apps/web/src/landing/LandingDesk.tsx`, `desk.css` 854 lines,
  `desk-feed.tsx`) is **orphaned** — imported only by `desk-preview.tsx`, which is
  not wired into `index.html` (single entry: `/src/main.tsx`) or any build script.
- **`LandingTrail`** + `trail.css` + `trail-artifacts.tsx` + `drench-rail.tsx` +
  `*-preview.tsx` + `trail-vite.config.ts` are also orphaned. `drench-rail` has
  **zero** importers (not even Trail); `trail-artifacts` feeds only `LandingTrail`.
- **View switching** in App.tsx is by boolean: `appOpen` → console
  (App.tsx:350), `feedOpen`/`trustOpen` → those pages, default → landing.
  `openAgentPayApp()` (App.tsx:321) and `toggleTheme()` (App.tsx:317) exist.
- **Illustrative data**: `desk-data.ts` `RUN` constant; `desk-feed.tsx` labels it
  "Example settlement run" but **only in sr-only text** (desk-feed.tsx:217) — the
  visible panel shows "settlement desk · run 0x2f41" with no "Example" qualifier.

## 3. Critical integration facts (verified by hardening pass)

These corrected the initial design and must be honored:

1. **Dark mode needs the `agent-pay-app` class, not just `data-theme`.** The dark
   palette is defined under `.dark, .agent-pay-app[data-theme="dark"]`
   (styles.css:279–280) and `.agent-pay-app[data-theme="dark"].agent-pay-landing`
   (styles.css:343). `LandingDesk`'s root is a bare `<main className="lv-desk">`
   with no `agent-pay-app` class.
   → **Resolution:** keep App's landing wrapper as
   `<main className="agent-pay-app agent-pay-landing state-${state}" data-theme={theme}>`
   and change `LandingDesk`'s root from `<main className="lv-desk">` to
   `<div className="lv-desk">`. This simultaneously (a) avoids the nested-`<main>`
   bug and (b) keeps the `.agent-pay-app[data-theme]` ancestor so the bridged
   `--d-*` tokens resolve to the correct light/dark shadcn values via the cascade.
   *(This reverses the initial "move data-theme onto LandingDesk root" idea, which
   would have silently broken dark mode.)*

2. **The DeskFeed panel palette is intentionally dark in light mode.** `--d-panel`
   (oklch 17%), `--d-panel-ink` (oklch 92.5%), `--d-panel-line` (oklch 29%),
   `--d-panel-mut` (oklch 69%) render a dark panel on the light page by design.
   → **Do NOT bridge `--d-panel*` to `var(--card)`/theme tokens** (that would make
   the panel light and destroy the look). Keep them as fixed values; add an
   explicit dark-mode override only if the dark-panel-on-dark-page contrast needs
   it (verification item in §7).

3. **`desk.css` is not 100% tokenized.** Two hardcoded spots will not flip in dark
   mode and must be tokenized with dark overrides:
   - `box-shadow: … rgb(0 0 0 / 0.35), … rgb(0 0 0 / 0.07)` (desk.css:241–242).
   - `mask-image: linear-gradient(180deg, transparent 0, #000 34px)` (desk.css:335–336).
   So "dark mode for free" is false — there is a real, bounded dark-mode pass.

## 4. Work breakdown

### 4.1 Integration (App.tsx)
- Replace the landing branch body (App.tsx:388–411) — `<AgentPayHero/>`,
  `<AgentPayHowItWorks/>`, `<AgentPayProofModel/>`, `<footer>` — with
  `<LandingDesk theme={theme} onToggleTheme={toggleTheme} onOpenApp={openAgentPayApp} />`.
- Keep the surrounding `<main className="agent-pay-app agent-pay-landing …" data-theme={theme}>`.
- Change `LandingDesk` root `<main className="lv-desk">` → `<div className="lv-desk">`
  (its own `<header>`/`<footer>` inside are fine).
- `LandingVariantProps` already declares `theme`/`onToggleTheme`; `LandingDesk`
  currently ignores them — start using them (theme toggle, §4.4).
- "Launch AgentPay"/"Open app" call `onOpenApp` → `openAgentPayApp()` → console.
  No new routing needed.

### 4.2 Control swap (the shadcn part)
Verified surface (smaller than first estimated):

| Desk markup | Count | → shadcn wrapper |
|---|---|---|
| `<button className="lv-desk-btn …">` (nav, hero CTA, closing CTA) | 3 | `AgentPayButton` (`variant` primary/secondary/ghost) |
| `<button className="lv-desk-footlink">` (footer "Open app") | 1 | `AgentPayButton` (`variant="ghost"` or `explorer`) |
| `<figure className="lv-desk-artifact"><pre>{beat.artifact}</pre>` (BEATS `.map`, renders 3) | 1 template | `AgentPayCard` + `AgentPayCodeBlock` |
| inline hashes in DeskFeed / footer | a few | `AgentPayInlineCode` where it reads cleanly |
| raw rules / dividers | as present | `AgentPaySeparator` where used |

Wrapper APIs (from `AgentPayUi.tsx`): `AgentPayButton` (variants
primary/secondary/ghost/icon/explorer/nav; sizes default/hero/compact),
`AgentPayCard` (`panel border-border bg-card text-card-foreground`),
`AgentPayCodeBlock` (`<code>` themed `bg-muted text-foreground`),
`AgentPayInlineCode`, `AgentPaySeparator`.

**Stays bespoke (intentional, no shadcn equivalent):** the rail and 4 scroll-stops,
`DeskFeed`, the GSAP scroll/pin work, and the overall layout.

### 4.3 Token bridge (`desk.css`)
`desk.css` defines **14** `--d-*` tokens. Rewrite the definition block so page-level
tokens reference shadcn tokens; keep panel + fonts fixed:

| `--d-*` token | Bridge to |
|---|---|
| `--d-bg` | `var(--background)` |
| `--d-ink` | `var(--foreground)` |
| `--d-orange` | `var(--primary)` *(primary already has a dark variant — handles orange-on-dark)* |
| `--d-line` | `var(--border)` |
| `--d-mut` | `var(--muted-foreground)` |
| `--d-surface` | `color-mix(in oklab, var(--card), var(--background))` (derived) |
| `--d-ink-soft` | `color-mix(in oklab, var(--foreground) 70%, var(--background))` (derived) |
| `--d-line-strong` | `color-mix(in oklab, var(--border) 70%, var(--foreground))` (derived) |
| `--d-panel`, `--d-panel-line`, `--d-panel-ink`, `--d-panel-mut` | **keep fixed** (dark-by-design feed panel) |
| `--d-font`, `--d-mono` | **keep** (bespoke fonts: Bricolage Grotesque / JetBrains Mono) |

Exact derived values are finalized in implementation and tuned by eye; the table
fixes the *strategy*, not the final color math.

### 4.4 Theme toggle
`LandingDesk` renders no theme control. Add one to its nav:
- Use `AgentPayButton variant="icon"` with phosphor `Moon`/`Sun` (matches the
  console header pattern at App.tsx:443–448), wired to `onToggleTheme`.
- **Required:** dynamic `aria-label` ("Switch to dark mode" / "Switch to light
  mode") that updates with the current theme.
- Optionally lift the existing `AgentPayIconAction` helper (App.tsx:457) into
  `AgentPayUi.tsx` for reuse instead of duplicating; not required for correctness.

### 4.5 Dark-mode pass (bounded, not free)
- Tokenize the two hardcoded spots (§3.3): introduce `--d-shadow-strong` /
  `--d-shadow-soft` and `--d-mask-color`, default to current light values, and add
  dark overrides under `.agent-pay-app[data-theme="dark"] .lv-desk` (e.g. lighter
  shadow alpha; `--d-mask-color: #fff` so the fade mask stays correct).
- Verify the dark-panel-on-dark-page contrast (DeskFeed panel + `--d-panel-line`
  border); add a small dark override only if needed.
- Verify `--d-orange → var(--primary)` reads well as rail fill / dots / pulse / CTA
  in both themes (primary dark variant is `hsl(36 96% 56%)`).

### 4.6 Illustrative-data labeling
The user chose "keep illustrative, clearly labeled." Strengthen the **visible**
label so a sighted visitor cannot read it as a live production run: add an
"Example" / "Demo" qualifier to the visible DeskFeed header (desk-feed.tsx ~224),
not only the sr-only text.

### 4.7 Branding / meta
`index.html` title is "Trust Signal — is this Casper token safe?" and its meta
describes Trust Signal. The Desk landing is AgentPay / "evidence desk." Update the
`<title>` and meta description (and add `og:title`/`og:description` if absent) to
match the shipped landing's brand.

### 4.8 Cleanup (orphan-based, verified safe)
After Desk is wired and rendering, delete in one pass:
- **TSX symbols** from App.tsx: `AgentPayHero`, `AgentPayHowItWorks`,
  `AgentPayProofModel` (used only in App.tsx — verified zero external refs).
- **Files:** `landing/LandingTrail.tsx`, `landing/trail-artifacts.tsx`,
  `landing/drench-rail.tsx` (zero importers), `landing/trail.css`,
  `landing/desk-preview.tsx`, `landing/trail-preview.tsx`,
  `landing/trail-vite.config.ts` (no build-script refs).
- **CSS:** remove only `styles.css` selectors that are **orphaned** after the TSX
  deletions, verified by grepping each selector across remaining `src/` for zero
  references. **Keep** shared `agent-pay-app` / `console-*` / `brand-*` /
  `hero-nav-actions` rules (`hero-nav-actions` is reused by the console header at
  App.tsx:436).

### 4.9 Optional (recommended, easily cut at review)
- **Theme persistence:** App.tsx initializes `theme="light"` with no persistence.
  Add `localStorage` write on toggle + read on mount, falling back to
  `prefers-color-scheme`. Small, app-wide UX win; clearly severable.

## 5. Sequencing
1. Wire `LandingDesk` into App.tsx (§4.1) with `<div>` root + theme props.
2. Token bridge (§4.3) + theme toggle (§4.4) + dark-mode pass (§4.5).
3. Label (§4.6) + meta (§4.7).
4. Run `tsc` + tests + `vite build`; visually verify light **and** dark.
5. **Then** delete dead code + orphaned CSS (§4.8) in one atomic step.
6. Re-run `tsc` + tests + `vite build` (the build catches any deleted-preview /
   `trail-vite.config` reference).
7. (Optional) theme persistence (§4.9).

Deletion comes **after** wire-in so the build proves the new landing works before
removing fallbacks, and so orphan-verification greps run while the old code still
exists.

## 6. Testing
No existing test covers the landing (verified). Add one jsdom/Vitest smoke test:
- App renders `LandingDesk` by default (e.g. asserts a Desk-only string).
- The example run is present **and** carries a visible "Example/Demo" label.
- Clicking "Launch AgentPay" sets `appOpen` (console view renders).
- A `prefers-color-scheme`/reduced-motion case asserts DeskFeed shows its final
  resting state (panels visible) rather than a stuck mid-animation state.

Keep the 4 existing tests green (`evidence-flow`, `trust-ask`, `trust-share`,
`verdict-reveal`). Gate on `tsc`, the test suite, and `vite build`.

## 7. Risks & mitigations
| Risk | Mitigation |
|---|---|
| CSS over-deletion removes shared chrome | Orphan-based removal (grep each selector for zero refs) + `vite build` |
| Dark mode breaks on hardcoded shadows/mask | §4.5 tokenization + explicit dark overrides; verify both themes before cleanup |
| Dark panel unreadable on dark page | Keep `--d-panel*` fixed; add targeted dark override only if contrast check fails |
| Nested `<main>` / lost dark-token ancestor | §3.1: App keeps `<main class="agent-pay-app" data-theme>`, LandingDesk root → `<div>` |
| GSAP rail-pin / DeskFeed jank after theme toggle | Verify ScrollTrigger state survives toggle; `ScrollTrigger.refresh()` if needed |
| Reduced-motion leaves animation stuck | DeskFeed early-returns at desk-feed.tsx:38; smoke test asserts final visible state |

## 8. Open decisions for review
1. **Theme persistence (§4.9):** include now, or leave `theme` ephemeral? (Default: include.)
2. **Dark-mode depth:** ship the bounded pass in §4.5, or also retune the fixed
   panel for a bespoke dark treatment? (Default: bounded pass; retune only if the
   contrast check fails.)
3. **Lift `AgentPayIconAction` to `AgentPayUi`** for the toggle, or inline a
   one-off icon button in LandingDesk? (Default: lift, for reuse.)
