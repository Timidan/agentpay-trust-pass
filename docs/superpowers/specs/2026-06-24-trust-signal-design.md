# Trust Signal — Design Spec

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation
**Authors:** Timidan + Claude (workflow research) + Codex (independent review)
**Supersedes positioning of:** AgentPay "x402-paid evidence desk for agents"

---

## 1. Context

Casper Agentic Buildathon 2026 (DoraHacks). Qualification Round submission deadline **July 1, 2026**
(~6 days out). $150k pool. Advancement is **hybrid**: the top 3 projects by **community vote on
CSPR.fans** advance directly to the finals (bypassing jury); everyone else must meet technical
eligibility (working Casper Testnet prototype with a transaction-producing on-chain component) for
jury evaluation. Finals run **July 6–19**. Theme emphasis: **Agentic AI + DeFi and/or RWA on Casper.**

The team already has **AgentPay** working and confirmed on Casper Testnet: a real x402 settlement
rail (EIP-712 `TransferWithAuthorization` over a CEP-18 token via a self-hosted casper-x402
facilitator), a deployed WASM registry contract (`AgentPayRegistry`), Merkle-proof verification, an
MCP server, and a buyer agent. Its problem: positioned as abstract agent-facing infrastructure, it
emits nothing a person would screenshot and cannot win community votes. x402 + agent-pay are now
commodity.

Two independent research passes (a 32-agent Claude workflow + Codex) converged on the same move:
**reskin-pivot — keep the rail, replace the product surface, put a human at the front, emit a
shareable on-chain verdict card.**

## 2. Goal

Ship, by July 1, a consumer-facing, screenshot-able, Casper-native DeFi due-diligence agent that
**reuses the existing rail with zero new contract code**, satisfies both the community-vote path
(legible, shareable) and the jury path (agentic + DeFi + working Casper tx + UX + honesty). Stage the
bolder **GhostGuard** parametric-insurance build (the one mechanic the rail lacks — outbound payout)
into the July 6–19 finals window, contingent on advancing.

## 3. Locked decisions

- **Verdict on AgentPay:** reskin-pivot, not replace. Reuse rail verbatim; zero new contract code for
  the qualifier.
- **Product:** "Trust Signal" — paste a Casper token/pool; the signal spends its own CSPR buying live
  evidence; it emits a shareable **CLEAR / CAUTION / DANGER** signal-aspect Verdict Card stamped on
  Casper.
- **Domain:** Casper-native DeFi/token trust, anchored on the new CSPR.trade / Ghostminter / Delta /
  Styks frontier. (Cross-chain token DD, RWA-claim verification, and wallet-drainer checks were
  considered and rejected — see §11.)
- **Verdict model:** personal check, **share-by-choice**. Not a public accusation wall.
- **Honesty contract:** the stamp is **proof-of-what-was-checked + proof-the-agent-decided, never
  proof-of-truth.** Card footer: "automated evidence flags, not financial advice."
- **Surface framing:** **Token Launch Challenge** — "Mint or paste a Casper token: can it earn a
  CLEAR stamp?"
- **Verdict authority:** the **deterministic rule engine sets the aspect**; the LLM never sets it (see
  §6).

## 4. Architecture — reuse map

**Untouched (the moat; zero risk):**

- `contracts/agent-pay-registry` — **no contract change.** `record_decision_with_root(dataset_id,
  dataset_root, report_hash, payment_receipt_hash, decision, timestamp)` already exists; the
  `Decision` enum `{Approved, NeedsReview, Rejected}` maps 1:1 to `{CLEAR, CAUTION, DANGER}`. Deployed
  at package `hash-73ce206e…`.
- x402 settlement: EIP-712 `TransferWithAuthorization` / CEP-18 buyer (`scripts/x402-buyer.ts`) →
  now "the signal spending its own wallet" (visible drama).
- Merkle proof + `verify_report`; MCP verbs `quote_report / payment_status / registry_status /
  buy_report / verify_report / record_decision` (`apps/mcp-server/src/tools.ts`) → the agent's
  internal pipeline.
- `apps/report-api` quote→pay→reveal flow (`buildLiveEvidenceDataset`, one x402 settlement per quote
  releasing the evidence dataset) → the commit→pay→reveal backbone for blind-reveal evidence.
- `apps/web` signal-box brand (Archivo display; mono for data only; red=DANGER, amber=CAUTION,
  green=CLEAR) → the consumer surface. **The home signal is the persona; no mascot needed.**

