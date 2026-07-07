import { Check, Flag as FlagIcon, Minus, WarningOctagon } from "@phosphor-icons/react";
import type { Flag } from "../../../../packages/agent-pay-core/src/trust/rules";
import { labelForNotChecked } from "../lib/not-checked-labels";

/**
 * The evidence read, as a traffic-light list built from real rule output:
 * danger, then caution, then passed, then not-checked. Every row is a colored
 * left edge plus a glyph (mark, flag, tick, dash). No dots.
 */
export function AgentPayCheckList({
  flags,
  notChecked,
  passed
}: {
  flags: Flag[];
  notChecked: string[];
  passed: string[];
}) {
  const dangers = flags.filter((f) => f.severity === "danger");
  const cautions = flags.filter((f) => f.severity === "caution");
  const total = flags.length + notChecked.length + passed.length;

  return (
    <div className="check-list">
      <p className="check-summary">
        <span className="check-count">{total} checks read</span>
        <span className="check-breakdown">
          {flags.length} flagged · {notChecked.length} not checked · {passed.length} passed
        </span>
      </p>
      <ul>
        {dangers.map((f) => (
          <li key={f.code} className="check-row is-danger">
            <WarningOctagon size={15} weight="bold" aria-hidden="true" />
            <span>{f.message}</span>
          </li>
        ))}
        {cautions.map((f) => (
          <li key={f.code} className="check-row is-caution">
            <FlagIcon size={15} weight="bold" aria-hidden="true" />
            <span>{f.message}</span>
          </li>
        ))}
        {passed.map((message) => (
          <li key={message} className="check-row is-pass">
            <Check size={15} weight="bold" aria-hidden="true" />
            <span>{message}</span>
          </li>
        ))}
        {notChecked.map((key) => (
          <li key={key} className="check-row is-unchecked">
            <Minus size={15} weight="bold" aria-hidden="true" />
            <span>{labelForNotChecked(key)}</span>
            <span className="check-tag">not checked this run</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
