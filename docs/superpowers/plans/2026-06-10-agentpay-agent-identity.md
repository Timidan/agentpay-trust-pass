# AgentPay Agent Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, non-secret agent identity boundary before AgentPay can quote live evidence or continue x402 settlement.

**Architecture:** `App.tsx` owns a small `AgentConnectionState` union and renders a new `AgentPayConnectionPanel` above the console workflow. The landing page stays public; the console locks mutation actions until a non-secret agent label is connected. No backend auth, wallet dependency, persistence, fake payload, or demo credential is introduced.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing CSS tokens and components.

---

### Task 1: Locked Console Tests

**Files:**
- Modify: `apps/web/test/evidence-flow.test.tsx`
- Later modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write failing tests**

Add tests that prove:

```tsx
render(<App />);
expect(screen.getByText("Connect agent")).toBeTruthy();
expect(screen.getByText("Local session only. Backend auth is not configured.")).toBeTruthy();
expect(screen.getByRole("button", { name: /quote live evidence/i })).toBeDisabled();
```

Also update existing quote-flow tests to connect first:

```tsx
await userEvent.type(screen.getByLabelText(/agent identifier/i), "desk-agent-alpha");
await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));
await userEvent.click(screen.getByRole("button", { name: /quote live evidence/i }));
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agent-pay/web test -- --runInBand
```

Expected: FAIL because there is no agent connection panel and the quote button is not locked.

### Task 2: Agent Connection Panel

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/test/evidence-flow.test.tsx`

- [ ] **Step 1: Implement minimal state and panel**

Add:

```ts
type AgentConnectionState =
  | { status: "disconnected" }
  | { status: "connected"; label: string; localOnly: true };
```

Create `AgentPayConnectionPanel` in `App.tsx` with:

- input labeled `Agent identifier`
- validation for empty, >64 chars, and secret-looking values
- connected summary with `Local session only. Backend auth is not configured.`
- `Disconnect` action

- [ ] **Step 2: Lock quote until connected**

Change the console quote button:

```tsx
disabled={state === "running" || agentConnection.status !== "connected"}
```

- [ ] **Step 3: Run test to verify it passes**

Run:

```bash
pnpm --filter @agent-pay/web test -- --runInBand
```

Expected: PASS for the new locked-console behavior and existing flows.

### Task 3: Disconnection and State Hygiene

**Files:**
- Modify: `apps/web/test/evidence-flow.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write failing tests**

Add tests for:

```tsx
// empty identifier stays locked
await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));
expect(screen.getByText("Enter a non-secret agent identifier.")).toBeTruthy();

// secret-looking input stays locked
await userEvent.type(screen.getByLabelText(/agent identifier/i), "{\"x402Version\":2}");
await userEvent.click(screen.getByRole("button", { name: /^connect agent$/i }));
expect(screen.getByText(/Use the x402 payment payload field/i)).toBeTruthy();

// disconnect locks continuation and clears payment payload text
await userEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
expect(screen.getByRole("button", { name: /quote live evidence/i })).toBeDisabled();
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agent-pay/web test -- --runInBand
```

Expected: FAIL until disconnect and validation logic are complete.

- [ ] **Step 3: Implement state hygiene**

Add helpers:

```ts
function clearFlowState() { ... }
function connectAgent(label: string) { ... }
function disconnectAgent() { ... }
function isSecretLikeAgentIdentifier(value: string) { ... }
```

Different labels clear flow state before connecting. Disconnect clears `paymentPayloadText`, leaves historical results visible, and locks future mutation actions.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agent-pay/web test -- --runInBand
```

Expected: PASS.

### Task 4: Final Verification

**Files:**
- Modify only if tests or screenshots reveal issues.

- [ ] **Step 1: Build**

Run:

```bash
pnpm --filter @agent-pay/web build
```

Expected: PASS.

- [ ] **Step 2: Scan for stale brand/mock signals**

Run:

```bash
rg -n "Agent Pay|ProofPay|proofpay|CasperPay|settlement-orbit|orbit-|mock payment|fake receipt|demo credential" apps/web/src apps/web/test docs -S
```

Expected: no matches except test-only language explicitly allowed by specs.

- [ ] **Step 3: Capture screenshots**

Run:

```bash
chromium --headless --disable-gpu --no-sandbox --virtual-time-budget=2500 --window-size=1440,920 --screenshot=/tmp/agentpay-agent-identity-desktop.png http://127.0.0.1:5174/
chromium --headless --disable-gpu --no-sandbox --virtual-time-budget=2500 --window-size=390,844 --screenshot=/tmp/agentpay-agent-identity-mobile.png http://127.0.0.1:5174/
```

Expected: public landing remains clean; console clearly shows the local-only agent connection panel.

### Task 5: Submission Readiness Recheck

**Files:**
- Read: `/home/timidan/.codex/attachments/9a9d1b13-2998-446c-b8aa-8c523b317d43/pasted-text.txt`
- Read: `docs/real-product-constraints.md`
- Optionally modify: `docs/real-product-constraints.md`

- [ ] **Step 1: Compare against buildathon requirements**

Verify whether these are done, partial, or missing:

- Casper Testnet deployed transaction-producing component
- public GitHub repo readiness
- demo video readiness
- meaningful agentic AI/system integration
- real Casper interaction results
- README usage instructions

- [ ] **Step 2: Record remaining blockers**

If not already documented, add concise remaining submission blockers to `docs/real-product-constraints.md`.
