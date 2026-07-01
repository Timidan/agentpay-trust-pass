# Desk Landing → shadcn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the orphaned `LandingDesk` to the single shipped landing page, grounded on the app's shadcn design system, theme-consistent and dark-mode-capable, then delete the dead landing code.

**Architecture:** Approach A — *token bridge + control swap*. Keep Desk's bespoke structure, rail, feed, and GSAP. Wire `LandingDesk` into `App.tsx`'s landing branch; bridge `desk.css`'s `--d-*` palette to shadcn tokens (panel + fonts stay fixed); swap standard controls to `AgentPay*` shadcn wrappers; add a theme toggle; tokenize two hardcoded dark-mode-breaking spots; relabel/meta; then delete the old hero + the entire Trail prototype set.

**Tech Stack:** React 18 + Vite, TypeScript, Tailwind + shadcn/ui (`AgentPay*` wrappers over Radix), GSAP/ScrollTrigger (bespoke animation), Vitest + jsdom + @testing-library/react, phosphor icons.

**Spec:** `docs/superpowers/specs/2026-06-29-desk-landing-shadcn-design.md`

## Global Constraints

- Work only in `apps/web`. All commands run from `apps/web/`.
- The 4 existing tests must stay green: `test/evidence-flow.test.tsx`, `test/trust-ask.test.tsx`, `test/trust-share.test.tsx`, `test/verdict-reveal.test.tsx` (plus `test/hero-token-list.test.tsx`).
- Gate every task on: `pnpm lint` (tsc `--noEmit`), `pnpm exec vitest run`, and — for CSS/integration tasks — `pnpm build` (`tsc && vite build`).
- App's view-switch is by boolean: `appOpen` → console, `feedOpen`/`trustOpen` → those pages, default → landing. Reuse `openAgentPayApp()` and `toggleTheme()`; do not invent routing.
- Dark mode: the dark palette is `.dark, .agent-pay-app[data-theme="dark"]` (`styles.css:279-280`); App already sets `.dark` on `<html>` via the effect at `App.tsx:118-120`, so bridged `var(--…)` tokens resolve to dark values document-wide.
- `--d-panel`, `--d-panel-line`, `--d-panel-ink`, `--d-panel-mut` (the dark-by-design feed panel) and `--d-font`, `--d-mono` (bespoke fonts) **stay fixed** — never bridge them to theme tokens.
- CSS cleanup is **orphan-based**: only remove a `styles.css` selector after grepping all of `src/` for zero references. Keep shared `agent-pay-app` / `console-*` / `brand-*` / `hero-nav-actions` rules.
- Deletion of dead code happens **after** the new landing is wired and the build is green (Task 8), never before.
- jsdom has no `matchMedia`; the landing mounts `DeskFeed` which calls `window.matchMedia` (`desk-feed.tsx:38`). Every test that renders the landing or `<App/>` must stub `matchMedia` first.

---

## File Structure

**Modify:**
- `apps/web/src/components/AgentPayUi.tsx` — add exported `AgentPayIconAction` (lifted from App).
- `apps/web/src/App.tsx` — import `AgentPayIconAction`; remove its local copy; replace the landing branch body with `<LandingDesk/>`; (Task 9) theme persistence.
- `apps/web/src/landing/LandingDesk.tsx` — root `<main>`→`<div>`; accept `theme`/`onToggleTheme`; add theme toggle; swap controls.
- `apps/web/src/landing/desk.css` — token bridge; tokenize shadows + mask; dark overrides.
- `apps/web/src/landing/desk-feed.tsx` — visible "Example" label.
- `apps/web/index.html` — title/meta to AgentPay branding.

**Create:**
- `apps/web/test/desk-landing.test.tsx` — landing smoke + toggle + label + persistence tests.

