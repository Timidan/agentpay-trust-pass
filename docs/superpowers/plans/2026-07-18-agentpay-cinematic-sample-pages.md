# AgentPay Cinematic Sample Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three polished, independently routed cinematic AgentPay sample pages without changing the existing landing page.

**Architecture:** A shared native scroll engine writes normalized timeline and pointer values to CSS custom properties on one sticky scene. Shared chrome and an accessible card rail provide consistent navigation; each page owns isolated React markup, content, and CSS so the three visual systems can be developed in parallel after the foundation lands.

**Tech Stack:** React 19, TypeScript 5.8, React Router, browser `requestAnimationFrame`, CSS custom properties, existing Phosphor and AgentPay icons, Vitest, Testing Library, Playwright.

## Global Constraints

- Keep `/` visually and behaviorally unchanged; do not edit `apps/web/src/landing2/Landing.tsx` or `apps/web/src/landing2/landing2.css`.
- Add exactly these routes: `/cinematic/proof-corridor`, `/cinematic/signal-field`, and `/cinematic/evidence-chamber`.
- Add no runtime dependency and do not use a prerecorded video as any page's scroll timeline.
- Reuse AgentPay's existing lavender, plum, paper, semantic verdict colors, logo, brand marks, and workflow icons.
- Every visible control must work and every product claim must match `docs/live-capabilities.md`.
- Each timeline must reverse deterministically, remain usable on mobile, and preserve all content under `prefers-reduced-motion`.
- New CSS must be scoped beneath `.cinematic-page`; the existing global landing styles are not a rendering dependency.
- Use semantic landmarks, headings, lists, links, buttons, visible focus states, and empty alternative text for decorative imagery.

## File Structure

- `apps/web/src/cinematic/timeline.ts` — pure timeline math.
- `apps/web/src/cinematic/useCinematicTimeline.ts` — section-local scroll, pointer, resize, reduced-motion, and CSS-property orchestration.
- `apps/web/src/cinematic/types.ts` — shared slug and rail-item contracts.
- `apps/web/src/cinematic/CinematicChrome.tsx` — persistent mark, concept switcher, back link, and progress cue.
- `apps/web/src/cinematic/CinematicRail.tsx` — keyboard- and touch-operable final rail.
- `apps/web/src/cinematic/cinematic-base.css` — reset, tokens, sticky stage, chrome, rail, focus, responsive, and reduced-motion primitives.
- `apps/web/src/cinematic/proof-corridor/ProofCorridorPage.tsx` and `proof-corridor.css` — product-story world.
- `apps/web/src/cinematic/signal-field/SignalFieldPage.tsx` and `signal-field.css` — visual experiment world.
- `apps/web/src/cinematic/evidence-chamber/EvidenceChamberPage.tsx` and `evidence-chamber.css` — audit-story world.
- `apps/web/test/cinematic/timeline.test.ts` — pure timeline unit tests.
- `apps/web/test/cinematic/shared.test.tsx` — chrome, rail, and reduced-motion behavior.
- `apps/web/test/cinematic/proof-corridor.test.tsx` — Proof Corridor content and actions.
- `apps/web/test/cinematic/signal-field.test.tsx` — Signal Field content and actions.
- `apps/web/test/cinematic/evidence-chamber.test.tsx` — Evidence Chamber content and actions.
- `apps/web/test/cinematic/routes.test.tsx` — direct-route integration and landing isolation.
- `scripts/e2e-cinematic-ui.ts` — checkpoint, viewport, keyboard, reduced-motion, and console QA.
- `scripts/test/cinematic-ui-script.test.ts` — package-script and QA-contract coverage.
- `docs/cinematic-samples.md` — routes, asset manifest, timeline map, run command, and verification notes.

---

### Task 1: Shared Cinematic Foundation

**Files:**
- Create: `apps/web/src/cinematic/types.ts`
- Create: `apps/web/src/cinematic/timeline.ts`
- Create: `apps/web/src/cinematic/useCinematicTimeline.ts`
- Create: `apps/web/src/cinematic/CinematicChrome.tsx`
- Create: `apps/web/src/cinematic/CinematicRail.tsx`
- Create: `apps/web/src/cinematic/cinematic-base.css`
- Test: `apps/web/test/cinematic/timeline.test.ts`
- Test: `apps/web/test/cinematic/shared.test.tsx`

