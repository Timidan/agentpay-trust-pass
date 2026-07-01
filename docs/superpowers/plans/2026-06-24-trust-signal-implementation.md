# Trust Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot AgentPay into "Trust Signal" — a consumer Casper DeFi token due-diligence agent that buys live evidence over x402, scores it deterministically, and stamps a shareable CLEAR/CAUTION/DANGER verdict on the existing AgentPayRegistry contract — shipped for the buildathon qualifier with zero new contract code.

**Architecture:** Reuse the AgentPay rail verbatim (x402 settlement, `AgentPayRegistry`, Merkle proof, MCP verbs, signal-box web UI). Add a pure deterministic core (`@agent-pay/core/trust`: subject parsing, signal extraction, the rule engine that owns the verdict, policy hashing) plus I/O wrappers (Testnet evidence gatherers, an `assess_subject` MCP orchestrator, an LLM narrator that only writes prose, a Verdict Card renderer, an ASK page + share/feed). The deterministic rule engine — never the LLM — sets the aspect.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), pnpm workspaces, Vitest, Express (report-api + mcp-server), React + Vite (web), Casper Testnet via `casper-client` record script, `@anthropic-ai/sdk` (narrator, optional), `satori` + `@resvg/resvg-js` (card PNG). Rust contract is **untouched**.

## Global Constraints

- **ZERO new contract code.** `contracts/agent-pay-registry` is not modified. The on-chain tx is `record_decision_with_root` via the existing `recordAgentPayDecision` path.
- **Decision enum maps 1:1:** `Approved→CLEAR`, `NeedsReview→CAUTION`, `Rejected→DANGER`. The wire decision strings stay `"approved" | "needs_review" | "rejected"`.
- **The LLM never sets or moves the aspect.** `scoreSubject` (pure, deterministic) is the sole authority. The narrator only produces prose.
- **Mandatory base evidence pack is gathered before any optional evidence**, so a hard-fail signal can never be skipped.
- **Missing/sparse signal → CAUTION + explicit `notChecked` entry. Never fake a signal.** On Testnet, liquidity/LP signals are "not checked" unless a real pool exists.
- **Honest copy:** every verdict surface carries "automated evidence flags, not financial advice" and the stamp means proof-of-what-was-checked, not proof-of-truth. Never claim "first" / "one of a kind".
- **All stamped verdicts settle x402 + `record_decision` on Casper Testnet.** Demo subjects are self-minted Testnet CEP-18 tokens. DANGER is only ever stamped on the team's own fixture token.
- **Share-by-choice.** The public feed shows only self-minted fixtures + explicitly opted-in shares; never auto-lists a real-token DANGER card.
- **TDD.** Every task: failing test → run-fail → minimal impl → run-pass → commit. `EvidenceRecord.facts` values must be `string | number | boolean | null` (EvidenceFactValue).
- **Keep the suite green:** `pnpm test` (runs `vitest`, `pnpm -r test`, and `cargo test`) must pass at every commit.

## File Structure

**New — pure deterministic core (`packages/agent-pay-core/src/trust/`):**
- `subject.ts` — `parseSubject(input)`: pasted token/pair → canonical `SubjectRef`.
- `signals.ts` — `SubjectSignals` type + `extractSignals(records)`: evidence records → typed signal set.
- `rules.ts` — `scoreSubject(signals)`: the deterministic verdict (aspect + flags + notChecked). **Heart of the system.**
- `policy.ts` — `POLICY_VERSION`, `policyHash()`, `buildVerdictReport(...)`: the hashed verdict object.
- `index.ts` (trust barrel) re-exported from `packages/agent-pay-core/src/index.ts`.

**New — I/O + orchestration:**
- `apps/report-api/src/subjectEvidence.ts` — `buildSubjectEvidence(subject)`: gather Testnet signals → `LiveEvidenceDataset`.
- `apps/report-api/src/card.ts` — `renderVerdictCardPng(verdict)`: SVG→PNG verdict card.
- `apps/mcp-server/src/trust/narrator.ts` — `narrateVerdict(...)`: LLM prose with deterministic fallback.
- `apps/mcp-server/src/trust/assess.ts` — `assessSubject(input)`: the orchestrator (resolve→quote→pay→reveal→verify→score→narrate→record).
- `apps/web/src/trust/AskPage.tsx`, `VerdictCard.tsx`, `FeedPage.tsx` — consumer surface.
- `scripts/trust-signal/mint-fixtures.ts` — deploy/mint Testnet CEP-18 fixtures (clean/rug/thin).

