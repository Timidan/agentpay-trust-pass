import type { ReactNode } from "react";
import type { AuditFlow } from "../../useAuditFlow";
import type { AuditVariantProps } from "../types";
import {
  ChargeTerms,
  DecisionPanel,
  OperatorAction,
  PolicyAction,
  ReceiptView,
  ResponseObservation,
  SettlementVerdict,
  SigningHandoff,
  TokenGate
} from "../../sections";
import { DecisionCard } from "./DecisionCard";
import { StepCard } from "./StepCard";
import "./modern.css";

// This view composes and styles the shared flow sections. It does not
// reimplement decision, settlement, or receipt logic; every state comes from
// `flow`.

type StepKey =
  | "auth"
  | "charge"
  | "decision"
  | "operator"
  | "sign"
  | "settlement"
  | "response"
  | "receipt";

// Reserved verdict tones only. Green = PAY/match/anchored, amber = REVIEW/pending,
// red = BLOCK/mismatch/failed/error. Everything else is honestly neutral. Lavender
// (the brand accent) is never a tone — it marks the active step, a navigation cue.
type RailTone = "neutral" | "pay" | "review" | "block";
type RailState = "waiting" | "active" | "done" | "error";
type RailStep = { key: StepKey; label: string; status: string; state: RailState; tone: RailTone };

// The single step the operator should act on next, derived honestly from flow.
function activeStep(flow: AuditFlow): StepKey {
  if (!flow.tokenPresent) return "auth";
  const captured = flow.probe.status === "success" && Boolean(flow.probe.data?.terms);
  if (!captured) return "charge";
  const decision = flow.decision;
  if (!decision) return "decision";
  if (decision === "review") return "operator";
  if (decision === "block") return "decision"; // Terminal — nothing further to do.
  // PAY path.
  if (flow.settlement.status === "idle") return "sign";
  if (flow.settlementVerdict === "match") {
    return flow.observation.status === "success" ? "receipt" : "response";
  }
  return "settlement";
}

type RawStep = { key: StepKey; label: string; status: string; tone: RailTone; done: boolean; error: boolean };

