import { useMemo, useState } from "react";
import {
  callTool as defaultCallTool,
  resolveToken as defaultResolveToken,
  type DecisionReceipt as DecisionReceiptData,
  type EvidenceFactValue,
  type EvidenceNetwork,
  type PaidReport,
  type Quote,
  type RegistryStatus,
  type ResolvedToken,
  ToolCallError,
  type Verification
} from "../api";
import type { EvidenceStep } from "../components/AgentPayPipelineRail";
import { friendlyReason } from "../lib/friendly-errors";
import { decisionForPaidReport } from "./evidenceVerdict";

export type RunState = "idle" | "running" | "payment_required" | "complete" | "error";

export type TamperState = {
  field: string;
  original: EvidenceFactValue;
  mutated: EvidenceFactValue;
  verified: boolean;
};

// The console evidence-run rail — quote → settle x402 → verify proof → record —
// as one testable module instead of loose async methods on the React shell.
// callTool and resolveToken are injectable so the whole sequence (including
// "verify fails → throw", the 402 gate, and reset) can be unit-tested without a
// DOM or a real network.
export type EvidenceRunDeps = {
  callTool: typeof defaultCallTool;
  resolveToken: typeof defaultResolveToken;
};

// Token package hashes (hash-…), Casper accounts (account-hash-…), and bare
// 64-hex all go straight to the quote; only free-text symbols get resolved.
const SUBJECT_HASH = /^((account-)?hash-)?[0-9a-f]{64}$/i;

export type EvidenceRun = {
  state: RunState;
  error: string | null;
  quote: Quote | null;
  paidReport: PaidReport | null;
  verification: Verification | null;
  receipt: DecisionReceiptData | null;
  registryStatus: RegistryStatus | null;
  evidenceNetwork: EvidenceNetwork;
  paymentPayloadText: string;
  tamper: TamperState | null;
  timeline: EvidenceStep[];
  setEvidenceNetwork: (network: EvidenceNetwork) => void;
  setPaymentPayloadText: (value: string) => void;
  runAgentPay: (rawSubject?: string) => Promise<void>;
  continueSettlement: () => Promise<void>;
  reset: () => void;
  tamperReport: () => Promise<void>;
  restoreReport: () => void;
};