**Interfaces:**
- Produces `CinematicSlug = "proof-corridor" | "signal-field" | "evidence-chamber"`.
- Produces `CinematicRailItem = { id: string; eyebrow: string; title: string; body: string; href: string }`.
- Produces `clamp`, `lerp`, `smoothstep`, `rangeProgress`, and `segmentInOut` from `timeline.ts`.
- Produces `useCinematicTimeline(options?: { smoothing?: number }): { sectionRef; stageRef; reducedMotion; jumpToProgress }`.
- Produces `<CinematicChrome current={slug} progressLabel="Scroll to inspect" />` and `<CinematicRail ariaLabel items />`.

- [ ] **Step 1: Write failing timeline tests**

```ts
import { describe, expect, it } from "vitest";
import { clamp, lerp, rangeProgress, segmentInOut, smoothstep } from "../../src/cinematic/timeline";

describe("cinematic timeline math", () => {
  it("clamps and interpolates without overshoot", () => {
    expect(clamp(-1)).toBe(0);
    expect(clamp(2)).toBe(1);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it("maps a local range and eases its edges", () => {
    expect(rangeProgress(0.2, 0.2, 0.4)).toBe(0);
    expect(rangeProgress(0.3, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it("creates deterministic enter, hold, and exit visibility", () => {
    expect(segmentInOut(0.1, 0.2, 0.3, 0.5, 0.6)).toBe(0);
    expect(segmentInOut(0.4, 0.2, 0.3, 0.5, 0.6)).toBe(1);
    expect(segmentInOut(0.6, 0.2, 0.3, 0.5, 0.6)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the timeline test and confirm the missing-module failure**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/timeline.test.ts`

Expected: FAIL because `src/cinematic/timeline.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers and shared contracts**

```ts
// apps/web/src/cinematic/types.ts
export type CinematicSlug = "proof-corridor" | "signal-field" | "evidence-chamber";

export type CinematicRailItem = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  href: string;
};
```

```ts
// apps/web/src/cinematic/timeline.ts
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;
export const smoothstep = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
export const rangeProgress = (value: number, start: number, end: number) =>
  start === end ? Number(value >= end) : clamp((value - start) / (end - start));
export const segmentInOut = (
  value: number,
  enterStart: number,
  enterEnd: number,
  exitStart: number,
  exitEnd: number,
) => smoothstep(rangeProgress(value, enterStart, enterEnd)) * (1 - smoothstep(rangeProgress(value, exitStart, exitEnd)));
```

- [ ] **Step 4: Run the pure tests and confirm they pass**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/timeline.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Write failing shared-component tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CinematicChrome } from "../../src/cinematic/CinematicChrome";
import { CinematicRail } from "../../src/cinematic/CinematicRail";

const items = [
  { id: "terms", eyebrow: "01", title: "Terms", body: "Read the exact charge.", href: "/audit" },
  { id: "receipt", eyebrow: "02", title: "Receipt", body: "Verify the result.", href: "/app" },
];

describe("cinematic shared UI", () => {
  it("links all concepts and marks the current one", () => {
    render(<MemoryRouter><CinematicChrome current="signal-field" progressLabel="Scroll to inspect" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Signal Field" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Back to AgentPay" }).getAttribute("href")).toBe("/");
  });

  it("moves the accessible rail with previous and next controls", () => {
    render(<MemoryRouter><CinematicRail ariaLabel="Signal anatomy" items={items} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Next item" }));
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous item" }));
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });
});
```

- [ ] **Step 6: Implement the scroll hook, chrome, rail, and base CSS**

The hook must compute local progress from `section.getBoundingClientRect()` and `section.offsetHeight - innerHeight`, cache geometry on resize, listen passively, request work through `requestAnimationFrame`, write `--cinematic-p`, `--cinematic-x`, and `--cinematic-y` to `stageRef.current.style`, stop frames after values converge, and expose `jumpToProgress()` using the section's document offset. Reduced motion sets the playhead directly and pointer values to zero.

`CinematicChrome` must render the AgentPay logo, the three exact route links, a back link, and the progress cue. `CinematicRail` must keep one logical item set, update an accessible `n / total` status, scroll the active card into view, support buttons, ArrowLeft/ArrowRight, and touch/pointer swiping, and render real anchors for every item.

Base CSS must define `.cinematic-page`, `.cinematic-scroll`, `.cinematic-stage`, z-index bands `0–9`, `10–19`, `20–29`, and `30–39`, focus states, a 4,600px desktop scroll length, a 3,600px tablet length, a 3,000px mobile length, and normal-flow reduced-motion content.