**Modified:**
- `apps/report-api/src/app.ts` — `/reports/quote` accepts `?subject=`; buy releases the full evidence bundle.
- `apps/mcp-server/src/tools.ts` + `app.ts` — add `assess_subject` tool.
- `apps/web/src/api.ts` + `App.tsx` — `assessSubject` client + ASK/feed routes.

---

## Task 1: Subject resolver (pure)

**Files:**
- Create: `packages/agent-pay-core/src/trust/subject.ts`
- Test: `packages/agent-pay-core/test/trust/subject.test.ts`

**Interfaces:**
- Produces: `type SubjectRef = { kind: "token" | "pair"; packageHash: string; raw: string }`; `parseSubject(input: string): { ok: true; subject: SubjectRef } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseSubject } from "../../src/trust/subject.js";

const HASH = "a".repeat(64);

describe("parseSubject", () => {
  it("accepts a raw 64-hex package hash as a token", () => {
    const r = parseSubject(HASH);
    expect(r).toEqual({ ok: true, subject: { kind: "token", packageHash: HASH, raw: HASH } });
  });
  it("strips a hash- prefix and lowercases", () => {
    const r = parseSubject(`hash-${"A".repeat(64)}`);
    expect(r.ok && r.subject.packageHash).toBe("a".repeat(64));
  });
  it("rejects empty / malformed input", () => {
    expect(parseSubject("").ok).toBe(false);
    expect(parseSubject("not-a-hash").ok).toBe(false);
    expect(parseSubject("b".repeat(63)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @agent-pay/core test -- subject` → FAIL (module missing).

- [ ] **Step 3: Write minimal implementation**

```ts
export type SubjectRef = { kind: "token" | "pair"; packageHash: string; raw: string };
export type ParseSubjectResult =
  | { ok: true; subject: SubjectRef }
  | { ok: false; error: string };

const HEX64 = /^(hash-)?([0-9a-f]{64})$/i;

export function parseSubject(input: string): ParseSubjectResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "empty_subject" };
  const match = raw.match(HEX64);
  if (!match) return { ok: false, error: "subject_must_be_casper_package_hash" };
  return { ok: true, subject: { kind: "token", packageHash: match[2].toLowerCase(), raw } };
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @agent-pay/core test -- subject` → PASS.

- [ ] **Step 5: Commit** — `git add packages/agent-pay-core/src/trust/subject.ts packages/agent-pay-core/test/trust/subject.test.ts && git commit -m "feat(trust): subject resolver"`

---

## Task 2: Signal types + extraction from evidence records (pure)

**Files:**
- Create: `packages/agent-pay-core/src/trust/signals.ts`
- Test: `packages/agent-pay-core/test/trust/signals.test.ts`

