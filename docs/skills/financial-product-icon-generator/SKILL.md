---
name: financial-product-icon-generator
description: Use when generating, refining, cropping, normalizing, or exporting premium raster product icons or logos for financial products, especially AgentPay-style AP marks, payment-rail abstractions, trust-oriented fintech brands, and app-ready PNG assets.
---

# Financial Product Icon Generator

Create premium raster product icons for financial software. Favor a simple, ownable mark that feels trustworthy in a product UI before it feels decorative in a pitch deck.

## When to Use

Use this skill when the user asks for a generated or refined raster product icon, app icon, logo mark, or prompt direction for a financial product. It is especially relevant for AgentPay-like marks that need to signal payment rails, settlement, verification, or institutional trust without falling into crypto, AI, or dashboard cliches.

## Core Direction

- Lead with financial-product trust: stable, calm, exact, and useful.
- Generate a simple raster image, not a busy scene, badge set, or UI mockup.
- Abstract the product idea into a strong monogram or payment-rail gesture. For AgentPay, the winning direction is an organic AP shape: a tangerine A-like rail crossing into a charcoal P-like rail.
- Use a restrained palette: warm tangerine, deep charcoal, and soft off-white. Keep gradients subtle and material-like, not glossy.
- Prefer organic curves, broad strokes, clean negative space, and a confident app-icon silhouette.
- Keep it readable at 32px and polished at 512px.

## Avoid

- Radar screens, concentric circles, dashboards, or generic circle UI.
- Crypto coins, blockchain cubes, token stacks, chain links, or exchange symbols.
- Mascots, characters, hands, robots, or anthropomorphic agents.
- Documents, checkmarks, shields, locks, or verification clutter unless explicitly requested.
- Neon effects, purple/blue AI glow, holograms, glassy sci-fi styling, or prompt-art over-detailing.
- Literal text inside the icon. Do not render "AP" as typed letters when an abstract mark can carry it.

## Prompt Structure

Use compact prompts with clear hierarchy:

1. **Object**: "premium raster app icon / product logo mark".
2. **Concept**: "abstract AP monogram formed from payment rails".
3. **Shape language**: "wide organic curves, soft squared terminals, strong negative space".
4. **Palette**: "warm tangerine, deep charcoal, off-white background".
5. **Quality bar**: "fintech trust, minimal, app-ready, readable at small size".
6. **Exclusions**: "no radar, no coin, no cube, no mascot, no checkmark, no neon, no purple".

Example prompt:

```text
Premium raster app icon for a financial product named AgentPay: an abstract AP monogram formed from two smooth payment rails, warm tangerine rail crossing into a deep charcoal P-shaped rail, soft squared terminals, organic curves, clean off-white background, subtle material shading, strong negative space, trustworthy fintech feel, centered, app-ready, readable at 32px. No radar UI, no crypto coin, no blockchain cube, no mascot, no document, no checkmark, no neon, no purple, no text.
```

## Workflow

1. Restate the product promise in one sentence. For AgentPay: agents pay for verified product evidence and record trust decisions.
2. Reduce the promise to one visual abstraction. Prefer "payment rail plus AP monogram" over literal evidence, documents, chains, or AI symbols.
3. Generate 3-6 raster variants with the same palette and exclusions. Vary only one major trait at a time: curve weight, crossing angle, terminal shape, or negative-space opening.
4. Pick the strongest thumbnail first. If it fails at 32px, discard it even if it looks good large.
5. Iterate toward fewer elements, stronger silhouette, warmer tangerine, cleaner charcoal, and less gloss.
6. Stop when the mark reads as a financial product icon without needing explanatory UI or text.

## Iteration Checklist

- Does the silhouette still read when scaled to 32px?
- Is the AP/payment-rail abstraction visible without becoming literal typed letters?
- Does the palette stay warm tangerine + charcoal + off-white?
- Are the curves organic and premium rather than sharp, techy, or generic?
- Is the mark free of radar/circle UI, crypto tropes, mascots, documents, checkmarks, neon, purple, and AI gloss?
- Is the background simple enough for app use?
- Would the mark feel credible beside payment, settlement, evidence, or treasury UI?

## Normalize, Crop, Export

For app use, produce a clean PNG asset:

1. Crop to a square canvas with the mark optically centered.
2. Leave enough padding for rounded app containers, usually 6-10% of canvas width.
3. Use an off-white or transparent background based on the app surface. If the icon depends on negative-space contrast, keep the off-white background.
4. Export at 512x512 PNG for the primary app asset. Also generate 256x256, 128x128, 64x64, and 32x32 when the app needs fixed-size icons.
5. Use RGB color, not CMYK. Avoid embedded metadata unless required.
6. Check the 32px and 64px exports on light and dark UI surfaces before replacing an existing app asset.
7. Name files plainly, such as `agentpay-logo.png` or `product-icon-512.png`, and preserve the app's existing import path unless the user asks for a rename.
