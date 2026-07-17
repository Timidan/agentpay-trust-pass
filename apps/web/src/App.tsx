import {
  ArrowSquareOut,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  type BridgeActivityEntry,
  bridgeUrl,
  callTool,
  type DecisionReceipt as DecisionReceiptData,
  type EvidenceFactValue,
  type EvidenceNetwork,
  getBridgeActivity,
  getBridgeHealth,
  reportApiOrigin,
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
import {
  AgentPayEvidenceNetworkSelector,
  AgentPayVerdictHero,
  type HeroMode
} from "./components/AgentPayVerdictHero";
import { AgentPayCheckList } from "./components/AgentPayCheckList";
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
import AuditPage from "./audit/AuditPage";
import { SiteFooter, SiteNav } from "./components/SiteChrome";
import Landing2 from "./landing2/Landing";
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
const BUYER_CLI_COMMAND = `REPORT_API_URL=${reportApiOrigin} \\
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
  const [evidenceNetwork, setEvidenceNetwork] = useState<EvidenceNetwork>("casper-mainnet");
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

  // Token package hashes (hash-…), Casper accounts (account-hash-…), and bare
  // 64-hex all go straight to the quote; only free-text symbols get resolved.
  const SUBJECT_HASH = /^((account-)?hash-)?[0-9a-f]{64}$/i;

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
              onOpenAudit={() => navigate("/audit")}
            />
          }
        />
        <Route
          path="/check"
          element={
            <main className="agent-pay-app" data-theme={theme}>
              <AskPage navigate={navigate} theme={theme} onToggleTheme={toggleTheme} />
            </main>
          }
        />
        <Route
          path="/counterparty"
          element={
            <main className="agent-pay-app" data-theme={theme}>
              <CounterpartyPage navigate={navigate} theme={theme} onToggleTheme={toggleTheme} />
            </main>
          }
        />
        <Route
          path="/feed"
          element={
            <main className="agent-pay-app" data-theme={theme}>
              <FeedPage navigate={navigate} theme={theme} onToggleTheme={toggleTheme} />
            </main>
          }
        />
        <Route
          path="/agents"
          element={<IntegratePage onBack={() => navigate("/")} onOpenAsk={() => navigate("/check")} navigate={navigate} theme={theme} onToggleTheme={toggleTheme} />}
        />
        <Route
          path="/audit"
          element={
            <main className="agent-pay-app" data-theme={theme}>
              <AuditPage theme={theme} navigate={navigate} onToggleTheme={toggleTheme} />
            </main>
          }
        />
        <Route
          path="/app"
          element={
            <main className={`agent-pay-app agent-pay-workspace-view console-v2 state-${state}`} data-theme={theme}>
              <AgentPayAppHeader
                state={state}
                theme={theme}
                onNav={navigate}
                onReset={reset}
                onToggleTheme={toggleTheme}
              />
              <div className="console-shell">
                <AgentPayConsole
                  error={error}
                  evidenceNetwork={evidenceNetwork}
                  onChangePaymentPayload={setPaymentPayloadText}
                  onChangeEvidenceNetwork={setEvidenceNetwork}
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
              <SiteFooter current="app" navigate={navigate} />
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
  onOpenAudit: () => void;
}) {
  return (
    <div className="agent-pay-app" data-theme={props.theme}>
      <Landing2
        theme={props.theme}
        onToggleTheme={props.onToggleTheme}
        onOpenApp={props.onOpenApp}
        onOpenTrust={props.onOpenTrust}
        onOpenFeed={props.onOpenFeed}
        onOpenAgents={props.onOpenAgents}
        onOpenCounterparty={props.onOpenCounterparty}
        onOpenAudit={props.onOpenAudit}
      />
    </div>
  );
}

function AgentPayAppHeader({
  state,
  theme,
  onNav,
  onReset,
  onToggleTheme
}: {
  state: RunState;
  theme: ThemeMode;
  onNav: (path: string) => void;
  onReset: () => void;
  onToggleTheme: () => void;
}) {
  // The console shares the site nav so its links, brand, and toggle match every
  // other page; the reset control and run-state badge ride the actions slot.
  return (
    <SiteNav
      current="app"
      sub="Console"
      navigate={onNav}
      theme={theme}
      onToggleTheme={onToggleTheme}
      actions={
        <>
          {state !== "idle" ? (
            <AgentPayBadge state={state}>{humanizeKey(state)}</AgentPayBadge>
          ) : null}
          <AgentPayIconAction label="Reset AgentPay" onClick={onReset}>
            <ArrowCounterClockwise size={17} weight="bold" aria-hidden="true" />
          </AgentPayIconAction>
        </>
      }
    />
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

function AgentPayConsole({
  error,
  evidenceNetwork,
  onChangePaymentPayload,
  onChangeEvidenceNetwork,
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
  evidenceNetwork: EvidenceNetwork;
  onChangePaymentPayload: (value: string) => void;
  onChangeEvidenceNetwork: (value: EvidenceNetwork) => void;
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

  // A real verdict appears only after the proof verifies against the quoted
  // root. An unverified paid report must never surface as a result.
  const verdict = useMemo(
    () => (paidReport && verification?.verified ? verdictForPaidReport(paidReport) : null),
    [paidReport, verification]
  );
  const heroMode: HeroMode | null = verdict
    ? "verdict"
    : state === "payment_required"
      ? "blocked"
      : null;

  const activeStep = timeline.find((step) => step.state === "active");
  const primaryLabel =
    activeStep?.kind === "quote"
      ? "Quoting"
      : activeStep?.kind === "payment"
        ? "Settling x402 fee"
      : activeStep?.kind === "proof"
          ? "Checking evidence"
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
  const network = paidReport?.evidenceNetwork ?? quote?.evidenceNetwork ?? null;
  const networkLabel =
    network === "casper-testnet" ? "Casper Testnet" : network === "casper-mainnet" ? "Casper Mainnet" : network ?? "Casper";
  const summary = verdict
    ? [
        quote?.amount ? `Bought evidence for ${quote.amountDisplay || quote.amount} ${quote.asset ?? ""}`.trim() + "." : null,
        verification
          ? verification.verified
            ? "The evidence matched the quoted fingerprint."
            : "The evidence did not match the quoted fingerprint."
          : null,
        `Verdict: ${verdict.aspect}.`
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const canPay = state === "payment_required" && Boolean(quote) && (quote?.paymentRequirements.length ?? 0) > 0;
  const blockedNote = canPay
    ? "This browser does not hold a buyer key. Sign with the buyer CLI, then paste its payment payload to continue."
    : "Payment is not configured, so verification and the receipt cannot continue.";

  return (
    <section id="agent-pay-app" className="agent-pay-console" aria-label="AgentPay app">
      <h1 className="agentpay-sr-only">AgentPay evidence console</h1>
      <header className="console-header">
        <div className="console-heading">
          <h2>Evidence console</h2>
          <p className="muted">
            Enter a token package hash or Casper account to quote a live evidence check. The buyer
            signs and pays the Testnet fee before AgentPay verifies the evidence and records the result.
          </p>
        </div>
      </header>

      {error ? <AgentPayAlert variant="error">{error}</AgentPayAlert> : null}

      {heroMode === null ? (
        /* Idle: just the run input. The verdict surface appears only when
           there is a real verdict or a real blocked state to show. */
        <AgentPaySurface className="console-run">
          <div className="hero-run">
            <AgentPayEvidenceNetworkSelector
              disabled={state === "running"}
              onChange={onChangeEvidenceNetwork}
              value={evidenceNetwork}
            />
            <input
              aria-label="Token package hash or Casper account to check"
              className="hero-run-input"
              placeholder="Token package hash or account (account-hash-…)"
              spellCheck={false}
              value={subjectInput}
              onChange={(event) => setSubjectInput(event.target.value)}
            />
            <AgentPayButton
              variant="primary"
              disabled={state === "running" || subjectInput.trim().length === 0}
              onClick={() => onRunAgentPay(subjectInput)}
            >
              {state === "running" ? primaryLabel : "Run live check"}
            </AgentPayButton>
          </div>
        </AgentPaySurface>
      ) : (
        <AgentPayVerdictHero
          mode={heroMode}
          verdict={verdict ?? undefined}
          subjectLabel={subjectLabel}
          summary={summary}
          settlementHash={settlementHash}
          networkLabel={networkLabel}
          blockedNote={blockedNote}
          running={state === "running"}
          primaryLabel={primaryLabel}
          subjectInput={subjectInput}
          evidenceNetwork={evidenceNetwork}
          onChangeSubject={setSubjectInput}
          onChangeEvidenceNetwork={onChangeEvidenceNetwork}
          onRun={onRunAgentPay}
          onShowPayment={canPay ? () => setPaymentSheetDismissed(false) : undefined}
        />
      )}

      {state === "payment_required" && quote && quote.paymentRequirements.length > 0 && !paymentSheetDismissed ? (
        <AgentPayPaymentSheet
          paymentPayloadText={paymentPayloadText}
          quote={quote}
          onChangePaymentPayload={onChangePaymentPayload}
          onContinue={onContinueSettlement}
          onDismiss={() => setPaymentSheetDismissed(true)}
        />
      ) : null}

      {/* The rail and workspace exist only once a run does; the idle screen
          is the input and nothing else. */}
      {state !== "idle" ? <AgentPayPipelineRail steps={timeline} /> : null}

      <AgentPayBridgePanel />

      {state !== "idle" || quote || receipt ? (
      <section className="agent-pay-workspace">
        <AgentPayCard className="timeline-panel operation-card">
          <PanelHeader title="Evidence checks" sub="What AgentPay read, grouped by severity." />
          <AgentPaySeparator />
          {verdict ? (
            <AgentPayCheckList
              flags={verdict.flags}
              notChecked={verdict.notChecked}
              passed={verdict.passed}
              notCheckedNote={
                verdict.notChecked.length > 0
                  ? "Some required facts were unavailable from the selected network and configured evidence sources."
                  : undefined
              }
            />
          ) : (
            <AgentPayEmptyState
              title={heroMode === "blocked" ? "Checks appear after the fee settles" : "Checks appear after a run"}
              body={
                heroMode === "blocked"
                  ? "Pay the x402 fee to continue. AgentPay will check the evidence and save the result after payment confirms."
                  : "Your evidence checks show here after a live run, grouped by severity: flagged, not checked, passed."
              }
            />
          )}
        </AgentPayCard>

        <AgentPayTabs value={workspaceTab} onValueChange={setWorkspaceTab} className="workspace-tabs">
          <AgentPayCard className="workspace-panel">
            <div className="workspace-panel-top">
              <PanelHeader title="What we found" sub="Live sources, how AgentPay verifies them, and the Casper record." />
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
                    body="Run a live check above to load the evidence sources. Each source contributes to one evidence fingerprint."
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
                    body="After the fee is paid, AgentPay verifies that every evidence item belongs to the quoted set and shows the verification path here."
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
      ) : null}
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

  // One status line, not a panel: the integration story lives on /agents.
  return (
    <section className="bridge-strip" aria-label="AgentPay agent bridge">
      <span className="connection-flag">Agent bridge</span>
      <span className={`bridge-state ${bridgeLive ? "is-live" : "is-down"}`}>
        {bridgeLive === null ? "checking bridge" : bridgeLive ? "bridge live" : "bridge unreachable"}
      </span>
      <AgentPayInlineCode>POST {bridgeUrl}/tools/&lt;name&gt;</AgentPayInlineCode>
      {activity.slice(0, 2).map((entry, index) => (
        <span className="bridge-last" key={`${entry.at}-${index}`}>
          <code>{entry.tool}</code> <span>{entry.status}</span> · {entry.ms}ms
        </span>
      ))}
    </section>
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
  const requirement = quote.paymentRequirements[0];

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
            {requirement ? (
              <dl className="payment-sheet-terms" aria-label="x402 payment terms">
                <div>
                  <dt>Price</dt>
                  <dd>
                    <strong>{quote.amountDisplay || quote.amount} {requirement.extra.symbol || quote.asset}</strong>
                    <small>{quote.amount} base units</small>
                  </dd>
                </div>
                <div>
                  <dt>Token contract</dt>
                  <dd><code>{quote.assetPackageHash || requirement.asset}</code></dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd><code>{requirement.payTo}</code></dd>
                </div>
                <div>
                  <dt>Payment network</dt>
                  <dd><code>{requirement.network}</code></dd>
                </div>
              </dl>
            ) : null}
            <div className="payment-sheet-howto">
              <p className="muted">Buyer CLI</p>
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
              Continue with signed payment
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
          {verified ? "Evidence matches quote" : "Evidence changed"}
        </AgentPayBadge>
        <p className="proof-verdict-note">
          {tamper
            ? "One fact changed, so the evidence no longer matches the quoted fingerprint."
            : "Checked against the evidence fingerprint committed at quote time on the live Casper chain."}
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
          {readiness.reason
            ? friendlyReason(readiness.reason).headline
            : readiness.supportedKind
              ? readiness.supportedKind.network
              : "Payment service status checked."}
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
    return <p className="muted">The Casper registry status appears after a quote is requested.</p>;
  }

  return (
    <AgentPaySurface variant="readiness" state={status.status}>
      <div>
        <span className="strip-label">AgentPay registry</span>
        <strong>{humanizeKey(status.status)}</strong>
        <p className="muted">
          {status.reason ? friendlyReason(status.reason).headline : status.rpc?.chainspecName ?? "Casper registry checked"}
        </p>
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
