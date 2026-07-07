import {
  ArrowSquareOut,
  ArrowCounterClockwise,
  Moon,
  Plugs,
  PlugsConnected,
  Sun,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  type BridgeActivityEntry,
  bridgeUrl,
  callTool,
  type DecisionReceipt as DecisionReceiptData,
  type EvidenceFactValue,
  getBridgeActivity,
  getBridgeHealth,
  resolveToken,
  type PaidReport,
  type PaymentReadiness,
  type Quote,
  type RegistryStatus,
  ToolCallError,
  type Verification
} from "./api";
import { AgentPayDecisionReceipt } from "./components/AgentPayDecisionReceipt";
import { AgentPayPipelineRail, type EvidenceStep } from "./components/AgentPayPipelineRail";
import { AgentPayVerdictHero, type HeroMode } from "./components/AgentPayVerdictHero";
import { AgentPayCheckList } from "./components/AgentPayCheckList";
import { AgentPayLogo } from "./components/AgentPayLogo";
import { AgentPayProofPath } from "./components/AgentPayProofPath";
import {
  AgentPayAlert,
  AgentPayBadge,
  AgentPayButton,
  AgentPayIconAction,
  AgentPayCard,
  AgentPayCardHeader,
  AgentPayCodeBlock,
  AgentPayField,
  AgentPayFieldLabel,
  AgentPayInlineCode,
  AgentPaySeparator,
  AgentPaySheet,
  AgentPaySheetContent,
  AgentPaySheetDescription,
  AgentPaySheetHeader,
  AgentPaySheetTitle,
  AgentPaySurface,
  AgentPayTable,
  AgentPayTableBody,
  AgentPayTableCell,
  AgentPayTableHead,
  AgentPayTableHeader,
  AgentPayTableRow,
  AgentPayTabs,
  AgentPayTabsContent,
  AgentPayTabsList,
  AgentPayTabsTrigger,
  AgentPayTextarea,
  AgentPayTooltipProvider
} from "./components/AgentPayUi";
import IntegratePage from "./agents/IntegratePage";
import LandingDesk from "./landing/LandingDesk";
import { friendlyReason } from "./lib/friendly-errors";
import AskPage from "./trust/AskPage";
import CounterpartyPage from "./trust/CounterpartyPage";
import FeedPage from "./trust/FeedPage";
import { extractSignals } from "../../../packages/agent-pay-core/src/trust/signals";
import { extractAccountSignals } from "../../../packages/agent-pay-core/src/trust/accountSignals";
import { scoreSubject, type RuleResult, type WireDecision } from "../../../packages/agent-pay-core/src/trust/rules";
import { scoreAccount } from "../../../packages/agent-pay-core/src/trust/accountRules";
import "./styles.css";

type RunState = "idle" | "running" | "payment_required" | "complete" | "error";

// The exact buyer command from the repo README/scripts — shown at the 402 wall
// so the gate is a doorway, not a dead end.
const BUYER_CLI_COMMAND = `REPORT_API_URL=http://127.0.0.1:4021 \\
CASPER_SECRET_KEY_PATH=<your-agent-key.pem> \\
npm run x402:buy`;
type ThemeMode = "light" | "dark";

type TamperState = {
  field: string;
  original: EvidenceFactValue;
  mutated: EvidenceFactValue;
  verified: boolean;
};