- [ ] **Step 7: Run shared tests and type checking**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/timeline.test.ts test/cinematic/shared.test.tsx`

Expected: all tests PASS.

Run: `pnpm --filter @agent-pay/web lint`

Expected: TypeScript exits 0.

- [ ] **Step 8: Commit the foundation**

```bash
git add apps/web/src/cinematic apps/web/test/cinematic/timeline.test.ts apps/web/test/cinematic/shared.test.tsx
git commit -m "feat: add cinematic scroll foundation"
```

---

### Task 2: Proof Corridor Page

**Files:**
- Create: `apps/web/src/cinematic/proof-corridor/ProofCorridorPage.tsx`
- Create: `apps/web/src/cinematic/proof-corridor/proof-corridor.css`
- Test: `apps/web/test/cinematic/proof-corridor.test.tsx`

**Interfaces:**
- Consumes `useCinematicTimeline`, `CinematicChrome`, `CinematicRail`, `CinematicRailItem`, and workflow icons from `landing2/icons.tsx`.
- Produces default export `ProofCorridorPage` with one `<main className="cinematic-page proof-corridor">`.

- [ ] **Step 1: Write the failing page test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ProofCorridorPage from "../../src/cinematic/proof-corridor/ProofCorridorPage";

describe("Proof Corridor", () => {
  it("renders the full truthful product story and real final links", () => {
    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "The path from charge to proof." })).toBeTruthy();
    expect(screen.getByText("Your wallet signs. AgentPay never receives the key.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Payment checker/i }).getAttribute("href")).toBe("/audit");
    expect(screen.getByRole("link", { name: /Console/i }).getAttribute("href")).toBe("/app");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-page failure**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/proof-corridor.test.tsx`

Expected: FAIL because `ProofCorridorPage.tsx` does not exist.

- [ ] **Step 3: Build the complete Proof Corridor scene**

Create one sticky stage with: overscanned lavender corridor rings; a semantic payment-request card; four depth-separated workflow icon stations; opening, check, signing, and receipt copy panels; a Casper anchor seal; the shared chrome; and a final rail whose real routes are `/audit`, `/check`, `/counterparty`, `/agents`, and `/app`. Map all transforms and visibility to `--cinematic-p` with enter/hold/exit windows matching the spec checkpoints. Keep decorative layers `aria-hidden="true"`; keep all narrative copy in semantic HTML.

The stylesheet must create depth with opposing scale/translation, restrict blur to the focused panels, prevent exposed edges at 390×844 through 1440×900, and switch to static hero plus normal-flow narratives and rail in the reduced-motion query.

- [ ] **Step 4: Run the page test and build check**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/proof-corridor.test.tsx && pnpm --filter @agent-pay/web lint`

Expected: test PASS and TypeScript exits 0.

- [ ] **Step 5: Commit Proof Corridor**

```bash
git add apps/web/src/cinematic/proof-corridor apps/web/test/cinematic/proof-corridor.test.tsx
git commit -m "feat: build Proof Corridor cinematic page"
```

---

### Task 3: Signal Field Page

**Files:**
- Create: `apps/web/src/cinematic/signal-field/SignalFieldPage.tsx`
- Create: `apps/web/src/cinematic/signal-field/signal-field.css`
- Test: `apps/web/test/cinematic/signal-field.test.tsx`

**Interfaces:**
- Consumes the shared cinematic foundation from Task 1.
- Produces default export `SignalFieldPage` with one `<main className="cinematic-page signal-field">`.

- [ ] **Step 1: Write the failing page test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SignalFieldPage from "../../src/cinematic/signal-field/SignalFieldPage";

describe("Signal Field", () => {
  it("keeps the experiment minimal while exposing a usable signal catalog", () => {
    render(<MemoryRouter><SignalFieldPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Every payment leaves a shape." })).toBeTruthy();
    expect(screen.getByText("AgentPay makes it legible.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Signal anatomy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wallet boundary/i }).getAttribute("href")).toBe("/agents");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-page failure**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/signal-field.test.tsx`

Expected: FAIL because `SignalFieldPage.tsx` does not exist.

- [ ] **Step 3: Build the complete Signal Field scene**

Create one dark-plum sticky world from semantic DOM plus decorative SVG/CSS: five overscanned metallic membranes at distinct depths, two elliptical signal orbits, a central AgentPay proof glyph, restrained grain, opening and resolution copy, shared chrome, and a final Signal Anatomy rail. Do not use `/media/liquid-metal.mp4` or any video element. Rail items are Terms (`/audit`), Policy (`/audit`), Wallet boundary (`/agents`), Settlement (`/app`), and Receipt (`/app`).