**Interfaces:**
- Consumes: `EvidenceRecord` from `../types.js`.
- Produces:
  ```ts
  type Tri = boolean | null; // null = not checked
  type SubjectSignals = {
    mintAuthorityOpen: Tri;     // hard-fail-relevant
    supplyRenounced: Tri;
    holderCount: number | null;
    topHolderPct: number | null;
    contractAgeBlocks: number | null;
    lpHolderCount: number | null;   // null on Testnet (no pool)
    liquidityDepth: number | null;  // null on Testnet
  };
  ```
  `extractSignals(records: EvidenceRecord[]): SubjectSignals`. Reads `facts` by a fixed `subject` convention (one record per signal family). Unknown/absent facts → `null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { extractSignals } from "../../src/trust/signals.js";
import type { EvidenceRecord } from "../../src/types.js";

function rec(subject: string, facts: Record<string, string | number | boolean | null>): EvidenceRecord {
  return { id: subject, product: "Casper Token", network: "casper-testnet", subject,
    observedAt: "2026-06-25T00:00:00Z", sourceUrl: "rpc", facts, rawHash: "x" };
}

describe("extractSignals", () => {
  it("maps token-authority + supply + age facts to signals", () => {
    const s = extractSignals([
      rec("token_authority", { mintAuthorityOpen: true, supplyRenounced: false }),
      rec("token_holders", { holderCount: 1, topHolderPct: 100 }),
      rec("token_age", { contractAgeBlocks: 12 }),
    ]);
    expect(s.mintAuthorityOpen).toBe(true);
    expect(s.supplyRenounced).toBe(false);
    expect(s.holderCount).toBe(1);
    expect(s.topHolderPct).toBe(100);
    expect(s.contractAgeBlocks).toBe(12);
  });
  it("defaults absent signals to null (not checked)", () => {
    const s = extractSignals([rec("token_age", { contractAgeBlocks: 5 })]);
    expect(s.mintAuthorityOpen).toBeNull();
    expect(s.lpHolderCount).toBeNull();
    expect(s.liquidityDepth).toBeNull();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { EvidenceRecord } from "../types.js";

export type Tri = boolean | null;
export type SubjectSignals = {
  mintAuthorityOpen: Tri;
  supplyRenounced: Tri;
  holderCount: number | null;
  topHolderPct: number | null;
  contractAgeBlocks: number | null;
  lpHolderCount: number | null;
  liquidityDepth: number | null;
};

const EMPTY: SubjectSignals = {
  mintAuthorityOpen: null, supplyRenounced: null, holderCount: null,
  topHolderPct: null, contractAgeBlocks: null, lpHolderCount: null, liquidityDepth: null,
};

function bool(v: unknown): Tri { return typeof v === "boolean" ? v : null; }
function num(v: unknown): number | null { return typeof v === "number" ? v : null; }

export function extractSignals(records: EvidenceRecord[]): SubjectSignals {
  const facts: Record<string, unknown> = {};
  for (const r of records) Object.assign(facts, r.facts);
  return {
    ...EMPTY,
    mintAuthorityOpen: bool(facts.mintAuthorityOpen),
    supplyRenounced: bool(facts.supplyRenounced),
    holderCount: num(facts.holderCount),
    topHolderPct: num(facts.topHolderPct),
    contractAgeBlocks: num(facts.contractAgeBlocks),
    lpHolderCount: num(facts.lpHolderCount),
    liquidityDepth: num(facts.liquidityDepth),
  };
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): signal extraction"`

---

## Task 3: The rule engine (pure) — owns the verdict

**Files:**
- Create: `packages/agent-pay-core/src/trust/rules.ts`
- Test: `packages/agent-pay-core/test/trust/rules.test.ts`

**Interfaces:**
- Consumes: `SubjectSignals` from `./signals.js`.
- Produces:
  ```ts
  type Aspect = "CLEAR" | "CAUTION" | "DANGER";
  type WireDecision = "approved" | "needs_review" | "rejected";
  type Flag = { code: string; severity: "danger" | "caution"; message: string };
  type RuleResult = { aspect: Aspect; decision: WireDecision; flags: Flag[]; notChecked: string[] };
  scoreSubject(signals: SubjectSignals): RuleResult;
  ```
- **Policy:** any DANGER hard-fail → DANGER. Else any CAUTION flag OR any not-checked mandatory signal → CAUTION. Else CLEAR. Hard-fails: `mintAuthorityOpen===true`, `supplyRenounced===false`, `lpHolderCount===1`, `holderCount===1`/`topHolderPct>=95`. Mandatory-for-CLEAR signals: `mintAuthorityOpen`, `supplyRenounced`, `contractAgeBlocks`, `holderCount`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { scoreSubject } from "../../src/trust/rules.js";
import type { SubjectSignals } from "../../src/trust/signals.js";

const clean: SubjectSignals = { mintAuthorityOpen: false, supplyRenounced: true,
  holderCount: 40, topHolderPct: 12, contractAgeBlocks: 5000, lpHolderCount: 8, liquidityDepth: 100000 };

