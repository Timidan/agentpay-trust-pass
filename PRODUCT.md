# Product

## Register

brand

(The public page is landing-led and strictly explanatory. The live AgentPay workspace is a separate app view opened only after explicit launch intent.)

## Users

Hackathon judges and Casper ecosystem developers evaluating AgentPay, plus operators of autonomous agents who open the app workspace to run a real quote → x402 → proof → registry flow. They arrive cold, usually via the demo video or repo link, and decide within one viewport whether this is a real settlement rail or a mockup.

## Product Purpose

AgentPay is an x402-paid evidence desk: agents buy live Casper product evidence, verify the Merkle proof against the dataset root, and record the trust decision on the Casper AgentPayRegistry contract. The UI must make the commit-root → pay → prove → clear sequence legible at a glance and let a connected agent run it end-to-end.

## Brand Personality

Exact, settled, live. The feel of a precision trading desk: calm surfaces, one saturated brand orange carrying the energy, monospace reserved for what is actually data (hashes, amounts, network ids). Confidence through evidence, not through claims.

## Anti-references

- Crypto-landing maximalism: neon gradients on black, 3D coins, glow-everything.
- Generic SaaS template: cream background, icon-card grids, eyebrow labels above every section.
- The previous iteration's failure mode: every string in heavy mono, grid-paper texture on every surface, six ambient animations competing at once.

## Design Principles

1. Show the rail, don't describe it. The hero visual is the product flow itself, animated.
2. Mono means data. If a string is not a hash, amount, state, or network id, it is not monospace.
3. Motion is settlement. Animations travel along the quote → x402 → proof → registry path or signal state changes; nothing drifts decoratively without meaning.
4. The landing explains before it operates. Agent controls do not appear on the public page; they live in the launched app workspace.
5. Evidence stays verbatim. Hashes, readiness checks, and copy that tests or agents depend on are never paraphrased for aesthetics.

## Accessibility & Inclusion

- WCAG AA contrast (≥4.5:1 body, ≥3:1 large text) in both themes; light is the default theme.
- Full `prefers-reduced-motion` fallback: ambient and entrance motion collapse to static or instant.
- All interactive elements keyboard-reachable with visible focus; decorative scenes are `aria-hidden`.
