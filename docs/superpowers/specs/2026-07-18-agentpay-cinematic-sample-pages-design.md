# AgentPay Cinematic Sample Pages Design

Date: 2026-07-18

## Goal

Build three complete, independently inspectable AgentPay sample pages inspired by the `cinematic-scroll-prompt-kit`. The existing landing page at `/` must remain visually and behaviorally unchanged. The new pages reuse AgentPay's established lavender, plum, paper, and semantic verdict colors together with the existing logo, ecosystem marks, and process icons.

The pages are visual prototypes, but every visible control must work, every claim must remain consistent with the product's documented live capabilities, and each page must be responsive, accessible, reversible on upward scroll, and safe under `prefers-reduced-motion`.

## Routes

- `/cinematic/proof-corridor` — complete product narrative.
- `/cinematic/signal-field` — minimal-copy visual experiment.
- `/cinematic/evidence-chamber` — payment-audit feature narrative.

Each page includes a compact variant switcher linking to the other two samples and a clear link back to the current landing page. No new link is added to the production landing navigation.

## Shared Architecture

The three pages share a small, dependency-free cinematic engine implemented in the existing React/Vite stack:

- A page-local scroll section supplies normalized progress from `0` to `1`.
- A sticky `100svh` stage renders one continuous visual world rather than unrelated full-screen sections.
- A readable scene configuration owns timeline boundaries.
- `requestAnimationFrame` smooths scroll and pointer targets, then stops after convergence.
- A small set of CSS custom properties is the rendering interface; CSS owns transforms, opacity, tint, blur, and scale.
- Shared helpers provide clamping, interpolation, smoothstep, range progress, and enter/hold/exit segments.
- Pointer parallax is subtle, independently smoothed, disabled for coarse pointers, and removed for reduced motion.
- The shared engine and chrome are isolated under a cinematic module. Each concept owns its scene markup, content data, and scoped stylesheet.

Existing animation libraries are not required. The minimum component set is React, browser APIs, CSS, and existing brand assets.

## Page 1: Proof Corridor

### Purpose

Explain the complete AgentPay path to a cold visitor: read a charge, check it, sign locally, settle, verify, and anchor a receipt.

### Visual world

A pale lavender transaction corridor recedes through layered rings. A real payment-request card is the hero object. Existing workflow icons sit at different depths along a luminous proof rail. Near layers separate as the viewer moves forward, revealing evidence panels without leaving the scene.

### Narrative beats

1. Hero: “The path from charge to proof.” The payment request waits at the corridor entrance.
2. Check: the foreground opens and exposes PAY / REVIEW / BLOCK as policy outcomes.
3. Sign and settle: the wallet boundary moves forward; copy states that signing remains local.
4. Verify and receipt: matched terms converge into a sealed receipt and Casper anchor.
5. Final rail: interactive links to Payment checker, Token check, Wallet check, Agents, and Console.

## Page 2: Signal Field

### Purpose

Demonstrate the brand at its most cinematic with minimal product exposition while preserving a truthful through-line from uncertainty to legible proof.

### Visual world

A deep plum field contains sculptural liquid-metal forms built from layered CSS/SVG surfaces, rings, masks, grain, and light—not a prerecorded video timeline. The forms begin noisy and asymmetrical, then resolve into one clean lavender signal as progress advances. Copy is sparse and editorial.

### Narrative beats

1. Hero: “Every payment leaves a shape.”
2. Disturbance: near surfaces split and expose a field of ambiguous signals.
3. Focus: one proof signal remains while the background falls slightly out of focus.
4. Resolution: the field returns to clarity with the line “AgentPay makes it legible.”
5. Final rail: an interactive “signal anatomy” catalog for Terms, Policy, Wallet boundary, Settlement, and Receipt; each card links to the corresponding real AgentPay surface where applicable.

## Page 3: Evidence Chamber

### Purpose

Tell the payment-auditor story in detail: inspect an x402 charge before signing, enforce policy, verify the exact Casper settlement, and issue a durable receipt.

### Visual world

A warm paper-and-plum evidence room centers a large payment request. The request separates into depth layers—request binding, amount and asset, provider policy, payer authorization, settlement match, and receipt anchor. Existing audit and receipt icons become diagrammatic foreground instruments.

### Narrative beats

1. Hero: “Before the wallet signs anything.” A REVIEW request is suspended over the audit grid.
2. Terms: the request expands into inspectable amount, asset, network, payee, and original-request bindings.
3. Policy: PIN / DENY and spend controls enter within the opened negative space.
4. Settlement: the transaction and approved terms align into a visible match.
5. Receipt: the layers seal into an anchored receipt.
6. Final rail: interactive audit checkpoints linking to Payment checker, Agents integration, Console, and the existing product overview.

## Shared Navigation and Interactions

- Persistent compact header: AgentPay mark, current concept name, variant switcher, back to overview.
- Desktop scroll cue that disappears after the opening beat.
- Keyboard-operable previous/next controls on every final card rail.
- Touch dragging/swiping for card rails, with no fake infinite clones.
- Real internal routes for every card and CTA; no dead controls or placeholder language.
- Semantic headings, landmarks, lists, links, and buttons with visible focus states.

## Responsive and Reduced-Motion Behavior

Desktop and landscape tablet use the full sticky scene. Portrait tablet and mobile preserve each focal subject with concept-specific crop positions and shorter scroll travel. Pointer parallax is disabled on coarse pointers.

Under `prefers-reduced-motion`, inertial smoothing, large zooms, lateral sweeps, blur choreography, and pointer parallax are removed. Each page presents a static hero followed by the same narrative content and interactive rail in normal document flow, so no information is lost.

## Asset Contract

The pages reuse:

- `apps/web/src/assets/agentpay-logo.png`
- brand marks under `apps/web/src/assets/brand-logos/`
- existing process icons in `apps/web/src/landing2/icons.tsx`
- established tokens from `apps/web/src/styles.css` and `apps/web/src/landing2/landing2.css`

New cinematic layers are DOM/CSS/SVG compositions stored within the cinematic module. They share a documented virtual 16:9 stage, explicit z-index bands, stable transform origins, and sufficient overscan to prevent exposed edges. No external image service, WebGL scene, new font package, or new animation dependency is required.

## Isolation

The current `Landing2` component and `landing2.css` are not edited. The application router receives only the three new route entries and the route-class bookkeeping needed to isolate the global living field from cinematic pages. New CSS is scoped below cinematic root classes.

## Verification

Before handoff:

- Run the web TypeScript check, unit tests, and production build.
- Test direct navigation to all three routes and all visible links.
- Inspect timeline checkpoints around `0.00`, `0.18`, `0.27`, `0.44`, `0.58`, `0.74`, `0.90`, and `1.00` in both scroll directions.
- Inspect 1440×900, 1280×720, 1024×768, 768×1024, and 390×844.
- Verify keyboard navigation, card controls, touch behavior, 200% zoom, reduced motion, and absence of horizontal overflow.
- Review console output and confirm the existing `/` landing is unchanged.

## Acceptance Criteria

- Three finished pages are independently reachable at the specified routes.
- Each reads as one coherent scroll-driven world with distinct art direction.
- The current landing page is untouched apart from router-level access to the new samples.
- Scrolling upward cleanly reverses every timeline state.
- Mobile and reduced-motion modes retain all content and working interactions.
- Every visible control has a real action, and product claims remain accurate.
- No additional runtime dependency is introduced.
