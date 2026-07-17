import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

// The one shared easing for every entrance and settle in this variant — a calm,
// no-bounce ease-out mirroring --av-ease in modern.css. This matches the Aave
// motion recipe (fade + rise + de-blur) measured in the design brief.
export const MODERN_EASE = [0.22, 0.61, 0.36, 1] as const;

// A workflow step, presented as a white rounded card on the lavender-washed
// field. On first scroll into view it plays the Aave entrance recipe —
// opacity 0→1, translateY(8px)→0, blur(4px)→0 — staggered by position. The
// currently-actionable step is edge-marked in lavender (a navigation cue, never
// a verdict). Cards settle after mount so off-screen steps never remain invisible
// in full-page captures or browsers with unreliable intersection observation.
export function StepCard({
  index,
  active,
  children
}: {
  index: number;
  active: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="av-step"
      data-active={active ? "true" : "false"}
      initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(4px)" }}
      animate={
        // transitionEnd drops the settled blur(0px): leaving it applied keeps the
        // card on its own compositing layer and rasterizes text soft.
        reduce ? undefined : { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }
      }
      transition={
        reduce
          ? { duration: 0 }
          : { duration: 0.7, ease: MODERN_EASE, delay: Math.min(index * 0.05, 0.3) }
      }
    >
      {children}
    </motion.div>
  );
}