Use `--cinematic-p`, `--cinematic-x`, and `--cinematic-y` so noisy asymmetric forms separate, focus around the first narrative checkpoint, and converge into one clean lavender signal by the final checkpoint. Avoid continuous decorative animation after the timeline settles. Reduced motion renders a static resolved signal followed by all copy and cards in normal flow.

- [ ] **Step 4: Run the page test and build check**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/signal-field.test.tsx && pnpm --filter @agent-pay/web lint`

Expected: test PASS and TypeScript exits 0.

- [ ] **Step 5: Commit Signal Field**

```bash
git add apps/web/src/cinematic/signal-field apps/web/test/cinematic/signal-field.test.tsx
git commit -m "feat: build Signal Field cinematic page"
```

---

### Task 4: Evidence Chamber Page

**Files:**
- Create: `apps/web/src/cinematic/evidence-chamber/EvidenceChamberPage.tsx`
- Create: `apps/web/src/cinematic/evidence-chamber/evidence-chamber.css`
- Test: `apps/web/test/cinematic/evidence-chamber.test.tsx`

**Interfaces:**
- Consumes the shared cinematic foundation and `IconProbe`, `IconCheck`, `IconVerify`, and `IconReceiptAnchored`.
- Produces default export `EvidenceChamberPage` with one `<main className="cinematic-page evidence-chamber">`.

- [ ] **Step 1: Write the failing page test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import EvidenceChamberPage from "../../src/cinematic/evidence-chamber/EvidenceChamberPage";

describe("Evidence Chamber", () => {
  it("shows the exact audit sequence and real actions", () => {
    render(<MemoryRouter><EvidenceChamberPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Before the wallet signs anything." })).toBeTruthy();
    expect(screen.getByText("Amount, asset, network, payee, and request binding.")).toBeTruthy();
    expect(screen.getByText("PIN / DENY and spend controls")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open payment checker/i }).getAttribute("href")).toBe("/audit");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-page failure**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/evidence-chamber.test.tsx`

Expected: FAIL because `EvidenceChamberPage.tsx` does not exist.

- [ ] **Step 3: Build the complete Evidence Chamber scene**

Create one warm paper-and-plum sticky evidence room: an overscanned perspective grid; one semantic payment-request hero with REVIEW state; six visual layers for request binding, charge terms, policy, payer authorization, settlement match, and receipt anchor; shared workflow icons; five narrative panels; a stamped receipt final state; shared chrome; and final links to `/audit`, `/agents`, `/app`, and `/`.

Use depth-aware transforms so the request disassembles into inspectable layers, holds each panel without text collision, then reseals. Semantic verdict colors retain their established meanings. Reduced motion shows the intact request and every audit checkpoint as a normal-flow evidence list before the rail.

- [ ] **Step 4: Run the page test and build check**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/evidence-chamber.test.tsx && pnpm --filter @agent-pay/web lint`

Expected: test PASS and TypeScript exits 0.

- [ ] **Step 5: Commit Evidence Chamber**

```bash
git add apps/web/src/cinematic/evidence-chamber apps/web/test/cinematic/evidence-chamber.test.tsx
git commit -m "feat: build Evidence Chamber cinematic page"
```

---

### Task 5: Router Integration and Landing Isolation

**Files:**
- Modify: `apps/web/src/App.tsx:65-75,119-134,140-230`
- Modify: `apps/web/src/shared/living-field.css`
- Create: `apps/web/test/cinematic/routes.test.tsx`

**Interfaces:**
- Consumes the three default page exports from Tasks 2–4.
- Produces the three public sample routes and the `.route-cinematic` document class.

- [ ] **Step 1: Write failing direct-route tests**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../src/App";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("cinematic routes", () => {
  for (const [path, heading] of [
    ["/cinematic/proof-corridor", "The path from charge to proof."],
    ["/cinematic/signal-field", "Every payment leaves a shape."],
    ["/cinematic/evidence-chamber", "Before the wallet signs anything."],
  ] as const) {
    it(`renders ${path} directly`, () => {
      window.history.pushState({}, "", path);
      render(<App />);
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
      expect(document.documentElement.classList.contains("route-cinematic")).toBe(true);
    });
  }

  it("leaves the existing landing copy intact", () => {
    render(<App />);
    expect(screen.getByText("From the charge to a receipt on Casper.")).toBeTruthy();
    expect(document.documentElement.classList.contains("route-cinematic")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the route test and confirm the redirect-to-landing failure**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic/routes.test.tsx`

Expected: FAIL because each cinematic path is caught by the wildcard route.

