# HACKATHON.md - Requirements Brief & Submission Checklist

Single source of truth for the AgentPay Casper Agentic Buildathon submission.
Last checked: 2026-07-06.

---

## 1. Event

| Field | Value |
|---|---|
| Hackathon / bounty name | Casper Agentic Buildathon 2026 - Qualification Round |
| Platform | DoraHacks |
| Submission / BUIDL page URL | https://dorahacks.io/hackathon/casper-agentic-buildathon/detail |
| Chosen track | Casper Innovation Track / unified qualification track |
| Why this track | AgentPay Trust Pass turns Casper x402-paid evidence into a consumer-readable, re-checkable on-chain trust receipt for tokens and wallets. |
| Deadline (event TZ) | 2026-07-07 23:59 UTC, per Casper official announcement channel |
| Deadline (Africa/Lagos) | 2026-07-08 00:59 WAT |
| Deadline (US reference) | 2026-07-07 19:59 ET / 16:59 PT |

---

## 2. Sources of Rules

| Source | URL | Read? | Notes / conflicts |
|---|---|---|---|
| DoraHacks platform listing | https://dorahacks.io/hackathon/casper-agentic-buildathon/detail | yes | Platform source for event, eligibility, and required deliverables. Search result and local `details.txt` agree on core requirements. |
| DoraHacks BUIDL/submission surface | https://dorahacks.io/hackathon/casper-agentic-buildathon/buidl | yes | Requires project fields and links. Public GitHub and demo video still pending. |
| Casper official announcement channel | https://t.me/s/casperofficialann | yes | Confirms extension and concrete deadline: July 7, 2026, 23:59 UTC. |
| Local event brief | `details.txt` | yes | Older local brief says June 30 deadline. Treat official extension as current, but keep the shorter remaining buffer operationally. |
| Local submission draft | `docs/dorahacks-submission.md` | yes | Submission copy and evidence ledger. Needs final GitHub/video URLs before paste. |
| Local live capability ledger | `docs/live-capabilities.md` | yes | Boundary for what can be claimed live. Do not exceed it in submission copy. |

Open questions to confirm in the event channel:

- Whether the submission form requires a live hosted web URL beyond GitHub and video. The published requirements emphasize a working prototype on Casper Testnet, open-source repo, and demo video; if a hosted demo URL field exists, treat it as mandatory.
- Whether the final BUIDL page must include a CSPR.fans voting link at submission time or only after approval.

---

## 3. Requirements

| Weight | Requirement | What satisfies it | Status | Evidence |
|---|---|---|---|---|
| MANDATORY | Working prototype deployed on Casper Testnet with transaction-producing on-chain component | AgentPayRegistry installed on Testnet; fresh paid UI flow settles x402 payment and records decision on-chain | done | Registry package `hash-73ce206e78b8bc6d5c4ada857c629cd0b9c0dda320d091cd6bdd7c3fa7651d97`; latest paid E2E settlement `18139485f3546d29d543ffb89c4472ac8f59cd989b8e32df51e9b5a27b3300e1`; decision deploy `dd53186c084d8da08b2a48388fbfc6363cda4794f35b75ccd4c5cc2d9b4ebcfd`; result file `/tmp/agentpay-paid-e2e/result.json` |
| MANDATORY | Open-source repository | Public GitHub/GitLab/Bitbucket repo containing code and README | blocked | No push yet; `SUBMISSION_GITHUB_URL` missing; `npm run submission:check` fails this gate |
| MANDATORY | Demo video | Public walkthrough showing quote, x402 payment, Merkle verification, and on-chain record | blocked | `SUBMISSION_DEMO_VIDEO_URL` missing; `npm run submission:check` fails this gate |
| MANDATORY | Agentic AI focus | Agents can inspect readiness, buy reports, verify proof, and record decisions through MCP/HTTP tools | done | README MCP tools; `apps/mcp-server`; UI evidence desk; passing tests |
| MANDATORY | Casper integration | Casper RPC, x402, CEP-18 payment asset, and AgentPayRegistry are all used in the core flow | done | `docs/dorahacks-submission.md`; `docs/x402-self-hosted.md`; fresh paid UI E2E evidence |
| MANDATORY | Original/new build | Code and content must be original/new for the buildathon | needs owner confirmation | User/project owner should confirm no non-original copied code outside declared OSS dependencies |
| MANDATORY | Correct submission page fields | DoraHacks BUIDL fields complete, correct track, links working, screenshots attached if required | pending | Cannot complete until repo/video URLs exist |
| WEIGHTED | Technical execution | Tests/build pass; contract builds; payment/proof/record flow demonstrated | done | `npm test`, `npm run build`, paid UI E2E result |
| WEIGHTED | Innovation/originality | Paid evidence oracle for autonomous agents with re-checkable Casper-rooted decision trail | ready for writeup | Use `docs/dorahacks-submission.md` problem/what-it-does sections |
| WEIGHTED | Use of AI / agentic systems | MCP/HTTP tool surface lets agents operate the rail without holding keys in the web UI | done | `quote_report`, `buy_report`, `verify_report`, `record_decision`, `assess_subject`, `assess_account` |
| WEIGHTED | Real-world applicability | Risk/evidence checks for tokens and counterparties before agent payments or DeFi actions | ready for writeup | Web `/check`, `/counterparty`, evidence desk |
| WEIGHTED | User experience/design | Trust Pass landing, token check, counterparty check, copyable receipt card, feed/card surface | done locally | Web UI screenshots and tests |
| WEIGHTED | Long-term launch plans | Explain next steps: durable storage, token-state indexer, production monitoring, mainnet path | pending writeup polish | README and `docs/live-capabilities.md` deferred list |
| WEIGHTED | Community voting path | Submit BUIDL and share CSPR.fans voting link after approval | pending | Need public BUIDL URL / vote link |