**Delete (Task 8):**
- In `App.tsx`: functions `AgentPayHero`, `AgentPayHowItWorks`, `AgentPayProofModel`.
- Files: `landing/LandingTrail.tsx`, `landing/trail-artifacts.tsx`, `landing/drench-rail.tsx`, `landing/trail.css`, `landing/desk-preview.tsx`, `landing/trail-preview.tsx`, `landing/trail-vite.config.ts`.
- Orphaned `styles.css` selectors (verified per-selector).

---

## Task 1: Lift `AgentPayIconAction` into `AgentPayUi`

Shared icon-button (used by the console header today; the landing toggle will reuse it).

**Files:**
- Modify: `apps/web/src/components/AgentPayUi.tsx`
- Modify: `apps/web/src/App.tsx` (remove local def at ~457-477, add import)
- Test: `apps/web/test/desk-landing.test.tsx` (new)

**Interfaces:**
- Produces: `AgentPayIconAction({ children: ReactNode, label: string, onClick: () => void }): JSX.Element` exported from `@/components/AgentPayUi`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/desk-landing.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPayIconAction, AgentPayTooltipProvider } from "../src/components/AgentPayUi";

function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentPayIconAction", () => {
  it("renders an icon button with the label and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <AgentPayTooltipProvider>
        <AgentPayIconAction label="Switch to dark mode" onClick={onClick}>
          <span aria-hidden="true">x</span>
        </AgentPayIconAction>
      </AgentPayTooltipProvider>
    );
    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/desk-landing.test.tsx`
Expected: FAIL — `AgentPayIconAction` is not exported from `AgentPayUi`.

- [ ] **Step 3: Add `AgentPayIconAction` to `AgentPayUi.tsx`**

Ensure `ReactNode` is imported (extend the existing `react` type import):

```tsx
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
```

Append near the other exports (e.g. after `AgentPayTooltip*`):

```tsx
export function AgentPayIconAction({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <AgentPayTooltip>
      <AgentPayTooltipTrigger asChild>
        <AgentPayButton variant="icon" aria-label={label} onClick={onClick}>
          {children}
        </AgentPayButton>
      </AgentPayTooltipTrigger>
      <AgentPayTooltipContent>{label}</AgentPayTooltipContent>
    </AgentPayTooltip>
  );
}
```

- [ ] **Step 4: Remove the local copy from `App.tsx` and import the shared one**

Delete the local `function AgentPayIconAction({ … }) { … }` (App.tsx ~457-477). Add `AgentPayIconAction` to the existing `AgentPayUi` import block in App.tsx (alongside `AgentPayButton`, etc.).

- [ ] **Step 5: Run test + lint to verify pass**

Run: `pnpm exec vitest run test/desk-landing.test.tsx && pnpm lint`
Expected: PASS; tsc reports no errors (App's existing `AgentPayIconAction` usages now resolve to the import).

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentPayUi.tsx src/App.tsx test/desk-landing.test.tsx
git commit -m "refactor(web): lift AgentPayIconAction into AgentPayUi"
```

---

## Task 2: Wire `LandingDesk` as the landing

Replace the old inline hero with `LandingDesk`; fix the nested-`<main>` by making LandingDesk's root a `<div>`.

**Files:**
- Modify: `apps/web/src/App.tsx` (landing branch ~388-411)
- Modify: `apps/web/src/landing/LandingDesk.tsx` (root element + props)
- Test: `apps/web/test/desk-landing.test.tsx`

**Interfaces:**
- Consumes: `openAgentPayApp()`, `toggleTheme()`, `theme` (App.tsx); `LandingVariantProps { theme, onToggleTheme, onOpenApp }` (`landing/types.ts`).
- Produces: App renders `<LandingDesk>` by default; clicking "Launch AgentPay" sets `appOpen=true`.

- [ ] **Step 1: Write the failing integration test**

Append to `apps/web/test/desk-landing.test.tsx`:

