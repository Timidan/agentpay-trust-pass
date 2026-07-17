import { motion, useReducedMotion } from "motion/react";
import type { AuditFlow } from "../../useAuditFlow";
import { ReasonList } from "../../sections";
import { MODERN_EASE } from "./StepCard";

// The canonical verdict word is read verbatim from flow.decision. No decision
// logic is re-implemented here — this is a presentation layer that elevates the
// backend's word into the hero. The DecisionPanel step below remains the honest
// full section (run-check control, idempotency key, basis, policy hash, reasons).
type Verdict = NonNullable<AuditFlow["decision"]>;

// One direct, plain-language instruction per verdict.
const FACE: Record<Verdict, { word: string; qualifier: string }> = {
  pay: {
    word: "PAY",
    qualifier: "This charge matches your rules. The buyer can sign it in their own wallet; AgentPay has not paid it."
  },
  review: {
    word: "REVIEW",
    qualifier: "Pause here. Approve the provider or add the missing information before payment."
  },
  block: {
    word: "BLOCK",
    qualifier: "Do not pay this charge. One of your hard rules failed."
  }
};

// The hero. A full-width card that elevates when the check resolves: the verdict
// word set in Archivo with its reserved colour, one direct instruction, then the
// concrete backend reasons. The entrance (blur + 8px rise
// + fade + a soft 0.98→1 scale, ~0.7s) replays whenever a fresh decision
// resolves — the motion node is keyed by the check id so a REVIEW re-check (a new
// check id) re-presents. Behind prefers-reduced-motion it renders settled.
export function DecisionCard({ flow }: { flow: AuditFlow }) {
  const reduce = useReducedMotion();
  const verdict = flow.decision;
  const reasons = flow.check.data?.check.decision.reasons ?? [];
  const tone = verdict ?? "awaiting";
  // Stable presentation key: remount (→ replay) on a genuinely new decision only.
  const presentationKey = flow.check.data?.check.id ?? verdict ?? "awaiting";

  return (
    <motion.section
      key={presentationKey}
      className="av-decision"
      data-tone={tone}
      aria-label="Payment decision"
      aria-live="polite"
      initial={reduce ? false : { opacity: 0, y: 8, filter: "blur(4px)", scale: 0.98 }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1, transitionEnd: { filter: "none" } }}
      transition={reduce ? { duration: 0 } : { duration: 0.7, ease: MODERN_EASE }}
    >
      <p className="av-decision-kicker">Payment decision</p>

      <div className="av-decision-head">
        <span className="av-decision-word" data-decision={verdict ?? "none"}>
          {verdict ? FACE[verdict].word : "AWAITING"}
        </span>
      </div>

      <p className="av-decision-qualifier">
        {verdict
          ? FACE[verdict].qualifier
          : "Read a charge and run a check to see the PAY, REVIEW, or BLOCK decision."}
      </p>

      {verdict ? (
        <ReasonList
          label="Why AgentPay made this decision"
          reasons={reasons}
          emptyLabel="No blocking or review reasons were reported."
          showTechnicalDetails={false}
        />
      ) : null}
    </motion.section>
  );
}