// Each step's honest status word, tone, and completion. Unreached steps stay
// "waiting"; pending/unverifiable/not-checked render as themselves. No state is
// fabricated and no verdict is invented.
function computeRawSteps(flow: AuditFlow): RawStep[] {
  const raw: RawStep[] = [];

  // AUTH
  raw.push({
    key: "auth",
    label: "Access",
    status: flow.tokenPresent ? "ready" : "connect wallet",
    tone: "neutral",
    done: flow.tokenPresent,
    error: false
  });

  // CHARGE
  {
    const probe = flow.probe;
    const captured = probe.status === "success" && Boolean(probe.data?.terms);
    let status = "waiting";
    let tone: RailTone = "neutral";
    let done = false;
    let error = false;
    if (probe.status === "running") status = "reading charge";
    else if (probe.status === "error") {
      status = "error";
      tone = "block";
      error = true;
    } else if (captured) {
      status = "captured";
      done = true;
    } else if (probe.status === "success") {
      status = "no charge"; // Honest: the target answered, but with no x402 charge.
    }
    raw.push({ key: "charge", label: "Charge", status, tone, done, error });
  }

  // DECISION
  {
    const check = flow.check;
    const verdict = flow.decision;
    let status = "waiting";
    let tone: RailTone = "neutral";
    let done = false;
    let error = false;
    if (check.status === "running") status = "checking";
    else if (check.status === "error") {
      status = "error";
      tone = "block";
      error = true;
    } else if (verdict) {
      status = verdict.toUpperCase();
      done = true;
      tone = verdict === "pay" ? "pay" : verdict === "review" ? "review" : "block";
    }
    raw.push({ key: "decision", label: "Decision", status, tone, done, error });
  }

  // OPERATOR — only a REVIEW decision requires it.
  {
    const verdict = flow.decision;
    let status = "waiting";
    let tone: RailTone = "neutral";
    let done = false;
    if (verdict === "review") {
      status = "required";
      tone = "review";
    } else if (verdict) {
      status = "not required";
      done = true;
    }
    raw.push({ key: "operator", label: "Review", status, tone, done, error: false });
  }

  // SIGN — the PAY handoff; buyer signs locally.
  {
    const verdict = flow.decision;
    const settlement = flow.settlement;
    let status = "waiting";
    let tone: RailTone = "neutral";
    let done = false;
    let error = false;
    if (verdict === "pay") {
      if (settlement.status === "running") status = "verifying";
      else if (settlement.status === "error") {
        status = "error";
        tone = "block";
        error = true;
      } else if (settlement.status === "success") {
        status = "submitted";
        done = true;
      } else status = "buyer signs";
    } else if (verdict === "review") {
      status = "held";
      tone = "review";
    } else if (verdict === "block") {
      status = "denied";
      tone = "block";
    }
    raw.push({ key: "sign", label: "Sign", status, tone, done, error });
  }

  // SETTLEMENT — the four verdicts stay distinct.
  {
    const settlement = flow.settlement;
    const sv = flow.settlementVerdict;
    let status = "waiting";
    let tone: RailTone = "neutral";
    let done = false;
    let error = false;
    if (settlement.status === "running") status = "verifying";
    else if (settlement.status === "error") {
      status = "error";
      tone = "block";
      error = true;
    } else if (settlement.status === "success" && sv) {
      status = sv;
      done = true;
      tone = sv === "match" ? "pay" : sv === "mismatch" ? "block" : sv === "pending" ? "review" : "neutral";
    }
    raw.push({ key: "settlement", label: "Settle", status, tone, done, error });
  }

  // RESPONSE — recorded only after an exact settlement match.
  {
    const observation = flow.observation;
    const ready = flow.settlementVerdict === "match";
    let status = "waiting";
    let tone: RailTone = "neutral";
    let done = false;
    let error = false;
    if (observation.status === "running") status = "recording";
    else if (observation.status === "error") {
      status = "error";
      tone = "block";
      error = true;
    } else if (observation.status === "success") {
      status = "recorded";
      done = true;
    } else if (ready) status = "ready";
    raw.push({ key: "response", label: "Response", status, tone, done, error });
  }

  // RECEIPT — the anchor state is separate from the receipt request.
  {
    const receipt = flow.receipt;
    const anchor = flow.anchorState;
    let status = "waiting";
    let tone: RailTone = "neutral";
    let done = false;
    let error = false;
    if (receipt.status === "running") status = "recording";
    else if (receipt.status === "error") {
      status = "error";
      tone = "block";
      error = true;
    } else if (receipt.status === "success" && anchor) {
      status =
        anchor.status === "anchored"
          ? "recorded"
          : anchor.status === "off_chain_verified"
            ? "verified off chain"
            : anchor.status.replaceAll("_", " ");
      done = true;
      tone =
        anchor.status === "anchored"
          ? "pay"
          : anchor.status === "failed"
            ? "block"
            : anchor.status === "pending"
              ? "review"
              : "neutral";
    }
    raw.push({ key: "receipt", label: "Receipt", status, tone, done, error });
  }

  return raw;
}

function computeSteps(flow: AuditFlow, active: StepKey): RailStep[] {
  return computeRawSteps(flow).map((r) => {
    let state: RailState;
    if (r.error) state = "error";
    else if (r.key === active) state = "active";
    else if (r.done) state = "done";
    else state = "waiting";
    return { key: r.key, label: r.label, status: r.status, state, tone: r.tone };
  });
}

