import type { ProofStep } from "../api";
import { AgentPayCodeBlock, AgentPaySurface } from "./AgentPayUi";

export function AgentPayProofPath({ proof }: { proof: ProofStep[] }) {
  if (proof.length === 0) {
    return <p className="muted">AgentPay proof path appears after the report is paid.</p>;
  }

  return (
    <div className="proof-path">
      {proof.map((step, index) => (
        <AgentPaySurface variant="proof" key={`${step.position}-${step.hash}`}>
          <span className="proof-position">{index + 1}. {step.position}</span>
          <AgentPayCodeBlock className="proof-hash">{step.hash}</AgentPayCodeBlock>
        </AgentPaySurface>
      ))}
    </div>
  );
}
