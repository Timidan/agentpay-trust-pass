import { CheckCircle, Clock, Receipt, ShieldCheck, Wallet } from "@phosphor-icons/react";
import { AgentPayTimeline, AgentPayTimelineItem } from "./AgentPayUi";

export type EvidenceStep = {
  label: string;
  value: string;
  state: "pending" | "done";
  kind: "quote" | "payment" | "proof" | "record";
};

const icons = {
  quote: Clock,
  payment: Wallet,
  proof: ShieldCheck,
  record: Receipt
};

export function AgentPayEvidenceTimeline({ steps }: { steps: EvidenceStep[] }) {
  return (
    <AgentPayTimeline aria-label="AgentPay evidence timeline">
      {steps.map((step) => {
        const Icon = step.state === "done" ? CheckCircle : icons[step.kind];
        return (
          <AgentPayTimelineItem key={step.label} state={step.state}>
            <span className="timeline-icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span>
              <span className="timeline-label">{step.label}</span>
              <span className="timeline-value">{step.value}</span>
            </span>
          </AgentPayTimelineItem>
        );
      })}
    </AgentPayTimeline>
  );
}