export default function ModernVariant({ flow, theme }: AuditVariantProps) {
  const active = activeStep(flow);
  const steps = computeSteps(flow, active);

  return (
    <div className="av-modern" data-variant="modern" data-theme={theme}>
      <div className="av-field" aria-hidden="true" />

      <div className="av-shell">
        {/* Left-aligned hero strip: heading left, one muted tagline right. */}
        <header className="av-hero">
          <div className="av-hero-lead">
            <p className="av-hero-kicker">AgentPay on Casper</p>
            <h1 className="av-hero-title">Payment checker</h1>
          </div>
          <p className="av-hero-tagline">
            Check the charge before signing. After payment, verify that the Casper transfer and
            service response match what was approved.
          </p>
        </header>

        {/* Segmented progress track: one flush bar of eight segments that fill
            as steps complete (verdict tones where earned), and a single text
            readout naming only the active step. Every segment still carries
            its honest label + status for hover and screen readers. */}
        <nav className="av-track" aria-label="Workflow progress">
          <ol className="av-track-bar">
            {steps.map((step) => (
              <li
                key={step.key}
                className="av-seg"
                data-state={step.state}
                data-tone={step.tone}
                aria-current={step.state === "active" ? "step" : undefined}
                title={`${step.label} · ${step.status}`}
              >
                <span className="av-sr">{`${step.label}: ${step.status}`}</span>
              </li>
            ))}
          </ol>
          <p className="av-track-read">
            <span className="av-track-active" data-tone={steps.find((s) => s.key === active)?.tone ?? "neutral"}>
              {steps.find((s) => s.key === active)?.label} · {steps.find((s) => s.key === active)?.status}
            </span>
            <span className="av-track-count">
              step {steps.findIndex((s) => s.key === active) + 1} of {steps.length}
            </span>
          </p>
        </nav>

        {/* THE DECISION — the hero. Mounts only once a check actually runs;
            before that the rail's honest "waiting" is the whole story. */}
        {flow.check.status !== "idle" ? <DecisionCard flow={flow} /> : null}

        {/* Only steps with something real to do or show get a card. Unreached
            steps live in the rail as honest "waiting" chips, not as furniture.
            Two columns on desktop keep the page short. */}
        <div className="av-column">
          {(() => {
            const captured = flow.probe.status === "success" && Boolean(flow.probe.data?.terms);
            const cards: Array<{ key: string; activeKey: StepKey; node: ReactNode }> = [];
            if (!flow.tokenPresent) cards.push({ key: "auth", activeKey: "auth", node: <TokenGate flow={flow} /> });
            cards.push({ key: "charge", activeKey: "charge", node: <ChargeTerms flow={flow} /> });
            if (captured || flow.check.status !== "idle") {
              cards.push({ key: "decision", activeKey: "decision", node: <DecisionPanel flow={flow} /> });
            }
            const reasonCodes = new Set(flow.check.data?.check.decision.reasons.map((reason) => reason.code) ?? []);
            const needsProviderRule = reasonCodes.has("provider_unapproved") || reasonCodes.has("provider_tuple_changed");
            const needsPaymentRules = reasonCodes.has("policy_cap_missing") || reasonCodes.has("policy_daily_cap_exceeded");
            if (needsProviderRule) {
              cards.push({ key: "provider-rule", activeKey: "operator", node: <OperatorAction flow={flow} /> });
            }
            if (needsPaymentRules) {
              cards.push({ key: "payment-rules", activeKey: "operator", node: <PolicyAction flow={flow} /> });
            }
            if (flow.decision === "pay") cards.push({ key: "sign", activeKey: "sign", node: <SigningHandoff flow={flow} /> });
            if (flow.settlement.status !== "idle") {
              cards.push({ key: "settlement", activeKey: "settlement", node: <SettlementVerdict flow={flow} /> });
            }
            if (flow.settlementVerdict === "match" || flow.observation.status !== "idle") {
              cards.push({ key: "response", activeKey: "response", node: <ResponseObservation flow={flow} /> });
            }
            if (flow.receipt.status !== "idle" || flow.observation.status === "success") {
              cards.push({ key: "receipt", activeKey: "receipt", node: <ReceiptView flow={flow} /> });
            }
            return cards.map((card, i) => (
              <StepCard key={card.key} index={i} active={active === card.activeKey}>
                {card.node}
              </StepCard>
            ));
          })()}
        </div>

        {/* The auth card collapses to one line once access is ready; the
            session control stays reachable without exposing its token. */}
        {flow.tokenPresent ? (
          <p className="av-token-strip">
            {flow.walletSession.status === "success"
              ? "Casper Wallet connected. Your session stays in this tab."
              : "AgentPay token active for this tab."}
            <button type="button" className="av-token-clear" onClick={() => flow.signOut()}>
              {flow.walletSession.status === "success" ? "End session" : "Clear token"}
            </button>
          </p>
        ) : null}

        <p className="av-footnote">
          AgentPay only shows checks, transfers, and Casper receipt records returned by the live services.
          Testnet activity is labelled.
        </p>
      </div>
    </div>
  );
}