// Routes own which page is visible; the shell owns cross-page state
// (theme + the console's evidence-run state, which survives navigation).
export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [state, setState] = useState<RunState>("idle");
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("agentpay-theme");
    if (stored === "light" || stored === "dark") return stored;
    // Intentional first impression: default light; a saved toggle still wins.
    return "light";
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [paidReport, setPaidReport] = useState<PaidReport | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [receipt, setReceipt] = useState<DecisionReceiptData | null>(null);
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus | null>(null);
  const [paymentPayloadText, setPaymentPayloadText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tamper, setTamper] = useState<TamperState | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("agentpay-theme", theme);

    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [theme]);

  useEffect(() => {
    // The app-wide living field reads these: stronger on /agents, breathing
    // through the hero scrim on the landing.
    document.documentElement.classList.toggle("route-agents", pathname === "/agents");
    document.documentElement.classList.toggle("route-landing", pathname === "/");
    // The trust pages float glass over a faint field, so the blur has something to refract.
    document.documentElement.classList.toggle(
      "route-trust",
      pathname === "/check" || pathname === "/counterparty" || pathname === "/feed"
    );
    return () => {
      document.documentElement.classList.remove("route-agents");
      document.documentElement.classList.remove("route-landing");
      document.documentElement.classList.remove("route-trust");
    };
  }, [pathname]);

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
        caption: "buys a live evidence set and commits a dataset root",
        value: quote ? `${quote.amount} ${quote.asset}` : "waiting",
        state: stepState(quoteDone, "quote"),
        kind: "quote"
      },
      {
        label: "Settle x402",
        caption: "settles the quoted fee through the facilitator",
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
        caption: "rebuilds the Merkle root from the evidence",
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

  const SUBJECT_HASH = /^(hash-)?[0-9a-f]{64}$/i;

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
      const quoted = await callTool<Quote>("quote_report", { subject });
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
      setError("Quote is required before payment settlement");
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
      throw new Error("Report proof did not match the dataset root");
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

  function reset() {
    clearFlowState();
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

  function restoreReport() {
    setTamper(null);
  }

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

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "light" ? "dark" : "light"));
  }

  return (
    <AgentPayTooltipProvider delayDuration={140}>
      <Routes>
        <Route
          path="/"
          element={
            <LandingRoute
              theme={theme}
              onToggleTheme={toggleTheme}
              onOpenApp={() => navigate("/app")}
              onOpenTrust={() => navigate("/check")}
              onOpenFeed={() => navigate("/feed")}
              onOpenAgents={() => navigate("/agents")}
              onOpenCounterparty={() => navigate("/counterparty")}
            />
          }
        />
        <Route
          path="/check"
          element={
            <main className="agent-pay-app" data-theme={theme}>
              <AskPage onBack={() => navigate("/")} onOpenFeed={() => navigate("/feed")} />
            </main>
          }
        />
        <Route
          path="/counterparty"
          element={
            <main className="agent-pay-app" data-theme={theme}>
              <CounterpartyPage onBack={() => navigate("/")} onOpenCheck={() => navigate("/check")} />
            </main>
          }
        />
        <Route
          path="/feed"
          element={
            <main className="agent-pay-app" data-theme={theme}>
              <FeedPage onBack={() => navigate("/")} onOpenAsk={() => navigate("/check")} />
            </main>
          }
        />
        <Route
          path="/agents"
          element={<IntegratePage onBack={() => navigate("/")} onOpenAsk={() => navigate("/check")} />}
        />
        <Route
          path="/app"
          element={
            <main className={`agent-pay-app agent-pay-workspace-view page-fog state-${state}`} data-theme={theme}>
              <div className="console-glass-frame glass-frame">
                <AgentPayAppHeader
                  state={state}
                  theme={theme}
                  onBack={() => navigate("/")}
                  onReset={reset}
                  onToggleTheme={toggleTheme}
                />
                <AgentPayConsole
                  error={error}
                  onChangePaymentPayload={setPaymentPayloadText}
                  onContinueSettlement={continueSettlement}
                  onRunAgentPay={runAgentPay}
                  paidReport={paidReport}
                  paymentPayloadText={paymentPayloadText}
                  quote={quote}
                  receipt={receipt}
                  registryStatus={registryStatus}
                  state={state}
                  timeline={timeline}
                  verification={verification}
                  tamper={tamper}
                  onTamper={tamperReport}
                  onRestore={restoreReport}
                />
              </div>
            </main>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AgentPayTooltipProvider>
  );
}

// The "/" landing.
function LandingRoute(props: {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenApp: () => void;
  onOpenTrust: () => void;
  onOpenFeed: () => void;
  onOpenAgents: () => void;
  onOpenCounterparty: () => void;
}) {
  return (
    <main className="agent-pay-app" data-theme={props.theme}>
      <LandingDesk
        theme={props.theme}
        onToggleTheme={props.onToggleTheme}
        onOpenApp={props.onOpenApp}
        onOpenTrust={props.onOpenTrust}
        onOpenFeed={props.onOpenFeed}
        onOpenAgents={props.onOpenAgents}
        onOpenCounterparty={props.onOpenCounterparty}
      />
    </main>
  );
}