---

## 4. Required Deliverables

| Deliverable | Constraint | Status | Link |
|---|---|---|---|
| Working Casper Testnet prototype | Must produce on-chain transaction | done | Settlement `18139485f3546d29d543ffb89c4472ac8f59cd989b8e32df51e9b5a27b3300e1`; decision deploy `dd53186c084d8da08b2a48388fbfc6363cda4794f35b75ccd4c5cc2d9b4ebcfd` |
| Public GitHub repo | Must be public, code present, README setup works | blocked | No pushes yet |
| Demo video | Public video explaining project, features, and walkthrough | blocked | Not recorded/uploaded yet |
| Written description | DoraHacks form copy | draft ready | `docs/dorahacks-submission.md` |
| Screenshots | Attach if form requires them | available locally | `/tmp/agentpay-paid-e2e/retry-shots/` |
| Submission page fields | All filled, correct track selected | pending | Needs repo/video links first |
| License | Required if platform asks / best practice for OSS | needs check | No license status confirmed in audit |
| Hosted web demo URL | If form has a URL field, must work in fresh browser | open | Current app runs locally at `http://127.0.0.1:5180/`; public hosted URL not confirmed |

---

## 5. Access & Credits

| Item | Needed for | Requested? | Received? | Fallback |
|---|---|---|---|---|
| Casper Testnet funds | Deploy registry, pay record tx, facilitator gas | yes | yes | Faucet / funded local key directory |
| x402 CEP-18 asset | Paid report settlement | yes | yes | Self-hosted `casper-x402` path already proven |
| CSPR.cloud facilitator token | Hosted facilitator path | no / optional | not required for proven path | Use self-hosted facilitator; do not claim hosted path proven |
| Public repo hosting | Required submission deliverable | pending | pending | Push public repo before submission |
| Public video hosting | Required submission deliverable | pending | pending | Upload demo video before submission |

---

## 6. Rubric to Evidence Map

| Rubric criterion | Weight | Where judge sees it | Gap? |
|---|---|---|---|
| Technical execution | high | README architecture, tests, paid E2E txs, AgentPayRegistry contract | Need public repo URL |
| Innovation & originality | high | Submission description: AgentPay Trust Pass, paid evidence oracle, x402 agent payments, Merkle root verification, copyable on-chain decision receipt | Owner confirmation on originality |
| Use of AI / agentic systems | high | MCP tools and agent docs in `docs/agents/SKILL.md` and README | Make agent flow visible in video |
| Real-world applicability | high | Token/counterparty trust checks and evidence desk | Mention limits honestly: not financial advice; unavailable signals are not checked |
| UX/design | medium | Web UI walkthrough and screenshots | Need public video |
| Working smart contracts | high | AgentPayRegistry package/install/decision hashes | Done |
| Long-term launch plans | medium | README/live capabilities/deferred roadmap | Add concise launch plan to submission form |
| Potential Casper ecosystem impact | high | Agents pay over x402 and write re-checkable Casper attestations | Make Casper integrations explicit in first 30 seconds of video |

---

## 6A. Competitive Positioning Verdict

Current verdict: competitively viable, but only if framed as a paid-evidence trust
receipt, not as a generic x402 payment app.

What is crowded in the Casper field:

- x402 payment rails for agents and APIs.
- MCP-native Casper agents.
- Agent wallets / transaction helpers.
- DeFi or portfolio agents that read Casper state and submit transactions.