**New (front-end + thin glue; no new on-chain primitive):** subject resolver, evidence gatherers
(`buildSubjectEvidence`), the deterministic rule engine, the LLM narrator, the Verdict Card renderer,
the ASK page, share + CSPR.fans deep-link, the shared-card feed, the demo-token mint/seed scripts.

## 5. Verdict core (end-to-end data flow)

1. **Subject resolve.** User pastes a Casper token (package hash) or CSPR.trade pair. LLM may parse to
   a canonical subject id, but **the user confirms the canonical subject** before anything is bought.
2. **Quote (commitment).** `report-api` quotes a **mandatory base evidence pack** for the subject and
   returns the dataset-root commitment + x402 `PAYMENT-REQUIRED` — evidence leaves are committed but
   not yet revealed (blind reveal; see §8).
3. **Pay (x402).** The buyer agent signs and settles one real Testnet x402 payment → the signal's
   wallet visibly ticks down.
4. **Reveal.** `report-api` releases the raw evidence leaves + Merkle proof for the bundle.
5. **Verify.** Each evidence leaf is verified against the dataset root (`verify_report`).
6. **Score (deterministic).** The rule engine computes the aspect from the **mandatory** pack:
   objective hard-fails (e.g. open mint authority, single-LP, un-renounced supply) → **DANGER**; soft
   flags → **CAUTION**; clean → **CLEAR**. Missing/sparse signals → **CAUTION** + explicit
   "not checked." The LLM cannot alter this.
7. **Narrate (LLM).** The LLM writes the plain-English rationale and an explicit **"what was NOT
   checked"** list. It does not set or move the aspect.
8. **Stamp.** `record_decision_with_root`: `dataset_root` = Merkle root of the evidence bundle;
   `report_hash` = hash of the rendered verdict **including `policy_hash`** (see §7); `payment_receipt_hash`
   = the x402 receipt; `decision` = the deterministic aspect. **One real Casper Testnet tx per verdict.**
9. **Render + share.** Verdict Card rendered server-side; user may SHARE (their choice).

## 6. The honesty mechanism (deterministic verdict, LLM narrator)

The single most important correctness property: **the LLM never decides the verdict.**

- **Mandatory base pack first.** All hard-fail-relevant signals are bought before any optional
  evidence, so the LLM cannot avoid a signal that would trigger DANGER (closes the optional-evidence
  loophole).
- **Rule engine owns the aspect.** `scoreSubject(signals) → { aspect, flags[], notChecked[] }` is a
  pure, unit-tested function. Hard-fail set forces DANGER. The LLM's only outputs are prose: rationale
  + "what was not checked."
- **Policy provenance.** A `policy_version` / `policy_hash` is embedded in a dataset leaf and folded
  into `report_hash`, so the card proves *which policy ran*, not merely "an AI said so." No contract
  change.

## 7. Evidence pack (signals)

Mandatory base pack (each a Merkle leaf), chosen for Testnet gettability:

| Signal | Source | Hard-fail? |
|---|---|---|
| Mint authority status (renounced / open) | contract named keys / entry points via RPC | **DANGER if open** |
| Supply renounced / fixed | token contract state via RPC | **DANGER if un-renounced + open mint** |
| Liquidity depth | controlled pool / CSPR.trade-shaped data | CAUTION if thin |
| LP concentration (single vs spread) | pool state | **DANGER if single-LP** |
| Contract / token age | install block via RPC | CAUTION if very new |

Best-effort (mark **"not checked"** if unavailable rather than fake): holder distribution / top-holder
% (needs an indexer such as CSPR.cloud; not guaranteed on Testnet). The card always lists what was and
was not checked.

## 8. Network / contest model

- **All stamped verdicts settle x402 + `record_decision` on Casper Testnet** (the existing rail) — the
  contest's transaction-producing requirement is satisfied with near-zero technical risk.
- **Demo subjects are self-minted Testnet fixtures.** The team deploys 2–3 CEP-18 tokens on Testnet:
  one clean (→CLEAR), one rug-shaped (→DANGER), one thin (→CAUTION). DANGER is only ever stamped on
  the team's own token. Zero defamation/liability.
- **Blind reveal / "mystery token" demo.** A seed script mints the fixtures with unlabeled addresses;
  the UI receives only addresses; the agent discovers the bad configuration **after** paying. This
  makes the x402 purchase necessary (the answer is unknown until bought + inspected), not ceremony.
