# Task 10: Trust ASK Page + Verdict Card UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a consumer-facing ASK page where a user pastes a Casper token, clicks ASK, and sees a CLEAR/CAUTION/DANGER verdict card backed by `assessSubject`.

**Architecture:** Self-contained `trust/` directory with `AskPage.tsx` + `VerdictCard.tsx`; one new exported function `assessSubject` in `api.ts`; minimal surgical nav button added to `App.tsx` (`hero-nav-links`). Everything reuses existing CSS vars and signal-box brand.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react, existing signal-box CSS variables (`--danger`, `--caution`, `--clear`, `--font-mono`).

## Global Constraints

- Import style: match App.tsx (no `.ts`/`.tsx` extension on local imports; use relative paths from `src/`)
- CSS: never add Tailwind utility classes — use CSS vars and BEM-adjacent class names matching the styles.css pattern
- `prefers-reduced-motion`: no essential motion; animation must be purely decorative
- Footer literal copy must be exactly: `automated evidence flags, not financial advice`
- Mono font (`var(--font-mono)`) for data only: hashes, code values — not for body text
- No new `npm install` — all deps already present
- Tests: `vi.mock("../src/api")` pattern matching existing harness in `evidence-flow.test.tsx`
- Commit message: `feat(trust): ASK page + verdict card UI`

---

### Task 1: Add `Verdict` type and `assessSubject` to `api.ts`

**Files:**
- Modify: `apps/web/src/api.ts` (append after line 185, before the end of file — or after `ToolCallError`)

**Interfaces:**
- Produces: `Verdict` type and `assessSubject(subject: string): Promise<Verdict>` consumed by AskPage

- [ ] **Step 1: Open `apps/web/src/api.ts` and append these exports after the `ToolCallError` class (at the bottom of the file):**

```ts
export type Verdict = {
  aspect: "CLEAR" | "CAUTION" | "DANGER";
  decision: "approved" | "needs_review" | "rejected";
  flags: { code: string; severity: string; message: string }[];
  notChecked: string[];
  rationale: string;
  notCheckedNote: string;
  subject: { kind: string; packageHash: string; raw: string };
  paymentReceiptHash: string;
  settlementTxHash: string;
  decisionTxHash: string;
  datasetRoot: string;
  policyHash: string;
  explorerUrl: string;
};

export async function assessSubject(subject: string): Promise<Verdict> {
  return callTool<Verdict>("assess_subject", { subject });
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web lint
```

Expected: no errors. If errors, check for duplicate exports.

- [ ] **Step 3: Commit**

```bash
cd /home/timidan/Desktop/persona/casper
git add apps/web/src/api.ts
git commit -m "feat(trust): add Verdict type and assessSubject to api.ts"
```

---

### Task 2: Write failing test `trust-ask.test.tsx`

**Files:**
- Create: `apps/web/test/trust-ask.test.tsx`

**Interfaces:**
- Consumes: `AskPage` from `../src/trust/AskPage` (not yet created — test must fail RED)
- Consumes: `assessSubject` from `../src/api` (mocked via `vi.mock`)
- Consumes: `Verdict` type from `../src/api`

- [ ] **Step 1: Create the test file `apps/web/test/trust-ask.test.tsx` with this exact content:**

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "../src/api";
import AskPage from "../src/trust/AskPage";

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    assessSubject: vi.fn()
  };
});

const dangerVerdict: Verdict = {
  aspect: "DANGER",
  decision: "rejected",
  flags: [
    {
      code: "mint_authority_open",
      severity: "high",
      message: "Mint authority is not renounced — unlimited supply risk"
    }
  ],
  notChecked: ["liquidity_lock", "team_vesting"],
  rationale: "Token failed automated checks: mint authority remains open.",
  notCheckedNote: "Liquidity lock and team vesting were not evaluated in this run.",
  subject: {
    kind: "cep18_token",
    packageHash: "a".repeat(64),
    raw: "b".repeat(64)
  },
  paymentReceiptHash: "c".repeat(64),
  settlementTxHash: "d".repeat(64),
  decisionTxHash: "e".repeat(64),
  datasetRoot: "f".repeat(64),
  policyHash: "0".repeat(64),
  explorerUrl: `https://testnet.cspr.live/transaction/${"d".repeat(64)}`
};