- [ ] **Step 3: Add imports, routes, and route-class cleanup**

Import the three pages near the other routed pages. In the route bookkeeping effect, set `const isCinematic = pathname.startsWith("/cinematic/")`, toggle `route-cinematic`, and remove it in cleanup. Add the three exact `<Route>` entries before the wildcard. Do not pass theme props; each concept owns a fixed art-directed color system.

Add this isolated field rule:

```css
.route-cinematic .living-field {
  display: none;
}
```

- [ ] **Step 4: Run route, landing, and full cinematic tests**

Run: `pnpm --filter @agent-pay/web exec vitest run test/cinematic test/desk-landing.test.tsx`

Expected: all cinematic tests and existing landing tests PASS.

- [ ] **Step 5: Commit integration**

```bash
git add apps/web/src/App.tsx apps/web/src/shared/living-field.css apps/web/test/cinematic/routes.test.tsx
git commit -m "feat: route cinematic sample pages"
```

---

### Task 6: Production QA and Handoff Documentation

**Files:**
- Create: `scripts/e2e-cinematic-ui.ts`
- Create: `scripts/test/cinematic-ui-script.test.ts`
- Create: `docs/cinematic-samples.md`
- Modify: `package.json`

**Interfaces:**
- Consumes the running web app and the three public sample routes.
- Produces `npm run cinematic:ui-e2e` and a concise developer handoff.

- [ ] **Step 1: Add the failing package-script and QA-contract test**

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("cinematic UI verification", () => {
  it("exposes the Playwright QA command and required coverage", async () => {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
    const source = await readFile(resolve(repoRoot, "scripts/e2e-cinematic-ui.ts"), "utf8");
    expect(packageJson.scripts["cinematic:ui-e2e"]).toBe("node --import tsx scripts/e2e-cinematic-ui.ts");
    expect(source).toContain('reducedMotion: "reduce"');
    expect(source).toContain("/cinematic/proof-corridor");
    expect(source).toContain("/cinematic/signal-field");
    expect(source).toContain("/cinematic/evidence-chamber");
  });
});
```

Run: `pnpm exec vitest run scripts/test/cinematic-ui-script.test.ts`

Expected: FAIL because the package script and E2E file do not exist.

- [ ] **Step 2: Implement deterministic Playwright QA**

Create `scripts/e2e-cinematic-ui.ts` using the existing `playwright` dependency. It must accept `WEB_URL` defaulting to `http://127.0.0.1:5173`, visit all three routes at 1440×900 and 390×844, fail on page errors or console errors, assert one `main` and one `h1`, scroll each page to normalized checkpoints `0`, `.18`, `.27`, `.44`, `.58`, `.74`, `.90`, and `1`, then reverse through the same list, assert no horizontal document overflow, activate rail next/previous with keyboard, and repeat one route with `reducedMotion: "reduce"`. Save screenshots below an ignored temporary directory such as `.artifacts/cinematic/`.

Add the root script:

```json
"cinematic:ui-e2e": "node --import tsx scripts/e2e-cinematic-ui.ts"
```

- [ ] **Step 3: Write the handoff document**

Document the three routes, `pnpm --filter @agent-pay/web dev`, the 16:9 virtual layer roles for each page, checkpoint scene maps, reused asset paths, the fact that all new art layers are DOM/CSS/SVG, reduced-motion behavior, and exact QA commands. List no missing production assets because the approved implementation intentionally uses procedural layers.

- [ ] **Step 4: Run automated verification**

Run: `pnpm --filter @agent-pay/web test`

Expected: the entire web Vitest suite PASS.

Run: `pnpm --filter @agent-pay/web build`

Expected: TypeScript and Vite production build exit 0 with no loopback URL in output.

Run with the web app already running: `npm run cinematic:ui-e2e`

Expected: all route, checkpoint, viewport, keyboard, reduced-motion, overflow, and console checks PASS.

- [ ] **Step 5: Review the final diff for isolation and dependency scope**

Run: `git diff -- apps/web/src/landing2/Landing.tsx apps/web/src/landing2/landing2.css`

Expected: no output.

Run: `git diff -- package.json apps/web/package.json pnpm-lock.yaml`

Expected: only the new root `cinematic:ui-e2e` script; no dependency or lockfile changes.

- [ ] **Step 6: Commit QA and documentation**

```bash
git add scripts/e2e-cinematic-ui.ts scripts/test/cinematic-ui-script.test.ts docs/cinematic-samples.md package.json
git commit -m "test: verify cinematic sample pages"
```