function AgentPayAppHeader({
  state,
  theme,
  onBack,
  onReset,
  onToggleTheme
}: {
  state: RunState;
  theme: ThemeMode;
  onBack: () => void;
  onReset: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <AgentPayLogo className="brand-logo" />
        <div className="brand-copy">
          <span className="brand-name">AgentPay</span>
          <span className="brand-sub">Console</span>
        </div>
      </div>
      <div className="hero-nav-actions">
        <AgentPayButton variant="secondary" onClick={onBack}>
          Overview
        </AgentPayButton>
        <AgentPayBadge state={state}>
          {humanizeKey(state)}
        </AgentPayBadge>
        <AgentPayIconAction
          label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          onClick={onToggleTheme}
        >
          {theme === "light" ? <Moon size={17} weight="bold" aria-hidden="true" /> : <Sun size={17} weight="bold" aria-hidden="true" />}
        </AgentPayIconAction>
        <AgentPayIconAction label="Reset AgentPay" onClick={onReset}>
          <ArrowCounterClockwise size={17} weight="bold" aria-hidden="true" />
        </AgentPayIconAction>
      </div>
    </header>
  );
}

function verdictForPaidReport(paidReport: PaidReport): RuleResult {
  const evidenceRecords =
    paidReport.evidence && paidReport.evidence.length > 0
      ? paidReport.evidence.map((leaf) => leaf.record)
      : [paidReport.report];
  // Account evidence must be scored by the account policy, not the token one.
  const isAccount = evidenceRecords.some((r) => typeof r?.subject === "string" && r.subject.startsWith("account_"));
  return isAccount
    ? scoreAccount(extractAccountSignals(evidenceRecords))
    : scoreSubject(extractSignals(evidenceRecords));
}

function decisionForPaidReport(paidReport: PaidReport): WireDecision {
  return verdictForPaidReport(paidReport).decision;
}

// A worked-example verdict shown in the idle console so a first-time viewer
// sees what a real result looks like. Deliberately CAUTION (a mixed result):
// one caution flag, one check that could not run, two clean passes. Every line
// is real rule-engine copy, tagged "Sample run" in the UI so it is never
// mistaken for a live result.
const EXAMPLE_VERDICT: RuleResult = {
  aspect: "CAUTION",
  decision: "needs_review",
  flags: [{ code: "very_new_contract", severity: "caution", message: "Contract is very new." }],
  notChecked: ["holderCount"],
  passed: ["Mint authority is locked.", "Supply control is renounced."]
};

