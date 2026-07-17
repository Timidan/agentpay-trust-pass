import { Check, Warning } from "@phosphor-icons/react";

export type EvidenceStep = {
  label: string;
  caption: string;
  value: string;
  state: "waiting" | "active" | "done" | "blocked";
  kind: "quote" | "payment" | "proof" | "record";
};

/**
 * The settlement rail as one numbered pipeline (quote to record). It merges
 * what used to be a flat status strip and a separate vertical timeline into a
 * single ordered story. State reads through the number badge, a colored left
 * edge, and a tick or warning glyph. No dots.
 */
export function AgentPayPipelineRail({ steps }: { steps: EvidenceStep[] }) {
  return (
    <ol className="agent-pay-pipeline-rail" aria-label="Payment check progress">
      {steps.map((step, index) => (
        <li key={step.kind} className={`rail-stop is-${step.state}`}>
          <span className="rail-num" aria-hidden="true">
            {step.state === "done" ? (
              <Check size={13} weight="bold" />
            ) : step.state === "blocked" ? (
              <Warning size={13} weight="bold" />
            ) : (
              index + 1
            )}
          </span>
          <div className="rail-body">
            <div className="rail-line">
              <span className="rail-name">{step.label}</span>
              <span className="rail-value">{step.value}</span>
            </div>
            <p className="rail-caption">{step.caption}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