describe("scoreSubject", () => {
  it("DANGER when mint authority is open (hard-fail, LLM cannot override)", () => {
    const r = scoreSubject({ ...clean, mintAuthorityOpen: true });
    expect(r.aspect).toBe("DANGER");
    expect(r.decision).toBe("rejected");
    expect(r.flags.some(f => f.code === "mint_authority_open" && f.severity === "danger")).toBe(true);
  });
  it("DANGER on single-LP", () => {
    expect(scoreSubject({ ...clean, lpHolderCount: 1 }).aspect).toBe("DANGER");
  });
  it("DANGER when supply not renounced", () => {
    expect(scoreSubject({ ...clean, supplyRenounced: false }).aspect).toBe("DANGER");
  });
  it("CLEAR when every mandatory signal is present and clean", () => {
    const r = scoreSubject(clean);
    expect(r.aspect).toBe("CLEAR");
    expect(r.decision).toBe("approved");
    expect(r.flags).toHaveLength(0);
  });
  it("CAUTION + notChecked when a mandatory signal is missing", () => {
    const r = scoreSubject({ ...clean, mintAuthorityOpen: null });
    expect(r.aspect).toBe("CAUTION");
    expect(r.decision).toBe("needs_review");
    expect(r.notChecked).toContain("mintAuthorityOpen");
  });
  it("CAUTION on a very new contract that is otherwise clean", () => {
    expect(scoreSubject({ ...clean, contractAgeBlocks: 10 }).aspect).toBe("CAUTION");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { SubjectSignals } from "./signals.js";

export type Aspect = "CLEAR" | "CAUTION" | "DANGER";
export type WireDecision = "approved" | "needs_review" | "rejected";
export type Flag = { code: string; severity: "danger" | "caution"; message: string };
export type RuleResult = { aspect: Aspect; decision: WireDecision; flags: Flag[]; notChecked: string[] };

const MANDATORY: (keyof SubjectSignals)[] = ["mintAuthorityOpen", "supplyRenounced", "contractAgeBlocks", "holderCount"];
const YOUNG_BLOCKS = 1000;

export function scoreSubject(s: SubjectSignals): RuleResult {
  const flags: Flag[] = [];
  if (s.mintAuthorityOpen === true) flags.push({ code: "mint_authority_open", severity: "danger", message: "Mint authority is open — supply can be inflated." });
  if (s.supplyRenounced === false) flags.push({ code: "supply_not_renounced", severity: "danger", message: "Token supply control has not been renounced." });
  if (s.lpHolderCount === 1) flags.push({ code: "single_lp_holder", severity: "danger", message: "Liquidity is held by a single account." });
  if (s.holderCount === 1 || (s.topHolderPct !== null && s.topHolderPct >= 95)) flags.push({ code: "holder_concentration", severity: "danger", message: "Token holdings are extremely concentrated." });
  if (s.contractAgeBlocks !== null && s.contractAgeBlocks < YOUNG_BLOCKS) flags.push({ code: "very_new_contract", severity: "caution", message: "Contract is very new." });

  const notChecked = MANDATORY.filter((k) => s[k] === null).map(String);

  const aspect: Aspect = flags.some((f) => f.severity === "danger")
    ? "DANGER"
    : flags.length > 0 || notChecked.length > 0
      ? "CAUTION"
      : "CLEAR";
  const decision: WireDecision = aspect === "DANGER" ? "rejected" : aspect === "CAUTION" ? "needs_review" : "approved";
  return { aspect, decision, flags, notChecked };
}
```

- [ ] **Step 4: Run** → PASS (all 6 cases).
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): deterministic rule engine"`

---

## Task 4: Policy hash + verdict report (pure)

**Files:**
- Create: `packages/agent-pay-core/src/trust/policy.ts`
- Test: `packages/agent-pay-core/test/trust/policy.test.ts`
- Modify: `packages/agent-pay-core/src/index.ts` (re-export the trust barrel)

**Interfaces:**
- Consumes: `hashJson` from `../hash.js`; `RuleResult`, `SubjectSignals`, `SubjectRef`.
- Produces:
  ```ts
  const POLICY_VERSION = "trust-signal/v1";
  function policyHash(): string;                  // hashJson over the rule definition + version
  type VerdictReport = { policyVersion: string; policyHash: string; subject: SubjectRef;
    signals: SubjectSignals; aspect: Aspect; decision: WireDecision; flags: Flag[];
    notChecked: string[]; rationale: string; notCheckedNote: string };
  function buildVerdictReport(args: {...}): VerdictReport;
  ```
- `report_hash` for the on-chain stamp = `hashJson(verdictReport)`, so the stamp proves which policy ran.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { policyHash, POLICY_VERSION, buildVerdictReport } from "../../src/trust/policy.js";
import { scoreSubject } from "../../src/trust/rules.js";
import type { SubjectSignals } from "../../src/trust/signals.js";

const signals: SubjectSignals = { mintAuthorityOpen: true, supplyRenounced: false, holderCount: 1,
  topHolderPct: 100, contractAgeBlocks: 3, lpHolderCount: 1, liquidityDepth: null };

describe("policy", () => {
  it("policyHash is stable for a given POLICY_VERSION", () => {
    expect(policyHash()).toBe(policyHash());
    expect(POLICY_VERSION).toBe("trust-signal/v1");
  });
  it("buildVerdictReport carries the deterministic aspect + policy provenance", () => {
    const rule = scoreSubject(signals);
    const vr = buildVerdictReport({
      subject: { kind: "token", packageHash: "a".repeat(64), raw: "a".repeat(64) },
      signals, rule, rationale: "n/a", notCheckedNote: "n/a",
    });
    expect(vr.aspect).toBe("DANGER");
    expect(vr.policyVersion).toBe(POLICY_VERSION);
    expect(vr.policyHash).toBe(policyHash());
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `policy.ts` (and append `export * from "./trust/index.js";` to `src/index.ts`, with `trust/index.ts` re-exporting subject/signals/rules/policy).

```ts
import { hashJson } from "../hash.js";
import type { SubjectRef } from "./subject.js";
import type { SubjectSignals } from "./signals.js";
import type { Aspect, Flag, RuleResult, WireDecision } from "./rules.js";

export const POLICY_VERSION = "trust-signal/v1";

// Frozen description of the policy; changing the rules must bump this object.
const POLICY_DEFINITION = {
  version: POLICY_VERSION,
  hardFails: ["mint_authority_open", "supply_not_renounced", "single_lp_holder", "holder_concentration"],
  cautions: ["very_new_contract", "missing_mandatory_signal"],
  mandatoryForClear: ["mintAuthorityOpen", "supplyRenounced", "contractAgeBlocks", "holderCount"],
  youngBlocks: 1000,
};

export function policyHash(): string { return hashJson(POLICY_DEFINITION); }

export type VerdictReport = {
  policyVersion: string; policyHash: string; subject: SubjectRef; signals: SubjectSignals;
  aspect: Aspect; decision: WireDecision; flags: Flag[]; notChecked: string[];
  rationale: string; notCheckedNote: string;
};

export function buildVerdictReport(args: {
  subject: SubjectRef; signals: SubjectSignals; rule: RuleResult; rationale: string; notCheckedNote: string;
}): VerdictReport {
  return {
    policyVersion: POLICY_VERSION, policyHash: policyHash(), subject: args.subject, signals: args.signals,
    aspect: args.rule.aspect, decision: args.rule.decision, flags: args.rule.flags,
    notChecked: args.rule.notChecked, rationale: args.rationale, notCheckedNote: args.notCheckedNote,
  };
}
```

- [ ] **Step 4: Run** the full core suite → `pnpm --filter @agent-pay/core test` → PASS (incl. existing merkle tests).
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): policy hash + verdict report; export trust barrel"`

---

## Task 5: Testnet evidence gatherers (`buildSubjectEvidence`)

**Files:**
- Create: `apps/report-api/src/subjectEvidence.ts`
- Test: `apps/report-api/test/subjectEvidence.test.ts`

**Interfaces:**
- Consumes: `buildDataset`, `EvidenceRecord` from `@agent-pay/core`; the RPC helpers' shapes.
- Produces: `buildSubjectEvidence(subject: SubjectRef, deps?: EvidenceDeps): Promise<LiveEvidenceDataset>` where `EvidenceDeps` injects fetchers so tests run offline. Emits one `EvidenceRecord` per signal family (`token_authority`, `token_holders`, `token_age`), `network: "casper-testnet"`, facts typed as EvidenceFactValue. Liquidity/LP omitted on Testnet (→ extractSignals yields `null` → "not checked").

- [ ] **Step 1: Write the failing test** (inject a fake fetcher; assert the dataset’s records carry the right facts and a stable datasetId).

```ts
import { describe, it, expect } from "vitest";
import { buildSubjectEvidence } from "../src/subjectEvidence.js";
import { extractSignals } from "@agent-pay/core";

const subject = { kind: "token" as const, packageHash: "a".repeat(64), raw: "a".repeat(64) };

describe("buildSubjectEvidence", () => {
  it("builds a Merkle dataset of the mandatory signal records", async () => {
    const ds = await buildSubjectEvidence(subject, {
      fetchTokenState: async () => ({ mintAuthorityOpen: true, supplyRenounced: false,
        holderCount: 1, topHolderPct: 100, installBlock: 100, latestBlock: 130 }),
    });
    expect(ds.root).toMatch(/^[0-9a-f]+$/);
    const signals = extractSignals(ds.reports.map((r) => r.record));
    expect(signals.mintAuthorityOpen).toBe(true);
    expect(signals.contractAgeBlocks).toBe(30);
    expect(signals.lpHolderCount).toBeNull(); // not checked on Testnet
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `buildSubjectEvidence`. Default `fetchTokenState` queries Casper Testnet RPC (`query_global_state`/`state_get_entity` for the package’s named keys: minter/admin → `mintAuthorityOpen`; total-supply control → `supplyRenounced`; install block vs latest block → age; CEP-18 events/dictionary → `holderCount`/`topHolderPct` best-effort, else `null`). Build records with `buildDataset(\`trust-${subject.packageHash.slice(0,16)}-${latestBlock}\`, records)`. **Spike note:** capture one real RPC response for a deployed Testnet CEP-18 first, then assert the parser against it (record the fixture in the test).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): Testnet subject evidence gatherers"`

---

## Task 6: report-api — subject-scoped quote + full-bundle release

**Files:**
- Modify: `apps/report-api/src/app.ts` (quote + buy)
- Test: `apps/report-api/test/handlers.test.ts` (extend)

**Interfaces:**
- Consumes: `buildSubjectEvidence`, `parseSubject`.
- Produces: `GET /reports/quote?subject=<hash>` builds the subject dataset (falls back to `buildLiveEvidenceDataset` when absent — existing behavior preserved). The paid response gains `evidence: ReportProof[]` (the full bundle) alongside the existing single `report`. `datasetRoot`/`paymentReceiptHash` unchanged.

- [ ] **Step 1: Write the failing test** — quote with `?subject=` returns `datasetRoot` + a `sourceSummary` of the signal records; a malformed subject returns 400 `invalid_subject`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in `createQuoteSnapshot`, accept `subject?: string`; if present and `parseSubject` ok, `dataset = await buildSubjectEvidence(subject)` and choose the bundle (all reports) instead of `chooseReport`; thread `subject` from the `/reports/quote` handler. In `reportResponse`, add `evidence: dataset.reports`. Reject malformed subject with 400.
- [ ] **Step 4: Run** the report-api suite → `pnpm --filter @agent-pay/report-api test` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): subject-scoped quote + full evidence bundle release"`

---

## Task 7: LLM narrator with deterministic fallback

**Files:**
- Create: `apps/mcp-server/src/trust/narrator.ts`
- Test: `apps/mcp-server/test/trust/narrator.test.ts`

**Interfaces:**
- Consumes: `VerdictReport` pieces (`aspect`, `flags`, `notChecked`, `signals`).
- Produces: `narrateVerdict(input: { aspect; flags; notChecked; signals }, deps?: { complete?: (prompt: string) => Promise<string> }): Promise<{ rationale: string; notCheckedNote: string }>`. **Never returns or implies a different aspect.** With no `deps.complete` and no `ANTHROPIC_API_KEY`, returns a deterministic template built from the flags/notChecked (so tests + offline demo work).

- [ ] **Step 1: Write the failing test** — fallback path: DANGER with `mint_authority_open` yields a rationale mentioning the flag and a `notCheckedNote` listing `notChecked`; assert the function does not fabricate a CLEAR phrasing for a DANGER input.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — template fallback first; if `deps.complete` (or a thin `@anthropic-ai/sdk` wrapper when `ANTHROPIC_API_KEY` is set) is available, prompt it to explain the *given* aspect/flags in plain English and to list what was not checked, with a system instruction that it may not change the verdict. Validate the model output is prose only; on any deviation, fall back to the template.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): verdict narrator with deterministic fallback"`

---

## Task 8: `assess_subject` orchestrator

**Files:**
- Create: `apps/mcp-server/src/trust/assess.ts`
- Modify: `apps/mcp-server/src/tools.ts` (+ `app.ts` route registration)
- Test: `apps/mcp-server/test/trust/assess.test.ts`

**Interfaces:**
- Consumes: `getQuote`/`buyReport`/`verifyReport` (apiClient), `recordAgentPayDecision` (casperClient), the x402 signing function (extract from `scripts/x402-buyer.ts` into an importable `signX402Payment(...)`), `extractSignals`/`scoreSubject`/`buildVerdictReport` (core), `narrateVerdict`.
- Produces:
  ```ts
  type Verdict = { aspect: Aspect; decision: WireDecision; flags: Flag[]; notChecked: string[];
    rationale: string; notCheckedNote: string; subject: SubjectRef;
    paymentReceiptHash: string; settlementTxHash: string; decisionTxHash: string;
    datasetRoot: string; policyHash: string; explorerUrl: string };
  assessSubject(input: { subject: string; reportApiUrl?: string }, deps?): Promise<Verdict>;
  ```
- Flow: `parseSubject` → quote(subject) → `signX402Payment` → `buyReport` (settles on Testnet) → `verifyReport` for each evidence leaf → `extractSignals` → `scoreSubject` → `narrateVerdict` → `buildVerdictReport` → `recordAgentPayDecision({ datasetId, datasetRoot, reportHash: hashJson(verdictReport), paymentReceiptHash, decision })` → assemble `Verdict` with the explorer URL.

- [ ] **Step 1: Write the failing test** — inject fakes for quote/buy/verify/record; a `mintAuthorityOpen:true` evidence bundle drives `decision: "rejected"` into `recordAgentPayDecision` and returns `aspect: "DANGER"` with both tx hashes. Assert the narrator output never alters `aspect`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `assessSubject` + register `assess_subject` in `toolDefinitions` (`inputSchema`: `{ subject: string }`) and the `app.ts` tool route.
- [ ] **Step 4: Run** the mcp-server suite → `pnpm --filter @agent-pay/mcp-server test` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): assess_subject orchestrator + MCP tool"`

---

## Task 9: Verdict Card renderer (SVG → PNG)

**Files:**
- Create: `apps/report-api/src/card.ts`
- Modify: `apps/report-api/src/app.ts` (add `GET /card/:id.png` + an in-memory verdict store keyed by id)
- Test: `apps/report-api/test/card.test.ts`

**Interfaces:**
- Produces: `renderVerdictCardSvg(v: VerdictCardData): string` (pure, testable) and `renderVerdictCardPng(svg): Promise<Buffer>` (satori/resvg). `VerdictCardData` = aspect, subject short hash, flags, notChecked, decisionTxHash, policyHash, the honest footer.
- Add deps: `satori`, `@resvg/resvg-js` to `apps/report-api`.

- [ ] **Step 1: Write the failing test** — `renderVerdictCardSvg` for DANGER contains the red aspect label, the subject short hash, the flag message, and the literal footer "automated evidence flags, not financial advice".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the SVG (signal-box palette: red `#…`/amber/green from `styles.css`; Archivo display; mono only for hash/amounts) + the PNG conversion + the `/card/:id.png` route reading the verdict store.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): verdict card renderer + /card/:id.png"`

---

## Task 10: Web ASK page (Token Launch Challenge) + verdict display

**Files:**
- Create: `apps/web/src/trust/AskPage.tsx`, `apps/web/src/trust/VerdictCard.tsx`
- Modify: `apps/web/src/api.ts` (`assessSubject` client), `apps/web/src/App.tsx` (route to ASK)
- Test: `apps/web/test/trust-ask.test.tsx`

**Interfaces:**
- Consumes: `callTool<Verdict>("assess_subject", { subject })`.
- Produces: the ASK screen (single input + ASK button, "Mint or paste a Casper token — can it earn a CLEAR stamp?"), a live-run state (the signal's wallet ticking down by the paid amount, evidence flags landing), and the `VerdictCard` with the aspect home-signal, flags, "what was not checked", a "Proven on Casper ✓ tx" explorer link, and the honest footer.

- [ ] **Step 1: Write the failing test** — render `AskPage`, mock `callTool` to resolve a DANGER verdict, submit, assert the DANGER aspect + flag + the explorer tx link + the honest footer render.
- [ ] **Step 2: Run** → `pnpm --filter @agent-pay/web test -- trust-ask` → FAIL.
- [ ] **Step 3: Implement** the components reusing the signal-box brand (mono for data only) and a `prefers-reduced-motion` fallback for the tick-down.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): ASK page + verdict card UI"`

---

## Task 11: Share-by-choice + shared-card feed

**Files:**
- Modify: `apps/web/src/trust/VerdictCard.tsx` (SHARE button), `apps/report-api/src/app.ts` (`GET /feed`, `POST /feed/share`)
- Create: `apps/web/src/trust/FeedPage.tsx`
- Test: `apps/report-api/test/feed.test.ts`

**Interfaces:**
- Produces: SHARE builds a CSPR.fans deep-link (`VITE_CSPR_FANS_VOTE_URL` + verdict id) and links the `/card/:id.png` image; `POST /feed/share` adds a verdict to the feed only on explicit opt-in; `GET /feed` lists shared cards. **Constraint:** real-token DANGER cards are never auto-added; only fixtures + opted-in shares.

- [ ] **Step 1: Write the failing test** — `POST /feed/share` without opt-in is rejected; with opt-in the card appears in `GET /feed`; a real-token (non-fixture) DANGER card cannot be auto-listed.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the feed store + endpoints + the SHARE/Feed UI.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): share-by-choice + shared-card feed"`

---

## Task 12: Testnet demo fixtures (clean / rug / thin) + mystery-mint seed script

**Files:**
- Create: `scripts/trust-signal/mint-fixtures.ts`
- Create: `scripts/trust-signal/fixtures.json` (gitignored output: the minted package hashes + intended aspect)
- Test: `scripts/test/trust-fixtures.test.ts` (validation only — no live deploy in CI)

**Interfaces:**
- Produces: deploys 2–3 Casper Testnet CEP-18 tokens via the existing `casper-client` deploy pattern — `clean` (mint authority renounced, supply fixed, multiple holders), `rug` (mint authority open, single holder), optional `thin`. Writes `fixtures.json` with package hashes and the **intended** aspect for demo verification. UI receives only the addresses ("mystery"), so the agent discovers the config after paying.
- **Fallback (de-risk Day 1):** if a configurable CEP-18 deploy is not ready in time, ship a `FixtureEvidenceProvider` in `buildSubjectEvidence` deps that returns real-shaped signal sets for the specific fixture addresses, clearly labeled `network: "casper-testnet-fixture"` — keep the x402 settlement + `record_decision` fully real on Testnet.

- [ ] **Step 1: Write the failing test** — `fixtures.json` schema validates (each entry has a 64-hex packageHash + intended aspect ∈ {CLEAR,CAUTION,DANGER}); the rule engine, fed each fixture’s intended signals, returns the intended aspect (locks the demo to the policy).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the seed script + the validation test + (fallback) the fixture provider.
- [ ] **Step 4: Run** → PASS; then run the script against Testnet once and record real package hashes.
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): Testnet demo fixtures + mystery-mint seed"`

---

## Task 13: End-to-end wiring, honest copy, demo lock, submission checklist

**Files:**
- Create: `apps/report-api/scripts/trust-signal-e2e.ts` (mirror of `verify-live-e2e.ts` for the ASK→stamp path)
- Modify: `README.md` (Trust Signal section + honest framing + roadmap/socials per spec §17), `apps/web` copy
- Test: the e2e script asserts a fresh real Testnet `record_decision` tx + resolvable explorer link per verdict

**Interfaces:** none new — this task proves the whole rail end-to-end and prepares the submission.

- [ ] **Step 1:** Write `trust-signal-e2e.ts`: bring up report-api + facilitator + mcp; run `assessSubject` against the `rug` fixture; assert `aspect === "DANGER"`, a real settlement tx, a real `record_decision` tx (`error_message: null`), and a resolvable `explorerUrl`.
- [ ] **Step 2:** Run it against Testnet → capture the two tx hashes.
- [ ] **Step 3:** Update `README.md`: "our buildathon project, evolved" framing; Trust Signal usage; the §17 roadmap (Testnet now → mainnet CSPR.trade/Ghostminter → GhostGuard finals) + socials; the honest "automated flags, not financial advice / proof-of-what-was-checked" statement.
- [ ] **Step 4:** Lock 3 demo subjects; record the 60-second video (paste rug fixture → ticking spend → flags → DANGER → Proven-on-Casper tap → SHARE).
- [ ] **Step 5: Commit** — `git commit -am "feat(trust): e2e verification + submission docs"` and run full `pnpm test` → green.

---

## Self-Review

- **Spec coverage:** subject resolver (T1) ✓; evidence pack §7 (T2,T5) ✓; deterministic verdict / LLM-narrator §6 (T3,T7,T8) ✓; policy_hash §6 (T4) ✓; honesty contract §6 (T3 notChecked, T7 copy, T9/T10 footer) ✓; network/contest + mystery-reveal §8 (T5,T12) ✓; consumer surface §9 (T9,T10) ✓; share-by-choice + feed §9 (T11) ✓; zero-contract reuse §4 (record path unchanged, T8) ✓; 6-day map §13 (T1–3→D1–2, T7–8→D3, T9–10→D4, T11→D5, T13→D6) ✓; compliance §17 (T13 README/roadmap) ✓; GhostGuard §14 deferred (out of scope) ✓.
- **Placeholder scan:** pure-core tasks (T1–4) carry complete code + tests; I/O/UI tasks (T5–13) carry exact files, typed interfaces, test strategy, and the one external-shape spike step flagged where live RPC/card-lib output must be captured at implementation time (§16 open items) — not hand-wavy "add error handling".
- **Type consistency:** `SubjectRef`, `SubjectSignals`, `RuleResult`/`aspect`/`decision`, `VerdictReport`, `Verdict` names are defined once (T1,T2,T3,T4,T8) and consumed by exact name downstream; wire decision strings `approved|needs_review|rejected` match `RecordDecisionInput`.