```tsx
import App from "../src/App";

describe("Landing integration", () => {
  it("renders the Desk landing by default and opens the console on Launch", () => {
    render(<App />);
    // Desk-unique copy proves LandingDesk (not the old hero) is mounted.
    expect(screen.getByText("One rail, four stops, always in order.")).toBeTruthy();
    // Launch opens the console workspace.
    fireEvent.click(screen.getAllByRole("button", { name: /launch agentpay/i })[0]);
    expect(screen.getByText("Token check console")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/desk-landing.test.tsx`
Expected: FAIL — the old hero renders; "One rail, four stops…" not found.

- [ ] **Step 3: Make `LandingDesk` accept theme props and use a `<div>` root**

In `LandingDesk.tsx`, change the signature (line ~76):

```tsx
export default function LandingDesk({ onOpenApp, theme, onToggleTheme }: LandingVariantProps) {
```

Change the root element (line ~168) and its matching closing tag (line ~333):

```tsx
// from: <main className="lv-desk" ref={scope}>  …  </main>
// to:
<div className="lv-desk" ref={scope}>
  {/* …unchanged children… */}
</div>
```

> Note: `theme`/`onToggleTheme` are consumed by the toggle in Task 4; referencing them now is fine (TS will not complain about unused destructured props).

- [ ] **Step 4: Replace the App landing branch**

In `App.tsx`, replace the entire default return (lines ~388-411) with the same shape the `feedOpen`/`trustOpen` branches use:

```tsx
  return (
    <AgentPayTooltipProvider delayDuration={140}>
      <main className="agent-pay-app" data-theme={theme}>
        <LandingDesk
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenApp={openAgentPayApp}
        />
      </main>
    </AgentPayTooltipProvider>
  );
```

Add the import at the top of `App.tsx`:

```tsx
import LandingDesk from "./landing/LandingDesk";
```

> `AgentPayHero`/`AgentPayHowItWorks`/`AgentPayProofModel` are now unrendered (deleted in Task 8). `agent-pay-landing` and `state-${state}` classes are intentionally dropped — they belonged to the old hero.

- [ ] **Step 5: Run test + lint to verify pass**

Run: `pnpm exec vitest run test/desk-landing.test.tsx && pnpm lint`
Expected: PASS. (tsc may warn about now-unused `AgentPayHero` etc.; that's fine — they're removed in Task 8. If `--noEmit` errors on unused, leave them; they are still referenced by their own definitions until Task 8.)

- [ ] **Step 6: Full build + existing tests**

Run: `pnpm exec vitest run && pnpm build`
Expected: all tests pass; `vite build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/landing/LandingDesk.tsx test/desk-landing.test.tsx
git commit -m "feat(web): wire LandingDesk as the shipped landing"
```

---

## Task 3: Token bridge in `desk.css`

Bridge page-level `--d-*` tokens to shadcn tokens; keep panel + fonts fixed.

**Files:**
- Modify: `apps/web/src/landing/desk.css` (token block, lines 9-22)

- [ ] **Step 1: Edit the `.lv-desk` token block**

Replace lines 9-22 with:

```css
  /* Page-level tokens bridged to the app's shadcn palette (light/dark aware). */
  --d-bg: var(--background);
  --d-surface: color-mix(in oklab, var(--card) 92%, var(--background));
  --d-ink: var(--foreground);
  --d-ink-soft: color-mix(in oklab, var(--foreground) 70%, var(--background));
  --d-mut: var(--muted-foreground);
  --d-line: var(--border);
  --d-line-strong: color-mix(in oklab, var(--border) 60%, var(--foreground));
  --d-orange: var(--primary);
  /* Feed panel is intentionally a fixed dark surface in both themes — do NOT bridge. */
  --d-panel: oklch(17% 0 0);
  --d-panel-line: oklch(29% 0 0);
  --d-panel-ink: oklch(92.5% 0 0);
  --d-panel-mut: oklch(69% 0 0);
  --d-font: "Bricolage Grotesque", system-ui, sans-serif;
  --d-mono: "JetBrains Mono", ui-monospace, monospace;
```

- [ ] **Step 2: Build to confirm CSS is valid**

Run: `pnpm build`
Expected: `vite build` succeeds (no CSS parse errors).