- **Honest framing in the demo + card:** "Real Casper Testnet transactions; controlled token-risk
  fixtures; mainnet support next." The demo must never imply live mainnet safety coverage.
- **Optional mainnet read-only preview (stretch, not a dependency):** a labeled panel showing one real
  CSPR.trade mainnet pool via the live MCP, **not stamped** — "Mainnet preview: liquidity / pre-trade
  data available; full Trust Signal stamp requires indexed holder/admin evidence." Proves the product
  points at the real frontier without over-claiming.

## 9. Consumer surface

- **One screen, one verb.** Signal-box brand carries over. Mono reserved for hashes/amounts.
- **ASK page** — phone-friendly, Telegram-reachable: paste a Casper token/pair (or "mint a test
  token") → one ASK button. Token Launch Challenge framing.
- **Live run** — the signal's wallet ticks down ("paid 0.4 CSPR — bought 5 pieces of evidence"); each
  evidence flag lands (`✓ supply renounced`, `⚠ single LP holder`). x402 spend is visible drama.
- **Verdict Card** (server-rendered image) — the aspect home-signal, the flags that drove it, the
  evidence list, **"what was not checked,"** a green **"Proven on Casper ✓ tx 0x…"** stamp linking to
  the real Testnet explorer + `get_dataset_root`, the `policy_hash`, and the honest footer.
- **SHARE (their choice)** — drops the Verdict Card image carrying a **CSPR.fans deep-link** to the
  vote page. Mobilization is a shipped feature.
- **Feed safety** — the public feed shows only self-minted fixtures + explicitly opted-in shares;
  it never auto-lists a real-token DANGER card.

## 10. Positioning / wedge (honest)

Not "the first Casper safety overlay." Verified: CSPR.trade MCP already returns `proceed/caution/high_risk`
**trade-level** hints (price impact, slippage, liquidity depth). Trust Signal's wedge is the part
CSPR.trade explicitly does **not** do: **project/token-level safety screening** (mint authority, LP
concentration, holder spread, contract age) wrapped in an **auditable, on-chain-stamped, shareable
Verdict Card the user owns** — versus an ephemeral hint inside a swap tool.

## 11. Scope

**In (qualifier):** subject resolver (+ user confirm), mandatory Testnet evidence pack (§7),
deterministic rule engine, LLM narrator, x402 settle + `record_decision` (reused), Merkle verify
(reused), server-rendered Verdict Card, ASK page, SHARE + CSPR.fans deep-link, simple shared-card
feed, 2–3 self-minted demo tokens + seed script, `policy_hash` leaf.

**Out (qualifier) — deferred / YAGNI:** GhostGuard payout (finals), mainnet stamping, accounts/auth,
leaderboard gamification beyond the basic feed, per-source micro-payments, holder-distribution if it
needs an indexer that isn't ready (mark "not checked"). Optional mainnet read-only preview only if
time permits.

**Rejected domains:** cross-chain token DD (most-crowded category in crypto; "why Casper?"); RWA-claim
verification (contested track + thin buyable evidence in 6 days); wallet/drainer checks (thin Casper
data).

## 12. Testing (TDD)

- **Priority: rule-engine unit tests.** Property: the LLM can never violate the deterministic floor;
  hard-fail → DANGER, thin → CAUTION, clean → CLEAR; missing signal → CAUTION + "not checked." Table
  of fixture signal-sets → expected aspect/flags.
- **Integration:** reuse the live-stack pattern (`apps/report-api/scripts/verify-live-e2e.ts`,
  `scripts/e2e-ui-drive.ts`) for the full ASK→quote→x402→reveal→verify→stamp path against the local
  report-api + facilitator + registry, asserting a fresh real Testnet tx per verdict and a resolvable
  explorer link.
- Keep existing tests green.

## 13. Six-day plan (→ July 1)

- **Day 1** — subject model + Testnet evidence gatherers; `buildLiveEvidenceDataset → buildSubjectEvidence`;
  deploy 2–3 demo CEP-18 tokens (clean/rug/thin) + mystery-mint seed script.
- **Day 2** — rule engine + aspect mapping + `policy_hash`, fully unit-tested.
- **Day 3** — LLM narrator + orchestration wired quote→buy(x402)→reveal→verify→record; first real
  end-to-end Testnet verdict.
- **Day 4** — ASK page (signal-box brand, Token Launch Challenge) + Verdict Card renderer + visible
  x402 spend.
- **Day 5** — SHARE + CSPR.fans deep-link + shared-card feed; honest copy; lock 3 demo subjects;
  record the 60-second video. (Optional: mainnet read-only preview.)
- **Day 6** — README / open-source polish + DoraHacks submission; brief community for distinct
  CSPR.fans votes; buffer.

## 14. Phase 2 — GhostGuard (finals only, July 6–19; deferred)

If the project advances, build the one mechanic the rail lacks: an **outbound pool→user CEP-18
transfer**. Parametric micro-insurance reuses everything Trust Signal builds (subject → evidence →
`record_decision`) and adds a funded pool wallet/signer, a payout trigger, and a "GHOST PAID YOU"
receipt card. Fully specced when/if qualified. No July-1 dependency — the reason it was staged.

## 15. Risks & mitigations (from adversarial review)

1. **Evidence availability** (holder distribution may need an indexer) → build the pack around
   RPC-gettable signals; mark anything else "not checked"; never fake.
2. **Optional-evidence loophole** → mandatory base pack + deterministic verdict (§6).
3. **Self-minted-fixture credibility** → frame as controlled risk fixtures + Token Launch Challenge +
   optional mainnet read-only preview.
4. **x402 ceremony** → blind-reveal mystery tokens; the answer is unknown until bought (§8).
5. **Positioning collision with CSPR.trade MCP** → wedge = project-level screening + auditable stamped
   card, not trade-level risk (§10).
6. **Legal/social (accusation wall)** → share-by-choice; feed shows only fixtures + opt-ins (§9).
7. **DD is less viral than insurance/trading** → Token Launch Challenge hook ("can your token pass?");
   the shareable CLEAR badge is the propagation unit.

## 16. Open items to confirm during implementation

- Exact RPC / CSPR.cloud calls that yield each §7 signal on Testnet (and which fall to "not checked").
- Whether the existing single-settlement-per-quote model fully covers the bundle, or per-source
  micro-payments are worth the extra drama (default: single settlement).
- LLM provider/runtime for the narrator (server-side; default Claude).
- CSPR.fans deep-link format + any required vote-page integration.

## 17. Buildathon compliance & judging alignment

Checked against the Buildathon submission requirements, eligibility criteria, and final-round
judging criteria. The design meets every hard requirement; three soft spots are actively mitigated.

### Hard requirements — met

| Requirement | How Trust Signal meets it |
|---|---|
| Working Testnet prototype with a **transaction-producing on-chain component** | Each verdict produces a real Testnet x402 settlement + `record_decision_with_root` tx |
| Open-source GitHub repo + README/usage | Day 6 deliverable (§13) |
| Public demo video | Day 5 deliverable (§13) |
| Focus: Agentic AI, emphasis DeFi/RWA | Agentic DeFi due-diligence agent |
| Agentic def: MCP + x402 + wallet signing + contract interaction | Uses all four (reused rail) |
| Working smart contracts on Testnet | Deployed `AgentPayRegistry`; real txs per verdict |
| Qualifies on **both** paths | Community-vote (shareable card + CSPR.fans deep-link) **and** technical-eligibility (Testnet tx) |

### Soft spots — mitigations

1. **"All code original and newly developed for the Buildathon."** The reused rail is the team's
   **own** buildathon work (AgentPay, built in June 2026 for this event), not imported third-party
   code — so it is compliant. The README and video must frame this honestly as "our buildathon
   project, evolved," never as a from-scratch claim. (Aligns with the standing rule: do not claim
   "first" / "one of a kind.")
2. **"Use of AI / Agentic Systems" vs the deterministic verdict.** Making the verdict rule-based (for
   honesty, §6) reduces the "the AI decided by itself" narrative. Mitigation: foreground the genuinely
   autonomous behaviour — the agent autonomously resolves the subject, selects which evidence to
   pursue, **pays its own x402 from its wallet**, verifies the proofs, and narrates; the deterministic
   floor is a safety rail *on top of* that agency, not its absence. The demo must *show* the
   autonomous self-paying loop, not bury it.
3. **"Long-Term Launch Plans — real project with socials + actual deployment plans"** (judging
   criterion). Add as a Day-6 submission item: a basic social presence + a one-line roadmap —
   **Testnet now → mainnet CSPR.trade / Ghostminter coverage → GhostGuard parametric insurance in the
   finals window** (§14).

### Deadline

Guidelines state **June 30**; the live DoraHacks page states **July 1**. Treat **June 30** as the real
target and submit a day early. The §13 plan is sized to finish by then.