describe("Trust ASK page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows DANGER verdict, flag message, explorer link, and honest footer", async () => {
    const { assessSubject } = await import("../src/api");
    vi.mocked(assessSubject).mockResolvedValueOnce(dangerVerdict);

    render(<AskPage />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "b".repeat(64) } });

    const askButton = screen.getByRole("button", { name: /ask/i });
    fireEvent.click(askButton);

    await waitFor(() => {
      expect(screen.getByText("DANGER")).toBeTruthy();
    });

    expect(screen.getByText("Mint authority is not renounced — unlimited supply risk")).toBeTruthy();
    expect(screen.getByRole("link", { name: /proven on casper/i }).getAttribute("href")).toBe(
      dangerVerdict.explorerUrl
    );
    expect(screen.getByText("automated evidence flags, not financial advice")).toBeTruthy();
  });

  it("does not call assessSubject when input is empty", async () => {
    const { assessSubject } = await import("../src/api");

    render(<AskPage />);

    const askButton = screen.getByRole("button", { name: /ask/i });
    fireEvent.click(askButton);

    expect(vi.mocked(assessSubject)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web test -- trust-ask
```

Expected: FAIL with module not found error for `../src/trust/AskPage`.

---

### Task 3: Create `apps/web/src/trust/VerdictCard.tsx`

**Files:**
- Create directory: `apps/web/src/trust/`
- Create: `apps/web/src/trust/VerdictCard.tsx`

**Interfaces:**
- Consumes: `Verdict` type from `../api`
- Produces: `<VerdictCard verdict={Verdict} />` component used by AskPage

- [ ] **Step 1: Create `apps/web/src/trust/VerdictCard.tsx`:**

```tsx
import type { Verdict } from "../api";

type VerdictCardProps = {
  verdict: Verdict;
};

const ASPECT_LABEL: Record<Verdict["aspect"], string> = {
  CLEAR: "CLEAR",
  CAUTION: "CAUTION",
  DANGER: "DANGER"
};

export function VerdictCard({ verdict }: VerdictCardProps) {
  const shortTx = verdict.explorerUrl.split("/").pop()?.slice(0, 18) ?? "";

  return (
    <article className={`verdict-card verdict-card--${verdict.aspect.toLowerCase()}`}>
      <div className="verdict-aspect" aria-label={`Verdict: ${ASPECT_LABEL[verdict.aspect]}`}>
        {ASPECT_LABEL[verdict.aspect]}
      </div>

      <p className="verdict-rationale">{verdict.rationale}</p>

      {verdict.flags.length > 0 ? (
        <ul className="verdict-flags" aria-label="Evidence flags">
          {verdict.flags.map((flag) => (
            <li key={flag.code} className="verdict-flag">
              <span className="verdict-flag-code">{flag.code}</span>
              <span className="verdict-flag-message">{flag.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {verdict.notCheckedNote || verdict.notChecked.length > 0 ? (
        <p className="verdict-not-checked">
          {verdict.notCheckedNote || `Not checked: ${verdict.notChecked.join(", ")}`}
        </p>
      ) : null}

      <div className="verdict-proof">
        <a
          className="verdict-explorer-link"
          href={verdict.explorerUrl}
          rel="noreferrer"
          target="_blank"
        >
          Proven on Casper ✓ <code>{shortTx}…</code>
        </a>
        <code className="verdict-policy-hash">{verdict.policyHash}</code>
      </div>

      <footer className="verdict-footer">
        automated evidence flags, not financial advice
      </footer>
    </article>
  );
}
```

- [ ] **Step 2: No separate test run here — VerdictCard is tested via AskPage in Task 4. Typecheck only:**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web lint
```

Expected: no errors.

---

### Task 4: Create `apps/web/src/trust/AskPage.tsx` — turn tests GREEN

**Files:**
- Create: `apps/web/src/trust/AskPage.tsx`

**Interfaces:**
- Consumes: `assessSubject` from `../api`
- Consumes: `VerdictCard` from `./VerdictCard`
- Produces: `default export AskPage` — default export required because test imports it as `import AskPage from "../src/trust/AskPage"`

- [ ] **Step 1: Create `apps/web/src/trust/AskPage.tsx`:**

```tsx
import { type FormEvent, useState } from "react";
import { assessSubject, type Verdict } from "../api";
import { VerdictCard } from "./VerdictCard";

type AskState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; verdict: Verdict }
  | { status: "error"; message: string };

export default function AskPage() {
  const [subject, setSubject] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [validationHint, setValidationHint] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = subject.trim();
    if (!trimmed) {
      setValidationHint("Paste a Casper token address or package hash to continue.");
      return;
    }
    setValidationHint(null);
    setState({ status: "loading" });
    try {
      const verdict = await assessSubject(trimmed);
      setState({ status: "done", verdict });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Assessment failed"
      });
    }
  }

  return (
    <main className="ask-page">
      <header className="ask-page-header">
        <p className="section-kicker">Token Launch Challenge</p>
        <h1 className="ask-page-heading">
          Mint or paste a Casper token — can it earn a CLEAR stamp?
        </h1>
      </header>

      <form className="ask-form" onSubmit={handleSubmit} noValidate>
        <label className="ask-label" htmlFor="ask-subject">
          Token address or package hash
        </label>
        <div className="ask-input-row">
          <input
            autoComplete="off"
            className="ask-input"
            id="ask-subject"
            maxLength={128}
            placeholder="hash-… or 64-hex package hash"
            spellCheck={false}
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              if (validationHint) setValidationHint(null);
            }}
          />
          <button
            className="ask-button"
            disabled={state.status === "loading"}
            type="submit"
          >
            {state.status === "loading" ? "Checking…" : "ASK"}
          </button>
        </div>
        {validationHint ? (
          <p className="ask-validation-hint" role="alert">
            {validationHint}
          </p>
        ) : null}
      </form>

      {state.status === "loading" ? (
        <div className="ask-loading" aria-live="polite" aria-busy="true">
          <span className="strip-label">Running assessment…</span>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="ask-error" role="alert">
          <p>{state.message}</p>
        </div>
      ) : null}

      {state.status === "done" ? <VerdictCard verdict={state.verdict} /> : null}
    </main>
  );
}
```

- [ ] **Step 2: Run the tests — expect GREEN**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web test -- trust-ask
```

Expected: 2 tests pass.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web test
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web lint
```

Expected: no errors.

---

### Task 5: Add CSS for trust components to `styles.css`

**Files:**
- Modify: `apps/web/src/styles.css` (append at end of file)

**Note:** Append only — do not touch existing rules. The styles use existing CSS vars already defined.

- [ ] **Step 1: Append these styles to the end of `apps/web/src/styles.css`:**

```css
/* ------------------------------------------------------------------ */
/*  Trust ASK page                                                     */
/* ------------------------------------------------------------------ */

.ask-page {
  width: min(var(--container), calc(100vw - 32px));
  margin: 0 auto;
  padding: clamp(40px, 8vw, 96px) 0 clamp(48px, 8vw, 96px);
}

.ask-page-header {
  margin-bottom: clamp(28px, 4vw, 48px);
}

.ask-page-heading {
  margin-top: 10px;
  font-size: clamp(1.8rem, 4vw, 3rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.06;
}

.ask-form {
  display: grid;
  gap: 10px;
  margin-bottom: clamp(24px, 4vw, 40px);
}

.ask-label {
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ask-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.ask-input {
  width: 100%;
  min-height: 48px;
  padding: 0 16px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-m);
  color: var(--ink);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: 0.84rem;
  transition: border-color 180ms var(--ease), box-shadow 180ms var(--ease);
}

.ask-input::placeholder {
  color: var(--ink-3);
}

.ask-input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent);
}

.ask-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 24px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--on-brand);
  background: var(--brand);
  font-weight: 700;
  font-size: 0.92rem;
  letter-spacing: 0.04em;
  transition:
    transform 180ms var(--ease),
    background 180ms var(--ease),
    box-shadow 240ms var(--ease);
}

.ask-button:hover:not(:disabled) {
  background: var(--brand-hot);
  transform: translateY(-1px);
  box-shadow: 0 12px 26px -14px var(--brand-glow);
}

.ask-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.ask-validation-hint {
  margin: 0;
  color: var(--error-fg);
  font-size: 0.86rem;
  font-weight: 600;
}

.ask-loading {
  padding: 16px 0;
}

.ask-error {
  padding: 14px 18px;
  border: 1px solid color-mix(in srgb, var(--danger) 34%, transparent);
  border-radius: var(--radius-m);
  background: var(--error-bg);
  color: var(--error-fg);
  font-size: 0.92rem;
}

/* --- Verdict card --------------------------------------------------- */

.verdict-card {
  display: grid;
  gap: 18px;
  padding: clamp(20px, 3vw, 32px);
  border: 1px solid var(--line);
  border-radius: var(--radius-l);
  background: var(--surface);
  box-shadow: var(--shadow-m);
}

.verdict-card--clear {
  border-color: color-mix(in srgb, var(--clear) 40%, transparent);
  background: linear-gradient(100deg, var(--clear-soft), var(--surface) 60%);
}

.verdict-card--caution {
  border-color: color-mix(in srgb, var(--caution) 40%, transparent);
  background: linear-gradient(100deg, var(--caution-soft), var(--surface) 60%);
}

.verdict-card--danger {
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  background: linear-gradient(100deg, var(--danger-soft), var(--surface) 60%);
}

.verdict-aspect {
  font-size: clamp(2.2rem, 5vw, 3.6rem);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1;
}

.verdict-card--clear .verdict-aspect { color: var(--clear); }
.verdict-card--caution .verdict-aspect { color: var(--caution); }
.verdict-card--danger .verdict-aspect { color: var(--danger); }

.verdict-rationale {
  color: var(--ink);
  font-size: 1rem;
  line-height: 1.6;
}

.verdict-flags {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.verdict-flag {
  display: grid;
  gap: 3px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--danger) 24%, transparent);
  border-radius: var(--radius-m);
  background: color-mix(in srgb, var(--danger) 6%, transparent);
}

.verdict-flag-code {
  color: var(--error-fg);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.verdict-flag-message {
  color: var(--ink);
  font-size: 0.9rem;
  line-height: 1.5;
}

.verdict-not-checked {
  color: var(--ink-2);
  font-size: 0.88rem;
  line-height: 1.5;
}

.verdict-proof {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.verdict-explorer-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--clear);
  font-weight: 700;
  font-size: 0.9rem;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: opacity 180ms var(--ease);
}

.verdict-explorer-link:hover {
  opacity: 0.8;
}

.verdict-policy-hash {
  color: var(--ink-3);
  font-size: 0.7rem;
  overflow-wrap: anywhere;
}

.verdict-footer {
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--ink-3);
  font-size: 0.78rem;
  font-style: italic;
}

/* prefers-reduced-motion: no animations to turn off here */
```

- [ ] **Step 2: Typecheck (CSS changes don't affect TS but let's be safe)**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web lint
```

Expected: no errors.

---

### Task 6: Wire `AskPage` into `App.tsx` — minimal surgical edit

**Files:**
- Modify: `apps/web/src/App.tsx` — add one import, one state enum value, one nav button, one conditional render branch

**Goal:** The smallest possible change: add a "Trust Signal" button to the existing `hero-nav-links` in `AgentPayHero`, add a `"trust"` option to the existing view state, and render `<AskPage />` when that state is active.

- [ ] **Step 1: Add the `trust` view to the existing view state in `App.tsx`**

The current App.tsx uses `appOpen: boolean`. Add a `"trust"` view without breaking the boolean pattern. The minimal approach is to add a `trustOpen: boolean` state (mirrors the `appOpen` pattern exactly).

Find this section near line 98 in `App.tsx`:
```ts
const [appOpen, setAppOpen] = useState(false);
```

Add immediately after it:
```ts
const [trustOpen, setTrustOpen] = useState(false);
```

- [ ] **Step 2: Add the import for AskPage at the top of `App.tsx`, after the existing local imports:**

Add after the `import { useHeroParallax, useReveal } from "./motion";` line:
```ts
import AskPage from "./trust/AskPage";
```

- [ ] **Step 3: Add the `trustOpen` render branch**

Find this block (around line 314):
```tsx
if (appOpen) {
  return (
```

Add a new branch BEFORE it:
```tsx
if (trustOpen) {
  return (
    <AgentPayTooltipProvider delayDuration={140}>
      <main className="agent-pay-app agent-pay-workspace-view" data-theme={theme}>
        <header className="app-header">
          <div className="brand-lockup">
            <AgentPayLogo className="brand-logo" />
            <div className="brand-copy">
              <span className="brand-name">AgentPay</span>
              <span className="brand-sub">Trust Signal</span>
            </div>
          </div>
          <div className="hero-nav-actions">
            <AgentPayButton variant="secondary" onClick={() => setTrustOpen(false)}>
              Overview
            </AgentPayButton>
          </div>
        </header>
        <AskPage />
      </main>
    </AgentPayTooltipProvider>
  );
}
```

- [ ] **Step 4: Add "Trust Signal" nav button in `AgentPayHero`**

Find this block inside `AgentPayHero` (around line 641):
```tsx
<div className="hero-nav-links" aria-label="AgentPay overview sections">
  <a href="#how-it-works">Rail</a>
  <a href="#proof-model">Proof model</a>
  <AgentPayButton variant="nav" onClick={onOpenApp}>Open app</AgentPayButton>
</div>
```

`AgentPayHero` receives `onOpenApp` as a prop. We need to pass `onOpenTrust` too. Add to the `AgentPayHero` prop type and usage:

**In the `AgentPayHero` function signature**, change:
```tsx
function AgentPayHero({
  theme,
  onToggleTheme,
  onOpenApp
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenApp: () => void;
}) {
```
to:
```tsx
function AgentPayHero({
  theme,
  onToggleTheme,
  onOpenApp,
  onOpenTrust
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenApp: () => void;
  onOpenTrust: () => void;
}) {
```

**In the nav links block**, add the Trust Signal button after "Open app":
```tsx
<div className="hero-nav-links" aria-label="AgentPay overview sections">
  <a href="#how-it-works">Rail</a>
  <a href="#proof-model">Proof model</a>
  <AgentPayButton variant="nav" onClick={onOpenApp}>Open app</AgentPayButton>
  <AgentPayButton variant="nav" onClick={onOpenTrust}>Trust Signal</AgentPayButton>
</div>
```

**In the App's return (landing view)**, pass `onOpenTrust` to `AgentPayHero`. Find:
```tsx
<AgentPayHero
  theme={theme}
  onOpenApp={openAgentPayApp}
  onToggleTheme={toggleTheme}
/>
```
Change to:
```tsx
<AgentPayHero
  theme={theme}
  onOpenApp={openAgentPayApp}
  onOpenTrust={() => setTrustOpen(true)}
  onToggleTheme={toggleTheme}
/>
```

- [ ] **Step 5: Run all tests to confirm no regression**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web test
```

Expected: all tests pass (including the existing `evidence-flow.test.tsx` suite).

- [ ] **Step 6: Typecheck**

```bash
cd /home/timidan/Desktop/persona/casper
pnpm --filter @agent-pay/web lint
```

Expected: no errors.

- [ ] **Step 7: Commit everything**

```bash
cd /home/timidan/Desktop/persona/casper
git add apps/web/src/trust/ apps/web/src/styles.css apps/web/src/App.tsx apps/web/test/trust-ask.test.tsx
git commit -m "feat(trust): ASK page + verdict card UI"
```

---

## Self-Review

**Spec coverage:**
- ✅ `assessSubject` + `Verdict` type in `api.ts` — Task 1
- ✅ `VerdictCard` with aspect in aspect color, rationale, flags, notCheckedNote, explorer link (green), policyHash (mono), honest footer literal — Task 3
- ✅ `AskPage` with "Mint or paste a Casper token" heading, single input + ASK button, loading state, error handling, `<VerdictCard>` — Task 4
- ✅ `prefers-reduced-motion` friendly (no essential motion in CSS) — Task 5
- ✅ Tests: DANGER verdict renders all required elements; empty input does not call `assessSubject` — Task 2
- ✅ App.tsx: minimal surgical "Trust Signal" nav button → trustOpen → AskPage — Task 6

**Placeholder scan:** None. All code is explicit.

**Type consistency:**
- `Verdict["aspect"]` used in VerdictCard CSS class generation matches the union `"CLEAR" | "CAUTION" | "DANGER"`
- `assessSubject` return type matches the `Verdict` type used in AskPage state
- Test imports `AskPage` as default export; `AskPage.tsx` exports it as `export default function AskPage`