AgentPay's defensible novelty:

- Consumer-facing Trust Pass: the result is a portable receipt, not only a backend API response.
- Quote-time commitment to a dataset root before payment.
- Paid report release after x402 settlement.
- Merkle proof verification of the released evidence.
- Deterministic CLEAR / CAUTION / DANGER policy output.
- Casper registry write binding the decision to the evidence and payment receipt.

How to pitch it:

> AgentPay is not another x402 gateway. It is a paid-evidence trust oracle for
> autonomous agents: the agent pays for evidence, verifies the evidence against a
> committed root, and records the resulting decision on Casper so the decision is
> replayable later.

Consumer pitch:

> AgentPay Trust Pass lets a user or agent check a Casper token or wallet, pay
> for the evidence over x402, and leave with a copyable receipt containing the
> evidence root, payment receipt, settlement transaction, Casper decision record,
> and policy hash.

Do not lead with:

- "AI agent payments"
- "x402 marketplace"
- "MCP tool access"

Those are now table stakes in this hackathon and overlap with multiple live
projects.

Lead with:

- "re-checkable paid evidence"
- "proof of what the agent checked and decided"
- "x402-funded evidence reports with Casper-anchored receipts"
- "not checked is explicit, never guessed"

Main competitive risk:

- Other projects may have cleaner public submission assets or broader demos.
  AgentPay needs a crisp video showing the exact paid E2E flow and the resulting
  Casper transaction hashes.

## 6B. Product Conversion Plan Executed

Goal: convert AgentPay from a technical x402/evidence console into a more novel,
consumer-readable Trust Pass product without adding an unnecessary dependency.

Implemented locally:

- Landing repositioned to "AgentPay Trust Pass".
- First-screen consumer paths now center "check a token" and "check a wallet".
- The product now explains the receipt model before the technical rail.
- Verdict cards now show a copyable Trust Pass receipt packet:
  - dataset root
  - x402 payment receipt hash
  - settlement transaction
  - Casper decision record
  - policy hash
- Token and counterparty pages now describe buying a Trust Pass, not just running
  a backend assessment.
- Submission draft updated to lead with Trust Pass instead of generic Trust
  Signal / x402 plumbing.

Reason this matters for judging:

- Casper x402 and MCP are crowded. The Trust Pass turns those primitives into a
  consumer artifact judges can understand in one screen.
- The demo can now show a direct before/after: user checks a token/wallet, pays
  for evidence, verifies the root, records the result, copies the receipt.

---

## 7. Current Verification Gate

- [x] Every Casper/on-chain mandatory item demonstrated locally and on Testnet
- [x] `npm run lint --workspaces --if-present` passed under Node 22.13.0
- [x] `npm test` passed under Node 22.13.0
- [x] `npm run build` passed, including contract Wasm build
- [x] Fresh paid UI E2E completed: quote -> x402 settle -> proof verify -> registry record
- [ ] Public repository URL exists and is reachable
- [ ] Demo video exists, is public/reachable, and shows the required functionality
- [ ] DoraHacks submission page complete with correct track and working links
- [ ] Sponsor/co-host integration visible in the submission, not just in code
- [ ] Deadline buffer confirmed before final submit

Latest `npm run submission:check` status:

- Passes README, live-capabilities, registry Wasm, source-integrity, Casper RPC, Casper client, key readability, funding, registry package hash, registry install confirmation, x402 config, x402 settlement confirmation, and decision confirmation.
- Fails only:
  - `SUBMISSION_GITHUB_URL` missing
  - `SUBMISSION_DEMO_VIDEO_URL` missing

Verdict: not ready to submit until public repo and public demo video are available.

---

## 8. Submission Order

1. Do not push until the owner approves.
2. When approved, push code to a public repository.
3. Record demo video using the fresh paid UI E2E flow:
   - show app
   - show Trust Pass landing, token check, wallet check, and receipt packet
   - show quote
   - show x402 requirement
   - paste signed x402 payload
   - show settlement tx
   - show proof verification
   - show registry decision tx
   - copy the Trust Pass receipt
   - show `npm run submission:check`
4. Upload video publicly.
5. Update `.env.submission.local` with `SUBMISSION_GITHUB_URL` and `SUBMISSION_DEMO_VIDEO_URL`.
6. Run `npm run submission:check`; require exit code 0.
7. Fill DoraHacks BUIDL page and submit before 2026-07-07 23:59 UTC.

---

## 9. Post-result Notes

Record judge feedback here after results. If the project misses advancement, classify whether it was a product-quality issue or a submission-requirement issue.