function AgentPayConsole({
  error,
  onChangePaymentPayload,
  onContinueSettlement,
  onRunAgentPay,
  paidReport,
  paymentPayloadText,
  quote,
  receipt,
  registryStatus,
  state,
  timeline,
  verification,
  tamper,
  onTamper,
  onRestore
}: {
  error: string | null;
  onChangePaymentPayload: (value: string) => void;
  onContinueSettlement: () => void;
  onRunAgentPay: (subjectInput: string) => void;
  paidReport: PaidReport | null;
  paymentPayloadText: string;
  quote: Quote | null;
  receipt: DecisionReceiptData | null;
  registryStatus: RegistryStatus | null;
  state: RunState;
  timeline: EvidenceStep[];
  verification: Verification | null;
  tamper: TamperState | null;
  onTamper: () => void;
  onRestore: () => void;
}) {
  const suggestedWorkspaceTab = receipt ? "registry" : paidReport ? "proof" : "evidence";
  const [workspaceTab, setWorkspaceTab] = useState(suggestedWorkspaceTab);
  const [paymentSheetDismissed, setPaymentSheetDismissed] = useState(false);
  const [subjectInput, setSubjectInput] = useState("");

  useEffect(() => {
    setWorkspaceTab(suggestedWorkspaceTab);
  }, [suggestedWorkspaceTab]);

  useEffect(() => {
    setPaymentSheetDismissed(false);
  }, [quote?.quoteId]);

  // A real verdict only once the proof actually verified against the quoted
  // root. An unverified paid report must never surface as a real verdict.
  // Otherwise the console teaches with the tagged sample, and at the common
  // local x402 wall it shows an honest blocked state.
  const verdict = useMemo(
    () => (paidReport && verification?.verified ? verdictForPaidReport(paidReport) : null),
    [paidReport, verification]
  );
  const heroMode: HeroMode = verdict ? "verdict" : state === "payment_required" ? "blocked" : "example";
  const heroVerdict = verdict ?? EXAMPLE_VERDICT;

  const activeStep = timeline.find((step) => step.state === "active");
  const primaryLabel =
    activeStep?.kind === "quote"
      ? "Quoting"
      : activeStep?.kind === "payment"
        ? "Settling x402 fee"
        : activeStep?.kind === "proof"
          ? "Verifying proof"
          : activeStep?.kind === "record"
            ? "Recording"
            : "Running";

  const reportSubject = paidReport?.report?.subject;
  const subjectLabel =
    typeof reportSubject === "string" && reportSubject.length > 0
      ? reportSubject.length > 24
        ? `${reportSubject.slice(0, 12)}…${reportSubject.slice(-6)}`
        : reportSubject
      : quote?.datasetId ?? "Live evidence set";
  const settlementHash = paidReport?.payment.transactionHash ?? null;
  const network = quote?.network ?? null;
  const networkLabel =
    network === "casper-testnet" ? "Casper Testnet" : network === "casper-mainnet" ? "Casper Mainnet" : network ?? "Casper";
  const summary = verdict
    ? [
        quote?.amount ? `Bought evidence for ${quote.amount} ${quote.asset ?? ""}`.trim() + "." : null,
        verification ? (verification.verified ? "The proof matched the quoted root." : "The proof did not match the quoted root.") : null,
        `Verdict: ${verdict.aspect}.`
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const canPay = state === "payment_required" && Boolean(quote) && (quote?.paymentRequirements.length ?? 0) > 0;
  const blockedNote = canPay
    ? "Settle the x402 fee to continue. Verify and record follow once payment lands."
    : "No signing key is configured here, so settle, verify, and record stay waiting.";

  return (
    <section id="agent-pay-app" className="agent-pay-console" aria-label="AgentPay app">
      <h1 className="agentpay-sr-only">AgentPay evidence desk</h1>
      <header className="console-header">
        <div className="console-heading">
          <h2>Evidence desk</h2>
          <p className="muted">
            Name a token. The desk buys live evidence, verifies the Merkle proof, and records one
            verdict on Casper: CLEAR, CAUTION, or DANGER.
          </p>
        </div>
        <ul className="console-stat-strip" aria-label="What the desk does">
          <li className="stat-tile"><span className="stat-k">Rail</span><span className="stat-v">4 stops</span></li>
          <li className="stat-tile"><span className="stat-k">Settlement</span><span className="stat-v">x402 on Casper</span></li>
          <li className="stat-tile"><span className="stat-k">Verdicts</span><span className="stat-v">CLEAR / CAUTION / DANGER</span></li>
        </ul>
      </header>

      {error ? <AgentPayAlert variant="error">{error}</AgentPayAlert> : null}

      <AgentPayVerdictHero
        mode={heroMode}
        verdict={heroVerdict}
        subjectLabel={subjectLabel}
        summary={summary}
        settlementHash={settlementHash}
        networkLabel={networkLabel}
        blockedNote={blockedNote}
        running={state === "running"}
        primaryLabel={primaryLabel}
        subjectInput={subjectInput}
        onChangeSubject={setSubjectInput}
        onRun={onRunAgentPay}
        onShowPayment={canPay ? () => setPaymentSheetDismissed(false) : undefined}
      />

      {state === "payment_required" && quote && quote.paymentRequirements.length > 0 && !paymentSheetDismissed ? (
        <AgentPayPaymentSheet
          paymentPayloadText={paymentPayloadText}
          quote={quote}
          onChangePaymentPayload={onChangePaymentPayload}
          onContinue={onContinueSettlement}
          onDismiss={() => setPaymentSheetDismissed(true)}
        />
      ) : null}

      <AgentPayPipelineRail steps={timeline} />

      <AgentPayBridgePanel />

      <section className="agent-pay-workspace">
        <AgentPayCard className="timeline-panel operation-card">
          <PanelHeader title="Evidence checks" sub="What the desk read, grouped by severity." />
          <AgentPaySeparator />
          {verdict ? (
            <AgentPayCheckList flags={verdict.flags} notChecked={verdict.notChecked} passed={verdict.passed} />
          ) : (
            <AgentPayEmptyState
              title={heroMode === "blocked" ? "Checks appear after the fee settles" : "Checks appear after a run"}
              body={
                heroMode === "blocked"
                  ? "This run stopped at the x402 wall. The desk scores the evidence once the fee lands and the Merkle proof verifies."
                  : "Your evidence checks show here after a live run, grouped by severity: flagged, not checked, passed."
              }
            />
          )}
        </AgentPayCard>

        <AgentPayTabs value={workspaceTab} onValueChange={setWorkspaceTab} className="workspace-tabs">
          <AgentPayCard className="workspace-panel">
            <div className="workspace-panel-top">
              <PanelHeader title="What we found" sub="Live sources, the proof they fold into, and the on-chain record." />
              <AgentPayTabsList aria-label="AgentPay workspace sections">
                <AgentPayTabsTrigger value="evidence">Evidence</AgentPayTabsTrigger>
                <AgentPayTabsTrigger value="proof">Proof</AgentPayTabsTrigger>
                <AgentPayTabsTrigger value="registry">Registry</AgentPayTabsTrigger>
              </AgentPayTabsList>
            </div>
            <AgentPaySeparator />

            <AgentPayTabsContent forceMount value="evidence">
              <div className="tab-panel-flow">
                {paidReport ? (
                  <>
                    <AgentPaySettlementEvidence payment={paidReport.payment} receiptHash={paidReport.paymentReceiptHash} />
                    <AgentPayEvidenceRecordView record={paidReport.report} />
                  </>
                ) : quote ? (
                  <>
                    <AgentPaySourceSummaryList quote={quote} />
                    <AgentPayPaymentReadiness readiness={quote.paymentReadiness} />
                  </>
                ) : (
                  <AgentPayEmptyState
                    title="Sources appear after a quote"
                    body="Run it live above to buy an evidence set. Each source folds into one dataset root."
                  />
                )}
              </div>
            </AgentPayTabsContent>

            <AgentPayTabsContent forceMount value="proof">
              <div className="tab-panel-flow">
                {paidReport ? (
                  <>
                    <AgentPayProofVerdict
                      quote={quote}
                      paidReport={paidReport}
                      verification={verification}
                      tamper={tamper}
                      onTamper={onTamper}
                      onRestore={onRestore}
                    />
                    <AgentPayProofPath proof={paidReport?.proof ?? []} />
                  </>
                ) : (
                  <AgentPayEmptyState
                    title="Proof appears after settlement"
                    body="Once the fee settles, the desk rebuilds the Merkle root from the evidence and shows the path here."
                  />
                )}
              </div>
            </AgentPayTabsContent>

            <AgentPayTabsContent forceMount value="registry">
              <div className="tab-panel-flow">
                <AgentPayRegistryReadiness status={registryStatus} />
                <AgentPayDecisionReceipt receipt={receipt} proofDepth={paidReport?.proof?.length} />
              </div>
            </AgentPayTabsContent>
          </AgentPayCard>
        </AgentPayTabs>
      </section>
    </section>
  );
}

function PanelHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <AgentPayCardHeader>
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
    </AgentPayCardHeader>
  );
}

function AgentPayEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="agent-pay-empty-state">
      <div className="empty-state-copy">
        <span className="strip-label">Nothing yet</span>
        <strong>{title}</strong>
        <p className="muted">{body}</p>
      </div>
    </div>
  );
}

/**
 * Live view of the bridge agents actually use. There is no in-browser
 * "connection": agents talk MCP (stdio) or the HTTP bridge, and this panel
 * observes that real traffic.
 */
function AgentPayBridgePanel() {
  const [bridgeLive, setBridgeLive] = useState<boolean | null>(null);
  const [activity, setActivity] = useState<BridgeActivityEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const [health, feed] = await Promise.all([
        getBridgeHealth(),
        getBridgeActivity().catch(() => null)
      ]);
      if (cancelled) return;
      setBridgeLive(health);
      if (feed) setActivity(feed.entries);
    }

    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <AgentPaySurface asChild variant="connection">
      <section aria-label="AgentPay agent bridge">
        <div className="connection-copy">
          <span className="connection-flag">
            {bridgeLive ? <PlugsConnected size={12} aria-hidden="true" /> : <Plugs size={12} aria-hidden="true" />}
            Agent bridge
          </span>
          <h2>Agents connect over MCP or HTTP</h2>
          <p className="muted">
            This console observes the same rail agents drive:{" "}
            <AgentPayInlineCode>POST {bridgeUrl}/tools/&lt;name&gt;</AgentPayInlineCode>
          </p>
          <span className={`bridge-state ${bridgeLive ? "is-live" : "is-down"}`}>
            {bridgeLive === null ? "checking bridge" : bridgeLive ? "bridge live" : "bridge unreachable"}
          </span>
        </div>
        <div className="bridge-activity" aria-label="Recent agent calls">
          {activity.length === 0 ? (
            <p className="muted">No agent calls yet this session.</p>
          ) : (
            <ul>
              {activity.slice(0, 5).map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={entry.status < 400 ? "is-ok" : "is-err"}>
                  <code>{entry.tool}</code>
                  <span>{entry.status}</span>
                  <span>{entry.ms}ms</span>
                  <time dateTime={entry.at}>{entry.at.slice(11, 19)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </AgentPaySurface>
  );
}

function AgentPayPaymentSheet({
  quote,
  paymentPayloadText,
  onChangePaymentPayload,
  onContinue,
  onDismiss
}: {
  quote: Quote;
  paymentPayloadText: string;
  onChangePaymentPayload: (value: string) => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const canAcceptPayment = quote.paymentRequirements.length > 0;
  const configReason = friendlyReason(quote.paymentReadiness.reason ?? quote.paymentConfigurationReason);

  return (
    <AgentPaySheet open modal={false} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <AgentPaySheetContent className="payment-sheet-drawer">
        <AgentPaySheetHeader className="payment-sheet-copy">
          <AgentPaySheetTitle>{canAcceptPayment ? "x402 payment required" : "Payment configuration required"}</AgentPaySheetTitle>
          <AgentPaySheetDescription>
          Quote <AgentPayInlineCode>{quote.quoteId}</AgentPayInlineCode>
          </AgentPaySheetDescription>
        </AgentPaySheetHeader>
        <AgentPaySeparator />
        {canAcceptPayment ? (
          <div className="payment-sheet-form">
            <div className="payment-sheet-howto">
              <p className="muted">
                This is where an agent's signed x402 payload goes. Generate one with the buyer CLI
                against this desk, then paste the payload it prints:
              </p>
              <AgentPayCodeBlock>{BUYER_CLI_COMMAND}</AgentPayCodeBlock>
              <a className="payment-sheet-docs-link" href="/agents">
                How agents connect (MCP + HTTP bridge)
              </a>
            </div>
            <AgentPayField className="payload-field">
              <AgentPayFieldLabel>x402 payment payload</AgentPayFieldLabel>
              <AgentPayTextarea
                aria-label="x402 payment payload"
                rows={6}
                spellCheck={false}
                value={paymentPayloadText}
                onChange={(event) => onChangePaymentPayload(event.target.value)}
              />
            </AgentPayField>
            <AgentPayButton variant="primary" onClick={onContinue}>
              Continue settlement
            </AgentPayButton>
          </div>
        ) : (
          <div className="payment-sheet-reason">
            <p className="muted">{configReason.headline}</p>
            {configReason.detail ? <AgentPayInlineCode>{configReason.detail}</AgentPayInlineCode> : null}
          </div>
        )}
      </AgentPaySheetContent>
    </AgentPaySheet>
  );
}

function AgentPayProofVerdict({
  quote,
  paidReport,
  verification,
  tamper,
  onTamper,
  onRestore
}: {
  quote: Quote | null;
  paidReport: PaidReport;
  verification: Verification | null;
  tamper: TamperState | null;
  onTamper: () => void;
  onRestore: () => void;
}) {
  const blockSource = quote?.sourceSummary.find((source) => source.subject === "latest_finalized_block");
  const blockHash = blockSource ? String(blockSource.facts.blockHash ?? "") : "";
  const blockHeight = blockSource ? blockSource.facts.height : null;
  const explorer = "https://testnet.cspr.live";
  const settlementHash = paidReport.payment.transactionHash;
  // x402 settlement is always a Casper TransactionV1, so it lives under /transaction on the explorer.
  const settlementPath = "transaction";
  const verified = tamper ? tamper.verified : Boolean(verification?.verified);

  return (
    <AgentPaySurface className={`proof-verdict ${verified ? "is-clear" : "is-danger"}`}>
      <div className="proof-verdict-head">
        <AgentPayBadge state={verified ? "complete" : "error"}>
          {verified ? "root match · verify true" : "root mismatch · verify false"}
        </AgentPayBadge>
        <p className="proof-verdict-note">
          {tamper
            ? "One fact changed, so the Merkle proof no longer reconstructs the quoted dataset root."
            : "Re-derived against the dataset root committed at quote time, on the live Casper chain."}
        </p>
      </div>

      <dl className="proof-anchors">
        {blockHash ? (
          <div>
            <dt>Quoted block</dt>
            <dd>
              <AgentPayButton asChild variant="explorer" size="compact">
                <a href={`${explorer}/block/${blockHash}`} target="_blank" rel="noreferrer">
                  #{formatFact(blockHeight)}
                  <ArrowSquareOut size={13} aria-hidden="true" />
                </a>
              </AgentPayButton>
              <code>{`${blockHash.slice(0, 18)}…`}</code>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Settlement</dt>
          <dd>
            <AgentPayButton asChild variant="explorer" size="compact">
              <a href={`${explorer}/${settlementPath}/${settlementHash}`} target="_blank" rel="noreferrer">
                cspr.live
                <ArrowSquareOut size={13} aria-hidden="true" />
              </a>
            </AgentPayButton>
            <code>{`${settlementHash.slice(0, 18)}…`}</code>
          </dd>
        </div>
      </dl>

      <div className="proof-verdict-actions">
        {tamper ? (
          <>
            <p className="proof-tamper-line">
              <span className="strip-label">tampered fact</span>
              <code>
                {humanizeKey(tamper.field)}: {formatFact(tamper.original)} → <b>{formatFact(tamper.mutated)}</b>
              </code>
            </p>
            <AgentPayButton variant="secondary" size="compact" onClick={onRestore}>
              Restore the real value
            </AgentPayButton>
          </>
        ) : (
          <AgentPayButton variant="ghost" size="compact" onClick={onTamper}>
            Tamper one fact
          </AgentPayButton>
        )}
      </div>
    </AgentPaySurface>
  );
}

function AgentPaySettlementEvidence({
  payment,
  receiptHash
}: {
  payment: PaidReport["payment"];
  receiptHash: string;
}) {
  return (
    <AgentPaySurface variant="readiness" state="ready">
      <div>
        <span className="strip-label">AgentPay settlement</span>
        <strong>{humanizeKey(payment.confirmation.executionState)}</strong>
        <p className="muted">{humanizeKey(payment.confirmation.method)}</p>
      </div>
      <AgentPayCodeBlock>{payment.transactionHash}</AgentPayCodeBlock>
      <AgentPayTable>
        <AgentPayTableHeader>
          <AgentPayTableRow>
            <AgentPayTableHead>Check</AgentPayTableHead>
            <AgentPayTableHead>Observation</AgentPayTableHead>
          </AgentPayTableRow>
        </AgentPayTableHeader>
        <AgentPayTableBody>
          <AgentPayTableRow>
            <AgentPayTableCell>rpc</AgentPayTableCell>
            <AgentPayTableCell>
              <span>{payment.confirmation.rpcUrl}</span>
              <AgentPayInlineCode>{payment.confirmation.blockHash ? payment.confirmation.blockHash : "pending"}</AgentPayInlineCode>
            </AgentPayTableCell>
          </AgentPayTableRow>
          <AgentPayTableRow>
            <AgentPayTableCell>receipt</AgentPayTableCell>
            <AgentPayTableCell>
              <span>{payment.facilitatorHash}</span>
              <AgentPayInlineCode>{receiptHash}</AgentPayInlineCode>
            </AgentPayTableCell>
          </AgentPayTableRow>
        </AgentPayTableBody>
      </AgentPayTable>
    </AgentPaySurface>
  );
}

function AgentPaySourceSummaryList({ quote }: { quote: Quote }) {
  return (
    <div className="source-list">
      {quote.sourceSummary.map((source) => (
        <AgentPaySurface asChild variant="source" key={source.recordHash}>
          <article>
          <div>
            <strong>{source.product}</strong>
            <span>
              {source.network} / {source.subject}
            </span>
          </div>
          <AgentPayTable>
            <AgentPayTableBody>
            {Object.entries(source.facts)
              .slice(0, 3)
              .map(([key, value]) => (
                <AgentPayTableRow key={key}>
                  <AgentPayTableCell>{humanizeKey(key)}</AgentPayTableCell>
                  <AgentPayTableCell>{formatFact(value)}</AgentPayTableCell>
                </AgentPayTableRow>
              ))}
            </AgentPayTableBody>
          </AgentPayTable>
          </article>
        </AgentPaySurface>
      ))}
    </div>
  );
}

function AgentPayEvidenceRecordView({ record }: { record: PaidReport["report"] }) {
  return (
    <AgentPaySurface variant="record">
      <div>
        <span className="strip-label">{record.network}</span>
        <strong>{record.product}</strong>
        <p className="muted">{record.subject}</p>
      </div>
      <AgentPayTable className="metrics">
        <AgentPayTableBody>
        {Object.entries(record.facts).map(([key, value]) => (
          <AgentPayTableRow key={key}>
            <AgentPayTableCell>{humanizeKey(key)}</AgentPayTableCell>
            <AgentPayTableCell>{formatFact(value)}</AgentPayTableCell>
          </AgentPayTableRow>
        ))}
        </AgentPayTableBody>
      </AgentPayTable>
      <AgentPayCodeBlock>{record.rawHash}</AgentPayCodeBlock>
    </AgentPaySurface>
  );
}

function AgentPayPaymentReadiness({ readiness }: { readiness: PaymentReadiness }) {
  return (
    <AgentPaySurface variant="readiness" state={readiness.status}>
      <div>
        <span className="strip-label">AgentPay settlement</span>
        <strong>{humanizeKey(readiness.status)}</strong>
        <p className="muted">
          {readiness.reason ? friendlyReason(readiness.reason).headline : readiness.supportedKind ? readiness.supportedKind.network : readiness.facilitatorUrl}
        </p>
      </div>
      <AgentPayTable>
        <AgentPayTableHeader>
          <AgentPayTableRow>
            <AgentPayTableHead>Status</AgentPayTableHead>
            <AgentPayTableHead>Check</AgentPayTableHead>
          </AgentPayTableRow>
        </AgentPayTableHeader>
        <AgentPayTableBody>
        {readiness.checks.map((check) => (
          <AgentPayTableRow key={check.name}>
            <AgentPayTableCell>{check.status}</AgentPayTableCell>
            <AgentPayTableCell>
              <span>{humanizeKey(check.name)}</span>
              <AgentPayInlineCode>{check.message}</AgentPayInlineCode>
            </AgentPayTableCell>
          </AgentPayTableRow>
        ))}
        </AgentPayTableBody>
      </AgentPayTable>
    </AgentPaySurface>
  );
}

function AgentPayRegistryReadiness({ status }: { status: RegistryStatus | null }) {
  if (!status) {
    return <p className="muted">AgentPay registry readiness appears after a quote is requested.</p>;
  }

  return (
    <AgentPaySurface variant="readiness" state={status.status}>
      <div>
        <span className="strip-label">AgentPay registry</span>
        <strong>{humanizeKey(status.status)}</strong>
        <p className="muted">{status.reason ? friendlyReason(status.reason).headline : status.rpc?.chainspecName ?? status.recordScript}</p>
      </div>
      <AgentPayTable>
        <AgentPayTableHeader>
          <AgentPayTableRow>
            <AgentPayTableHead>Status</AgentPayTableHead>
            <AgentPayTableHead>Registry check</AgentPayTableHead>
          </AgentPayTableRow>
        </AgentPayTableHeader>
        <AgentPayTableBody>
        {status.checks.map((check) => (
          <AgentPayTableRow key={check.name}>
            <AgentPayTableCell>{check.status}</AgentPayTableCell>
            <AgentPayTableCell>
              <span>{humanizeKey(check.name)}</span>
              <AgentPayInlineCode>{check.message}</AgentPayInlineCode>
            </AgentPayTableCell>
          </AgentPayTableRow>
        ))}
        </AgentPayTableBody>
      </AgentPayTable>
    </AgentPaySurface>
  );
}

function humanizeKey(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

function formatFact(value: EvidenceFactValue) {
  if (value === null) {
    return "n/a";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toString();
  }
  return String(value);
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
