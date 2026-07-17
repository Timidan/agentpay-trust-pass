import { useState, type ReactNode } from "react";
import type { AuditApiError } from "../api";

// Shared unstyled-but-semantic primitives. State is always carried by a word
// plus a data attribute (never colour alone); long hashes never overflow.

const TESTNET_EXPLORER = "https://testnet.cspr.live";

export function testnetTransactionUrl(hash: string): string {
  return `${TESTNET_EXPLORER}/transaction/${encodeURIComponent(hash)}`;
}

export function testnetDeployUrl(hash: string): string {
  return `${TESTNET_EXPLORER}/deploy/${encodeURIComponent(hash)}`;
}

export function testnetAccountUrl(accountHash: string): string {
  return `${TESTNET_EXPLORER}/account/${encodeURIComponent(accountHash.replace(/^account-hash-/, ""))}`;
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="audit-copy-button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => setCopied(false)
        );
      }}
    >
      {copied ? "Copied" : (label ?? "Copy")}
      <span className="audit-sr-only">{label ?? "Copy value"}</span>
    </button>
  );
}

function middleTruncate(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

// Long hashes/addresses: middle-truncate with the full value in title + a copy
// button, so the layout holds at 320px. Pass wrap to show the full value wrapped.
export function HashValue({
  value,
  wrap = false,
  copyable = true
}: {
  value: string;
  wrap?: boolean;
  copyable?: boolean;
}) {
  return (
    <span className="audit-copy-row">
      <code
        className={wrap ? "audit-mono" : "audit-hash audit-hash--truncate"}
        title={value}
      >
        {wrap ? value : middleTruncate(value)}
      </code>
      {copyable ? <CopyButton value={value} /> : null}
    </span>
  );
}

// A state tag: word + variant data-attribute. Variants map data-state to colour
// but the label text is authoritative.
export function StateTag({ state, children }: { state: string; children: ReactNode }) {
  return (
    <span className="audit-tag" data-state={state}>
      {children}
    </span>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <HashValue value={value} />
      </dd>
    </>
  );
}

export function StepShell({
  title,
  state,
  children
}: {
  title: string;
  state?: string;
  children: ReactNode;
}) {
  return (
    <section className="audit-section" data-step-state={state ?? "idle"} aria-label={title}>
      <div className="audit-section-head">
        <h2>{title}</h2>
        {state ? <StateTag state={state}>{state.replaceAll("_", " ")}</StateTag> : null}
      </div>
      {children}
    </section>
  );
}

// Honest empty/loading/error rendering shared by every section.
export function StepStatusLine({
  status,
  error,
  emptyLabel
}: {
  status: "idle" | "running" | "success" | "error";
  error?: AuditApiError | null;
  emptyLabel: string;
}) {
  if (status === "running") return <p className="audit-note">Working…</p>;
  if (status === "error" && error) return <ApiErrorView error={error} />;
  if (status === "idle") return <p className="audit-note">{emptyLabel}</p>;
  return null;
}

// Leads with the actionable message. Machine-readable fields remain available
// to developers without making normal users parse transport details first.
export function ApiErrorView({ error }: { error: AuditApiError }) {
  return (
    <div className="audit-reason" role="alert" data-state="error">
      <strong>{error.message}</strong>
      <details className="audit-disclosure">
        <summary className="audit-note">View error details</summary>
        <dl className="audit-field-grid">
          <dt>code</dt>
          <dd className="audit-mono">{error.code}</dd>
          {error.field ? (
            <>
              <dt>field</dt>
              <dd className="audit-mono">{error.field}</dd>
            </>
          ) : null}
          {error.expected !== null && error.expected !== undefined ? (
            <>
              <dt>expected</dt>
              <dd className="audit-mono">{formatValue(error.expected)}</dd>
            </>
          ) : null}
          {error.received !== null && error.received !== undefined ? (
            <>
              <dt>received</dt>
              <dd className="audit-mono">{formatValue(error.received)}</dd>
            </>
          ) : null}
          <dt>retryable</dt>
          <dd className="audit-mono">{error.retryable ? "yes" : "no"}</dd>
        </dl>
      </details>
    </div>
  );
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