- [ ] **Step 3: Visual verification (manual)**

Run `pnpm dev`, open the landing. Confirm **light mode looks unchanged** from before the bridge (off-white page, near-black ink, orange accents, dark feed panel). Note: dark mode is finished in Task 5 — minor dark glitches here are expected and addressed there.

- [ ] **Step 4: Commit**

```bash
git add src/landing/desk.css
git commit -m "feat(web): bridge desk.css page tokens to shadcn palette"
```

---

## Task 4: Theme toggle in the Desk nav

**Files:**
- Modify: `apps/web/src/landing/LandingDesk.tsx` (nav)
- Test: `apps/web/test/desk-landing.test.tsx`

**Interfaces:**
- Consumes: `AgentPayIconAction` (Task 1), `theme`/`onToggleTheme` props (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/desk-landing.test.tsx`:

```tsx
import LandingDesk from "../src/landing/LandingDesk";
import { AgentPayTooltipProvider as Provider } from "../src/components/AgentPayUi";

describe("LandingDesk theme toggle", () => {
  const noop = () => {};

  it("shows the correct aria-label per theme and fires onToggleTheme", () => {
    const onToggleTheme = vi.fn();
    const { rerender } = render(
      <Provider>
        <LandingDesk theme="light" onToggleTheme={onToggleTheme} onOpenApp={noop} />
      </Provider>
    );
    const toLight = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(toLight);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    rerender(
      <Provider>
        <LandingDesk theme="dark" onToggleTheme={onToggleTheme} onOpenApp={noop} />
      </Provider>
    );
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/desk-landing.test.tsx -t "theme toggle"`
Expected: FAIL — no toggle button exists yet.

- [ ] **Step 3: Add the toggle to the nav**

In `LandingDesk.tsx`, add imports:

```tsx
import { Moon, Sun } from "@phosphor-icons/react";
import { AgentPayIconAction } from "../components/AgentPayUi";
```

In the nav row (`.lv-desk-navrow`, ~line 170-182), add the toggle next to the "Open app" button:

```tsx
<AgentPayIconAction
  label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
  onClick={onToggleTheme}
>
  {theme === "light" ? (
    <Moon size={17} weight="bold" aria-hidden="true" />
  ) : (
    <Sun size={17} weight="bold" aria-hidden="true" />
  )}
</AgentPayIconAction>
```

- [ ] **Step 4: Run test + lint to verify pass**

Run: `pnpm exec vitest run test/desk-landing.test.tsx && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/landing/LandingDesk.tsx test/desk-landing.test.tsx
git commit -m "feat(web): add theme toggle to Desk landing nav"
```

---

## Task 5: Dark-mode pass (tokenize hardcoded shadows + mask)

**Files:**
- Modify: `apps/web/src/landing/desk.css`

- [ ] **Step 1: Add shadow + mask tokens to the `.lv-desk` block**

Append inside the `.lv-desk { … }` token block (after the font lines):

```css
  /* Light defaults for spots that must flip in dark mode. */
  --d-shadow-strong: rgb(0 0 0 / 0.35);
  --d-shadow-soft: rgb(0 0 0 / 0.07);
  --d-mask-color: #000;
```

- [ ] **Step 2: Use the tokens at the two hardcoded sites**

`.lv-desk-feed` box-shadow (lines ~240-242):

```css
  box-shadow:
    0 28px 56px -28px var(--d-shadow-strong),
    0 2px 10px var(--d-shadow-soft);
```

`.lv-desk-feedview` mask (lines ~335-336):

```css
  mask-image: linear-gradient(180deg, transparent 0, var(--d-mask-color) 34px);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, var(--d-mask-color) 34px);
```

- [ ] **Step 3: Add a dark-mode override block**

Append to the end of `desk.css`:

```css
/* Dark mode: applies under the app's global `.dark` (html) and the
   scoped `.agent-pay-app[data-theme="dark"]`. The feed panel stays dark
   by design; only flip the spots that assume a light page. */
.dark .lv-desk,
.agent-pay-app[data-theme="dark"] .lv-desk {
  --d-shadow-strong: rgb(0 0 0 / 0.6);
  --d-shadow-soft: rgb(0 0 0 / 0.3);
  --d-mask-color: #fff;
}
```

- [ ] **Step 4: Build + visual verification (manual, both themes)**

Run: `pnpm build` (expected: succeeds). Then `pnpm dev`:
- Light: unchanged from Task 3.
- Dark (toggle in nav): page background/ink/borders flip; the feed panel stays dark and legible; the feed top **fade mask still works** (content fades in, not clipped to a black block); card shadows read; orange accents (rail fill, dots, pulse, CTA) are visible with adequate contrast. If the dark feed-panel border is too faint, nudge `--d-panel-line` only inside the dark override block.

- [ ] **Step 5: Commit**

```bash
git add src/landing/desk.css
git commit -m "feat(web): make desk.css dark-mode safe (tokenize shadows + mask)"
```

---

## Task 6: Control swap to `AgentPay*` wrappers

**Files:**
- Modify: `apps/web/src/landing/LandingDesk.tsx`
- Modify: `apps/web/src/landing/desk-feed.tsx` (inline code, optional where clean)

**Interfaces:**
- Consumes: `AgentPayButton`, `AgentPayCard`, `AgentPayCodeBlock`, `AgentPayInlineCode` from `@/components/AgentPayUi`.

- [ ] **Step 1: Confirm the smoke test still guards behavior**

The Task 2 integration test asserts "One rail, four stops…" and the Launch→console flow. Keep it as the regression guard — control swap must not change copy or the Launch handler.

- [ ] **Step 2: Swap the three `lv-desk-btn` buttons → `AgentPayButton`**

Add import:

```tsx
import {
  AgentPayButton,
  AgentPayCard,
  AgentPayCodeBlock,
  AgentPayInlineCode,
} from "../components/AgentPayUi";
```

Nav "Open app" (`lv-desk-btn lv-desk-btn-quiet`, ~175):

```tsx
<AgentPayButton variant="secondary" className="lv-desk-btn lv-desk-btn-quiet" onClick={onOpenApp}>
  Open app
</AgentPayButton>
```

Hero CTA + closing CTA (`lv-desk-btn lv-desk-btn-primary`, ~206 and ~299):

```tsx
<AgentPayButton variant="primary" className="lv-desk-btn lv-desk-btn-primary" onClick={onOpenApp}>
  Launch AgentPay
</AgentPayButton>
```

> Keep the `lv-desk-btn*` classNames so desk.css layout/positioning still applies; the wrapper adds the shadcn token-driven base. The footer `lv-desk-footlink` is a text link — convert to `<AgentPayButton variant="explorer" className="lv-desk-footlink" onClick={onOpenApp}>Open app</AgentPayButton>`.

- [ ] **Step 3: Swap the proof artifact `<pre>` → `AgentPayCard` + `AgentPayCodeBlock`**

In the BEATS `.map` (`figure.lv-desk-artifact`, ~282-285):

```tsx
<AgentPayCard className="lv-desk-artifact" as="figure">
  <figcaption>{beat.caption}</figcaption>
  <AgentPayCodeBlock className="whitespace-pre">{beat.artifact}</AgentPayCodeBlock>
</AgentPayCard>
```

> If `AgentPayCard` does not forward an `as` prop (it wraps shadcn `Card`, a `div`), drop `as="figure"` and keep it a `div` — the `figcaption` becomes a `<p className="lv-desk-artifact-cap">`; adjust the desk.css selector if needed. Verify visually that the artifact panels keep their look.

- [ ] **Step 4: (Optional) inline hashes in `desk-feed.tsx` → `AgentPayInlineCode`**

Only where a raw `<code>`/hash span reads cleanly; skip if it risks the feed animation selectors. Do not change any element that the GSAP timeline queries by class.

- [ ] **Step 5: Run tests + lint + build**

Run: `pnpm exec vitest run && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 6: Visual verification (manual)**

`pnpm dev`: buttons and artifact cards look correct in light **and** dark; the rail/feed animations still run.

- [ ] **Step 7: Commit**

```bash
git add src/landing/LandingDesk.tsx src/landing/desk-feed.tsx
git commit -m "feat(web): swap Desk controls to AgentPay shadcn wrappers"
```

---

## Task 7: Visible "Example" label + branding meta

**Files:**
- Modify: `apps/web/src/landing/desk-feed.tsx`
- Modify: `apps/web/index.html`
- Test: `apps/web/test/desk-landing.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/desk-landing.test.tsx`:

```tsx
describe("Illustrative data labeling", () => {
  const noop = () => {};
  it("shows a visible Example/Demo qualifier on the feed", () => {
    render(
      <Provider>
        <LandingDesk theme="light" onToggleTheme={noop} onOpenApp={noop} />
      </Provider>
    );
    // Visible (not sr-only) qualifier somewhere in the feed header.
    expect(screen.getByText(/example/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/desk-landing.test.tsx -t "labeling"`
Expected: FAIL — "Example" currently exists only in sr-only text (which testing-library still reads), so if this passes spuriously, assert on the **visible** bar text instead: `expect(screen.getByText(/example · settlement desk/i)).toBeTruthy();` and proceed to make that literal string visible in Step 3.

- [ ] **Step 3: Add a visible qualifier**

In `desk-feed.tsx`, the visible feed bar (~line 224-225) currently reads "settlement desk". Change the visible label to include the qualifier:

```tsx
<span className="lv-desk-feedlabel">Example · settlement desk</span>
```

Keep the existing sr-only "Example settlement run" paragraph. Confirm the chosen string matches the Step 2 assertion.

- [ ] **Step 4: Update `index.html` title + meta**

Replace the `<title>` (line ~17) and the meta description (lines ~6-9):

```html
<title>AgentPay — an x402-paid evidence desk on Casper</title>
<meta
  name="description"
  content="AgentPay quotes evidence reports in CSPR, settles them over x402, proves each one against its quoted dataset root, and records the decision on Casper."
/>
```

Add Open Graph tags if not present:

```html
<meta property="og:title" content="AgentPay — an x402-paid evidence desk on Casper" />
<meta property="og:description" content="Pay a small x402 fee, get a proven evidence report, and record the verdict on Casper." />
```

- [ ] **Step 5: Run tests + build**

Run: `pnpm exec vitest run && pnpm build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/landing/desk-feed.tsx index.html test/desk-landing.test.tsx
git commit -m "feat(web): label demo run + update landing title/meta to AgentPay"
```

---

## Task 8: Delete dead code (orphan-based)

**Files:**
- Modify: `apps/web/src/App.tsx` (remove 3 functions + dead imports)
- Delete: 7 landing/trail files
- Modify: `apps/web/src/styles.css` (orphaned selectors only)

- [ ] **Step 1: Delete the orphaned files**

```bash
git rm src/landing/LandingTrail.tsx src/landing/trail-artifacts.tsx \
       src/landing/drench-rail.tsx src/landing/trail.css \
       src/landing/desk-preview.tsx src/landing/trail-preview.tsx \
       src/landing/trail-vite.config.ts
```

- [ ] **Step 2: Remove the old hero functions from `App.tsx`**

Delete `function AgentPayHero(…) { … }`, `function AgentPayHowItWorks(…) { … }`, `function AgentPayProofModel(…) { … }` and any now-unused imports they alone used (e.g. the `HeroVerdictReveal` lazy import, `AgentPayHowItWorks`/`ProofModel`-only icon imports). Let `pnpm lint` tell you exactly which imports are now unused.

- [ ] **Step 3: Find orphaned `styles.css` selectors**

For each landing/hero selector family in `styles.css` (e.g. `agent-pay-landing`, `agent-pay-hero`, `hero-*`, `how-it-works*`, `proof-model*`), grep the rest of `src/` for references:

```bash
# Example per class — repeat for each candidate:
grep -rn "agent-pay-hero" src --include=*.tsx --include=*.ts --include=*.html
```

Remove a selector's rules **only if** the grep returns zero matches outside `styles.css`. **Keep** anything still referenced — notably `hero-nav-actions` (used by the console header, `App.tsx:436`), and all `agent-pay-app`, `console-*`, `brand-*` rules.

- [ ] **Step 4: Run the full gate**

Run: `pnpm lint && pnpm exec vitest run && pnpm build`
Expected: tsc clean (no unused symbols), 5 tests + landing tests pass, `vite build` succeeds (proves no deleted-file/`trail-vite.config` reference remains).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(web): remove old hero + orphaned Trail prototype and dead CSS"
```

---

## Task 9: Theme persistence (optional, approved)

App resets to light on reload. Persist to `localStorage` with a `prefers-color-scheme` fallback.

**Files:**
- Modify: `apps/web/src/App.tsx` (theme init + persist)
- Test: `apps/web/test/desk-landing.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/desk-landing.test.tsx`:

```tsx
describe("Theme persistence", () => {
  it("initializes theme from localStorage", () => {
    window.localStorage.setItem("agentpay-theme", "dark");
    render(<App />);
    // documentElement gets the `dark` class from the existing theme effect.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    window.localStorage.removeItem("agentpay-theme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/desk-landing.test.tsx -t "persistence"`
Expected: FAIL — theme initializes to `"light"` unconditionally.

- [ ] **Step 3: Lazy-init theme + persist**

In `App.tsx`, replace `const [theme, setTheme] = useState<ThemeMode>("light");` (line 103) with:

```tsx
const [theme, setTheme] = useState<ThemeMode>(() => {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("agentpay-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
});
```

Extend the existing theme effect (App.tsx:118-120) to persist:

```tsx
useEffect(() => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem("agentpay-theme", theme);
}, [theme]);
```

> The `matchMedia?.` optional call keeps the existing `matchMedia` stub (returns `matches:false`) safe; the persistence test sets `localStorage` so it does not depend on `matchMedia`.

- [ ] **Step 4: Run test + full gate**

Run: `pnpm exec vitest run && pnpm lint && pnpm build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx test/desk-landing.test.tsx
git commit -m "feat(web): persist theme to localStorage with system fallback"
```

---

## Self-Review

**Spec coverage:** §4.1 integration → Task 2; §4.2 control swap → Task 6; §4.3 token bridge → Task 3; §4.4 theme toggle → Tasks 1+4; §4.5 dark-mode pass → Task 5; §4.6 visible label → Task 7; §4.7 meta → Task 7; §4.8 cleanup → Task 8; §4.9 persistence → Task 9; §6 testing → tests in Tasks 1,2,4,7,9; §5 sequencing (wire→shadcn→label→**then** delete) → Task order. All covered.

**Placeholder scan:** No TBD/TODO; every code step shows real code; derived CSS values are concrete with a stated tuning allowance (not a placeholder). Manual visual-verification steps are explicitly labeled as such (CSS has no unit test).

**Type/name consistency:** `AgentPayIconAction({children,label,onClick})` defined in Task 1, consumed in Task 4. `LandingDesk({onOpenApp,theme,onToggleTheme})` set in Task 2, used in Task 4. `openAgentPayApp`/`toggleTheme` match App.tsx. localStorage key `agentpay-theme` consistent across Task 9. matchMedia stub helper defined once (Task 1), reused.

**Known soft spots (handle during execution):** (a) `AgentPayCard` `as="figure"` may not be supported — Task 6 Step 3 gives the `div` fallback. (b) Task 2 Step 5 notes the transient unused-symbol warnings resolved in Task 8. (c) Task 7 Step 2 hardens the label assertion against sr-only false-positives.
