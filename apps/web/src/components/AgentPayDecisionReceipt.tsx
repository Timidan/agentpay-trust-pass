import { ArrowSquareOut, SealCheck } from "@phosphor-icons/react";
import type { DecisionReceipt as DecisionReceiptData } from "../api";
import { AgentPayButton, AgentPayCodeBlock, AgentPaySurface } from "./AgentPayUi";

export function AgentPayDecisionReceipt({ receipt }: { receipt: DecisionReceiptData | null }) {
  if (!receipt) {
    return <p className="muted">AgentPay decision receipt appears after verification succeeds.</p>;
  }

  const explorer = `https://testnet.cspr.live/transaction/${receipt.txHash}`;
  const confirmationLabel =
    receipt.confirmation.executionState === "executed"
      ? "confirmed"
      : receipt.confirmation.executionState;

  return (
    <AgentPaySurface variant="receipt">
      <div className="receipt-heading">
        <SealCheck size={18} aria-hidden="true" />
        <span>AgentPay registry {confirmationLabel}</span>
      </div>
      <AgentPayCodeBlock>{receipt.txHash}</AgentPayCodeBlock>
      <p className="muted">
        {receipt.hashKind} checked by {receipt.confirmation.method}
        {receipt.confirmation.blockHash ? ` in block ${receipt.confirmation.blockHash.slice(0, 12)}...` : ""}
      </p>
      <AgentPayButton asChild variant="explorer">
        <a href={explorer} target="_blank" rel="noreferrer">
          <ArrowSquareOut size={16} aria-hidden="true" />
          View transaction
        </a>
      </AgentPayButton>
    </AgentPaySurface>
  );
}