export function useEvidenceRun(deps: Partial<EvidenceRunDeps> = {}): EvidenceRun {
  const callTool = deps.callTool ?? defaultCallTool;
  const resolveToken = deps.resolveToken ?? defaultResolveToken;

  const [state, setState] = useState<RunState>("idle");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [paidReport, setPaidReport] = useState<PaidReport | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [receipt, setReceipt] = useState<DecisionReceiptData | null>(null);
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus | null>(null);
  const [evidenceNetwork, setEvidenceNetwork] = useState<EvidenceNetwork>("casper-mainnet");
  const [paymentPayloadText, setPaymentPayloadText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tamper, setTamper] = useState<TamperState | null>(null);

  const timeline = useMemo<EvidenceStep[]>(() => {
    const quoteDone = Boolean(quote);
    const payDone = Boolean(paidReport);
    const proofDone = Boolean(verification?.verified);
    const recordDone = Boolean(receipt);
    const running = state === "running";
    // The first not-done stop is the one currently executing while running.
    const activeKind = !quoteDone ? "quote" : !payDone ? "payment" : !proofDone ? "proof" : !recordDone ? "record" : null;
    const stepState = (done: boolean, kind: string): EvidenceStep["state"] =>
      done ? "done" : running && activeKind === kind ? "active" : "waiting";

    return [
      {
        label: "Quote",
        caption: "prices a live evidence check and commits its fingerprint",
        value: quote ? `${quote.amountDisplay || quote.amount} ${quote.asset}` : "waiting",
        state: stepState(quoteDone, "quote"),
        kind: "quote"
      },
      {
        label: "Settle x402",
        caption: "submits the buyer's signed payment through the facilitator",
        value: paidReport
          ? "settled"
          : state === "payment_required"
            ? "payment required"
            : "waiting",
        // The most common local path: blocked at the x402 wall with no key.
        state: payDone ? "done" : state === "payment_required" ? "blocked" : stepState(false, "payment"),
        kind: "payment"
      },
      {
        label: "Verify proof",
        caption: "checks the evidence against its quoted fingerprint",
        // A failed verification is a real, honest state, not "waiting".
        value: proofDone ? "root match" : verification && !verification.verified ? "proof failed" : "waiting",
        state: proofDone ? "done" : verification && !verification.verified ? "blocked" : stepState(false, "proof"),
        kind: "proof"
      },
      {
        label: "Record",
        caption: "writes the decision to the AgentPay registry",
        value: receipt ? "recorded" : "waiting",
        state: stepState(recordDone, "record"),
        kind: "record"
      }
    ];
  }, [paidReport, quote, receipt, state, verification]);

  function clearFlowState() {
    setState("idle");
    setQuote(null);
    setPaidReport(null);
    setVerification(null);
    setReceipt(null);
    setRegistryStatus(null);
    setPaymentPayloadText("");
    setError(null);
    setTamper(null);
  }

  async function settleQuote(activeQuote: Quote, paymentPayload?: unknown) {
    const paid = await callTool<PaidReport>("buy_report", {
      quoteId: activeQuote.quoteId,
      ...(paymentPayload === undefined ? {} : { paymentPayload })
    });
    setPaidReport(paid);

    const verified = await callTool<Verification>("verify_report", {
      record: paid.report,
      proof: paid.proof,
      datasetRoot: paid.datasetRoot
    });
    setVerification(verified);

    if (!verified.verified) {
      throw new Error("The returned evidence did not match the quoted evidence fingerprint");
    }

    const decision = decisionForPaidReport(paid);
    const recorded = await callTool<DecisionReceiptData>("record_decision", {
      datasetId: paid.datasetId,
      datasetRoot: paid.datasetRoot,
      reportHash: paid.reportHash,
      paymentReceiptHash: paid.paymentReceiptHash,
      decision
    });
    setReceipt(recorded);
    setState("complete");
  }

  async function runAgentPay(rawSubject = "") {
    clearFlowState();

    const trimmed = rawSubject.trim();
    if (!trimmed) {
      setState("error");
      setError("Enter a token package hash or a Casper account to check.");
      return;
    }

    setState("running");

    let subject: string;
    let selectedNetwork = evidenceNetwork;
    if (SUBJECT_HASH.test(trimmed)) {
      subject = trimmed;
    } else {
      // A service outage must not read as "not listed": only a resolved null
      // (looked up, genuinely absent) shows the not-listed copy.
      try {
        const token = await resolveToken(trimmed);
        if (!token) {
          setState("error");
          setError(`"${trimmed}" isn't listed on CSPR.trade. Paste the token's package hash to quote it.`);
          return;
        }
        subject = token.packageHash;
        selectedNetwork = token.network;
        setEvidenceNetwork(token.network);
      } catch (lookupError) {
        setState("error");
        setError(
          lookupError instanceof Error
            ? friendlyReason(lookupError.message).headline
            : "Token lookup failed. Try again in a moment."
        );
        return;
      }
    }

    try {
      const quoted = await callTool<Quote>("quote_report", {
        subject,
        evidenceNetwork: selectedNetwork
      });
      setQuote(quoted);
      const registry = await callTool<RegistryStatus>("registry_status", {});
      setRegistryStatus(registry);

      await settleQuote(quoted);
    } catch (runError) {
      if (runError instanceof ToolCallError && runError.status === 402) {
        setState("payment_required");
        return;
      }
      setState("error");
      setError(runError instanceof Error ? friendlyReason(runError.message).headline : "Audit failed");
    }
  }

  async function continueSettlement() {
    if (!quote) {
      setState("error");
      setError("Run a check before continuing to payment.");
      return;
    }

    setState("running");
    setError(null);

    try {
      const paymentPayload = parsePaymentPayload(paymentPayloadText);
      await settleQuote(quote, paymentPayload);
    } catch (runError) {
      if (runError instanceof ToolCallError && runError.status === 402) {
        setState("payment_required");
        setError(friendlyReason(runError.message).headline);
        return;
      }
      setState("error");
      setError(runError instanceof Error ? friendlyReason(runError.message).headline : "Settlement failed");
    }
  }

  async function tamperReport() {
    if (!paidReport) {
      return;
    }
    const entries = Object.entries(paidReport.report.facts);
    const target =
      entries.find(([key]) => /reserve/i.test(key)) ??
      entries.find(([, value]) => typeof value === "number") ??
      entries[0];
    if (!target) {
      return;
    }
    const [field, original] = target;
    const mutated: EvidenceFactValue =
      typeof original === "number" ? original + 1 : typeof original === "string" ? `${original}0` : original;
    const mutatedRecord = {
      ...paidReport.report,
      facts: { ...paidReport.report.facts, [field]: mutated }
    };
    try {
      const result = await callTool<Verification>("verify_report", {
        record: mutatedRecord,
        proof: paidReport.proof,
        datasetRoot: paidReport.datasetRoot
      });
      setTamper({ field, original, mutated, verified: result.verified });
    } catch {
      // A changed fact cannot reconstruct the committed root; show the rejection locally.
      setTamper({ field, original, mutated, verified: false });
    }
  }

  return {
    state,
    error,
    quote,
    paidReport,
    verification,
    receipt,
    registryStatus,
    evidenceNetwork,
    paymentPayloadText,
    tamper,
    timeline,
    setEvidenceNetwork,
    setPaymentPayloadText,
    runAgentPay,
    continueSettlement,
    reset: clearFlowState,
    tamperReport,
    restoreReport: () => setTamper(null)
  };
}

function parsePaymentPayload(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("x402 payment payload is required");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("That payment payload isn't valid JSON. Paste the exact payload the buyer CLI printed.");
  }
}
