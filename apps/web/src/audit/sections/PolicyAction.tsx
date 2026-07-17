import { useEffect, useMemo, useState } from "react";
import type { AuditFlow } from "../useAuditFlow";
import { formatAtomicAmount, parseDisplayAmount } from "../paymentAmounts";
import { HashValue, StepStatusLine } from "./primitives";

export function PolicyAction({ flow }: { flow: AuditFlow }) {
  const terms = flow.check.data?.check.terms ?? flow.probe.data?.terms ?? null;
  const asset = terms?.asset.toLowerCase().replace(/^hash-/, "") ?? "";
  const decimals = terms?.extra.decimals ?? null;
  const symbol = terms?.extra.symbol?.trim() || "token";
  const existingCap = asset ? flow.policy.data?.assetDailyCaps[asset] : undefined;
  const initialLimit = useMemo(
    () => displayAmount(existingCap ?? terms?.amount ?? "", decimals),
    [decimals, existingCap, terms?.amount]
  );
  const [dailyLimit, setDailyLimit] = useState(initialLimit);
  const [inputError, setInputError] = useState<string | null>(null);
  const walletConnected = flow.walletSession.status === "success";

  useEffect(() => {
    setDailyLimit(initialLimit);
    setInputError(null);
  }, [asset, initialLimit]);

  if (!terms) return null;

  const chargeDisplay = displayAmount(terms.amount, decimals);
  const inputLabel = decimals === null ? "Daily limit in smallest token units" : `Daily limit in ${symbol}`;

  return (
    <section className="audit-section" aria-label="Payment rules" data-step-state="review">
      <div className="audit-section-head">
        <h2>Set a daily payment limit</h2>
        <span className="audit-tag" data-state="review">rule needed</span>
      </div>

      <p className="audit-note">
        The current charge is {chargeDisplay} {symbol}. The starting limit allows one charge of this size today.
      </p>
      <p className="audit-note">
        This rule covers only this Casper Testnet token and the connected wallet. Existing blocks and other token limits stay in place.
      </p>

      <label className="audit-control-label" htmlFor="asset-daily-limit">{inputLabel}</label>
      <input
        id="asset-daily-limit"
        className="audit-input"
        type="text"
        inputMode={decimals === null ? "numeric" : "decimal"}
        autoComplete="off"
        aria-label={inputLabel}
        value={dailyLimit}
        onChange={(event) => {
          setDailyLimit(event.target.value);
          setInputError(null);
        }}
      />

      {inputError ? <p className="audit-note" data-state="error" role="alert">{inputError}</p> : null}

      {walletConnected ? (
        <>
          <p className="audit-note">
            Casper Wallet will ask you to sign the limit. Signing it does not send CSPR or make a payment.
          </p>
          <div className="audit-actions">
            <button
              className="audit-button"
              data-action="primary"
              type="button"
              disabled={flow.policyAction.status === "running"}
              onClick={() => {
                try {
                  const atomicCap = decimals === null
                    ? positiveWholeNumber(dailyLimit)
                    : parseDisplayAmount(dailyLimit, decimals);
                  setInputError(null);
                  void flow.saveAssetPolicy(atomicCap);
                } catch (cause) {
                  setInputError(cause instanceof Error ? cause.message : "Enter a valid daily limit.");
                }
              }}
            >
              Save daily limit
            </button>
            <button className="audit-button" type="button" onClick={() => void flow.loadPolicy()}>
              Refresh current rules
            </button>
            <button className="audit-button" type="button" onClick={() => void flow.recheck()}>
              Run the check again
            </button>
          </div>
          <StepStatusLine
            status={flow.policyAction.status}
            error={flow.policyAction.error}
            emptyLabel="Your limit will be stored as a signed Casper account rule."
          />
          {flow.policyAction.status === "success" && flow.policyAction.data ? (
            <p className="audit-note" role="status" data-state="success">
              Daily limit saved. Run the check again to apply it and see what remains.
            </p>
          ) : null}
        </>
      ) : (
        <p className="audit-note" data-state="not_checked">
          Connect Casper Wallet to sign payment limits. An AgentPay token can run checks, but it cannot change account rules.
        </p>
      )}

      {flow.policy.data ? (
        <details className="audit-disclosure">
          <summary className="audit-note">View current rule details</summary>
          <dl className="audit-field-grid">
            <dt>daily limit</dt>
            <dd className="audit-mono">{flow.policy.data.assetDailyCaps[asset] ?? "not set"} smallest units</dd>
            <dt>revision</dt>
            <dd className="audit-mono">{flow.policy.data.revision}</dd>
            <dt>rule ID</dt>
            <dd><HashValue value={flow.policy.data.policyHash} /></dd>
          </dl>
        </details>
      ) : null}
      {flow.policy.status === "error" ? (
        <StepStatusLine status="error" error={flow.policy.error} emptyLabel="" />
      ) : null}
    </section>
  );
}

function displayAmount(atomicAmount: string, decimals: string | null): string {
  if (!atomicAmount) return "";
  return decimals === null ? atomicAmount : formatAtomicAmount(atomicAmount, decimals);
}

function positiveWholeNumber(value: string): string {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new TypeError("Enter a positive whole number of smallest token units.");
  }
  return normalized;
}
