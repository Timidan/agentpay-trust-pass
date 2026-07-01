import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  ArrowSquareOut,
  ArrowCounterClockwise,
  ArrowsDownUp,
  Moon,
  Play,
  Plugs,
  PlugsConnected,
  ShareNetwork,
  ShieldCheck,
  Sun,
} from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  callTool,
  type DecisionReceipt as DecisionReceiptData,
  type EvidenceFactValue,
  type PaidReport,
  type PaymentReadiness,
  type Quote,
  type RegistryStatus,
  ToolCallError,
  type Verification
} from "./api";
import { AgentPayDecisionReceipt } from "./components/AgentPayDecisionReceipt";
import { AgentPayEvidenceTimeline, type EvidenceStep } from "./components/AgentPayEvidenceTimeline";
import { AgentPayLogo } from "./components/AgentPayLogo";
import { AgentPayProofPath } from "./components/AgentPayProofPath";
import {
  AgentPayAlert,
  AgentPayBadge,
  AgentPayButton,
  AgentPayIconAction,
  AgentPayCard,
  AgentPayCardHeader,
  AgentPayCardIcon,
  AgentPayCodeBlock,
  AgentPayDataList,
  AgentPayDataRow,
  AgentPayField,
  AgentPayFieldLabel,
  AgentPayInput,
  AgentPayInlineCode,
  AgentPaySeparator,
  AgentPaySheet,
  AgentPaySheetContent,
  AgentPaySheetDescription,
  AgentPaySheetHeader,
  AgentPaySheetTitle,
  AgentPaySkeleton,
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
  AgentPayTooltip,
  AgentPayTooltipContent,
  AgentPayTooltipProvider,
  AgentPayTooltipTrigger
} from "./components/AgentPayUi";
import IntegratePage from "./agents/IntegratePage";
import LandingDesk from "./landing/LandingDesk";
import AskPage from "./trust/AskPage";
import FeedPage from "./trust/FeedPage";
import { extractSignals } from "../../../packages/agent-pay-core/src/trust/signals";
import { scoreSubject, type WireDecision } from "../../../packages/agent-pay-core/src/trust/rules";
import "./styles.css";

gsap.registerPlugin(useGSAP);

type RunState = "idle" | "running" | "payment_required" | "complete" | "error";
type ThemeMode = "light" | "dark";

type AgentConnectionState =
  | { status: "disconnected" }
  | { status: "connected"; label: string; localOnly: true };

type TamperState = {
  field: string;
  original: EvidenceFactValue;
  mutated: EvidenceFactValue;
  verified: boolean;
};

export default function App() {
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
  const [agentConnection, setAgentConnection] = useState<AgentConnectionState>({ status: "disconnected" });
  const [lastAgentLabel, setLastAgentLabel] = useState<string | null>(null);
  const [appOpen, setAppOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.location.pathname === "/agents";
  });
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
    // The app-wide living field reads this to intensify on the /agents page.
    document.documentElement.classList.toggle("route-agents", agentsOpen);
    return () => document.documentElement.classList.remove("route-agents");
  }, [agentsOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncAgentsRoute = () => {
      const isAgentsRoute = window.location.pathname === "/agents";
      setAgentsOpen(isAgentsRoute);
      if (isAgentsRoute) {
        setAppOpen(false);
        setTrustOpen(false);
        setFeedOpen(false);
      }
    };
    window.addEventListener("popstate", syncAgentsRoute);
    return () => window.removeEventListener("popstate", syncAgentsRoute);
  }, []);

  const timeline = useMemo<EvidenceStep[]>(() => {
    return [
      {
        label: "Live quote",
        value: quote ? `${quote.amount} ${quote.asset} on ${quote.network}` : "waiting",
        state: quote ? "done" : "pending",
        kind: "quote"
      },
      {
        label: "x402 settlement",
        value: paidReport
          ? paidReport.paymentReceiptHash
          : state === "payment_required"
            ? "payment required"
            : "waiting",
        state: paidReport ? "done" : "pending",
        kind: "payment"
      },
      {
        label: "AgentPay proof",
        value: verification?.verified ? "root match" : "waiting",
        state: verification?.verified ? "done" : "pending",
        kind: "proof"
      },
      {
        label: "AgentPay decision",
        value: receipt ? "receipt available" : "waiting",
        state: receipt ? "done" : "pending",
        kind: "record"
      }
    ];
  }, [paidReport, quote, receipt, verification]);

  async function runAgentPay() {
    if (agentConnection.status !== "connected") {
      setError("Connect a local agent identifier before quoting live evidence.");
      return;
    }

    clearFlowState();
    setState("running");

    try {
      const quoted = await callTool<Quote>("quote_report", {});
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
      setError(runError instanceof Error ? runError.message : "Audit failed");
    }
  }

  async function continueSettlement() {
    if (agentConnection.status !== "connected") {
      setError("Connect a local agent identifier before continuing settlement.");
      return;
    }

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
        setError(runError.message);
        return;
      }
      setState("error");
      setError(runError instanceof Error ? runError.message : "Settlement failed");
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

  function connectAgent(label: string) {
    const trimmedLabel = label.trim();
    if (lastAgentLabel && trimmedLabel !== lastAgentLabel && hasFlowState()) {
      clearFlowState();
    }
    setAgentConnection({ status: "connected", label: trimmedLabel, localOnly: true });
    setLastAgentLabel(trimmedLabel);
    setError(null);
  }

  function disconnectAgent() {
    if (agentConnection.status === "connected") {
      setLastAgentLabel(agentConnection.label);
    }
    setAgentConnection({ status: "disconnected" });
    setPaymentPayloadText("");
  }

  function hasFlowState() {
    return Boolean(quote || paidReport || verification || receipt || registryStatus || paymentPayloadText || error || state !== "idle");
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "light" ? "dark" : "light"));
  }

  function openAgentPayApp() {
    setAgentsOpen(false);
    setAppOpen(true);
  }

  function closeAgentPayApp() {
    setAppOpen(false);
  }

  function pushPath(path: string) {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }

  function openAgentsPage() {
    pushPath("/agents");
    setAgentsOpen(true);
    setAppOpen(false);
    setTrustOpen(false);
    setFeedOpen(false);
  }

  function closeAgentsPage() {
    pushPath("/");
    setAgentsOpen(false);
  }

  function openTrustPage() {
    pushPath("/");
    setAgentsOpen(false);
    setFeedOpen(false);
    setTrustOpen(true);
  }

  function openFeedPage() {
    pushPath("/");
    setAgentsOpen(false);
    setTrustOpen(false);
    setFeedOpen(true);
  }

  if (agentsOpen) {
    return (
      <AgentPayTooltipProvider delayDuration={140}>
        <IntegratePage
          onBack={closeAgentsPage}
          onOpenAsk={() => {
            closeAgentsPage();
            setTrustOpen(true);
          }}
        />
      </AgentPayTooltipProvider>
    );
  }

  if (feedOpen) {
    return (
      <AgentPayTooltipProvider delayDuration={140}>
        <main className="agent-pay-app" data-theme={theme}>
          <FeedPage
            onBack={() => setFeedOpen(false)}
            onOpenAsk={() => {
              setFeedOpen(false);
              setTrustOpen(true);
            }}
          />
        </main>
      </AgentPayTooltipProvider>
    );
  }

  if (trustOpen) {
    return (
      <AgentPayTooltipProvider delayDuration={140}>
        <main className="agent-pay-app" data-theme={theme}>
          <AskPage
            onBack={() => setTrustOpen(false)}
            onOpenFeed={() => {
              setTrustOpen(false);
              setFeedOpen(true);
            }}
          />
        </main>
      </AgentPayTooltipProvider>
    );
  }


  if (appOpen) {
    return (
      <AgentPayTooltipProvider delayDuration={140}>
        <main className={`agent-pay-app agent-pay-workspace-view page-fog state-${state}`} data-theme={theme}>
          <div className="console-glass-frame glass-frame">
            <AgentPayAppHeader
              state={state}
              theme={theme}
              onBack={closeAgentPayApp}
              onReset={reset}
              onToggleTheme={toggleTheme}
            />
            <AgentPayConsole
              agentConnection={agentConnection}
              error={error}
              onChangePaymentPayload={setPaymentPayloadText}
              onConnectAgent={connectAgent}
              onContinueSettlement={continueSettlement}
              onDisconnectAgent={disconnectAgent}
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
      </AgentPayTooltipProvider>
    );
  }

  return (
    <AgentPayTooltipProvider delayDuration={140}>
      <main className="agent-pay-app" data-theme={theme}>
        <LandingDesk
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenApp={openAgentPayApp}
          onOpenTrust={openTrustPage}
          onOpenFeed={openFeedPage}
          onOpenAgents={openAgentsPage}
        />
      </main>
    </AgentPayTooltipProvider>
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

function decisionForPaidReport(paidReport: PaidReport): WireDecision {
  const evidenceRecords =
    paidReport.evidence && paidReport.evidence.length > 0
      ? paidReport.evidence.map((leaf) => leaf.record)
      : [paidReport.report];
  return scoreSubject(extractSignals(evidenceRecords)).decision;
}

function AgentPayConsole({
  agentConnection,
  error,
  onChangePaymentPayload,
  onConnectAgent,
  onContinueSettlement,
  onDisconnectAgent,
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
  agentConnection: AgentConnectionState;
  error: string | null;
  onChangePaymentPayload: (value: string) => void;
  onConnectAgent: (label: string) => void;
  onContinueSettlement: () => void;
  onDisconnectAgent: () => void;
  onRunAgentPay: () => void;
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

  useEffect(() => {
    setWorkspaceTab(suggestedWorkspaceTab);
  }, [suggestedWorkspaceTab]);

  return (
    <section id="agent-pay-app" className="agent-pay-console" aria-label="AgentPay app">
      <div className="console-header">
        <div className="console-heading">
          <h2>Token check console</h2>
          <p className="muted">Connect an agent, pull live facts, settle the x402 fee, then record the verdict.</p>
        </div>
        <div className="console-actions">
          <AgentPayBadge state={state}>
            {humanizeKey(state)}
          </AgentPayBadge>
          <AgentPayButton variant="primary" disabled={state === "running" || agentConnection.status !== "connected"} onClick={onRunAgentPay}>
            <Play size={17} weight="bold" aria-hidden="true" />
            {state === "running" ? "Quoting" : "Quote live evidence"}
          </AgentPayButton>
        </div>
      </div>

      <AgentPayConnectionPanel connection={agentConnection} onConnect={onConnectAgent} onDisconnect={onDisconnectAgent} />

      {error ? <AgentPayAlert variant="error">{error}</AgentPayAlert> : null}
      {state === "payment_required" && quote ? (
        <AgentPayPaymentSheet
          agentConnected={agentConnection.status === "connected"}
          paymentPayloadText={paymentPayloadText}
          quote={quote}
          onChangePaymentPayload={onChangePaymentPayload}
          onContinue={onContinueSettlement}
        />
      ) : null}

      <AgentPayRunStrip paidReport={paidReport} quote={quote} receipt={receipt} state={state} verification={verification} />

      <section className="agent-pay-workspace">
        <AgentPayCard className="timeline-panel operation-card">
          <PanelHeader icon={<ShieldCheck size={17} weight="bold" aria-hidden="true" />} title="Settlement timeline" sub="Each step has to clear before the next one runs." />
          <AgentPaySeparator />
          <AgentPayEvidenceTimeline steps={timeline} />
        </AgentPayCard>

        <AgentPayTabs value={workspaceTab} onValueChange={setWorkspaceTab} className="workspace-tabs">
          <AgentPayCard className="workspace-panel">
            <div className="workspace-panel-top">
              <PanelHeader icon={<ShareNetwork size={17} aria-hidden="true" />} title="What we found" sub="Live sources, the proof they fold into, and the on-chain record." />
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
                  <AgentPayEmptyState title="No quote yet" body="Connect an agent and quote live evidence to fill this in." />
                )}
              </div>
            </AgentPayTabsContent>

            <AgentPayTabsContent forceMount value="proof">
              <div className="tab-panel-flow">
                {paidReport ? (
                  <AgentPayProofVerdict
                    quote={quote}
                    paidReport={paidReport}
                    verification={verification}
                    tamper={tamper}
                    onTamper={onTamper}
                    onRestore={onRestore}
                  />
                ) : null}
                <AgentPayProofPath proof={paidReport?.proof ?? []} />
              </div>
            </AgentPayTabsContent>

            <AgentPayTabsContent forceMount value="registry">
              <div className="tab-panel-flow">
                <AgentPayRegistryReadiness status={registryStatus} />
                <AgentPayDecisionReceipt receipt={receipt} />
              </div>
            </AgentPayTabsContent>
          </AgentPayCard>
        </AgentPayTabs>
      </section>
    </section>
  );
}

function PanelHeader({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <AgentPayCardHeader>
      <AgentPayCardIcon aria-hidden="true">
        {icon}
      </AgentPayCardIcon>
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
    </AgentPayCardHeader>
  );
}

function AgentPayEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <AgentPaySurface className="agent-pay-empty-state">
      <div className="empty-state-copy">
        <span className="strip-label">Nothing yet</span>
        <strong>{title}</strong>
        <p className="muted">{body}</p>
      </div>
      <div className="empty-state-skeleton" aria-hidden="true">
        <AgentPaySkeleton />
        <AgentPaySkeleton />
        <AgentPaySkeleton />
      </div>
    </AgentPaySurface>
  );
}

/**
 * Interactive DEX swap, mirroring the CSPR.trade trade panel: typeable
 * amounts on both sides, real CSPR / token logos, a live rate. It is the
 * "about to buy a token" moment; the CTA hands that token to Trust Signal.
 */
const HERO_SWAP_RATE = 70.24; // CSPR -> $TOKEN
function HeroSwapScene({ onCheck }: { onCheck?: () => void }) {
  const [pay, setPay] = useState("1,200");
  const payNum = Number.parseFloat(pay.replace(/,/g, "")) || 0;
  const recvNum = payNum * HERO_SWAP_RATE;
  const grp = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });
  const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const onRecv = (v: string) => {
    const n = Number.parseFloat(v.replace(/,/g, "")) || 0;
    setPay(grp(n / HERO_SWAP_RATE));
  };

  return (
    <div className="hero-swap-scene">
      <div className="hero-swap-header">
        <span className="hero-swap-title">Swap</span>
        <span className="hero-swap-network">Casper</span>
      </div>

      <div className="hero-swap-row">
        <div className="hero-swap-row-label">You pay</div>
        <div className="hero-swap-row-main">
          <input
            className="hero-swap-amount-input"
            inputMode="decimal"
            spellCheck={false}
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            aria-label="Amount you pay"
          />
          <span className="hero-swap-token">
            <img className="hero-swap-token-logo" src="/tokens/cspr.png" alt="CSPR" width={22} height={22} />
            <span className="hero-swap-token-name">CSPR</span>
          </span>
        </div>
        <div className="hero-swap-row-sub">
          <span>≈ ${usd(payNum * 0.4)}</span>
          <span className="hero-swap-balance">Balance 0 · Max</span>
        </div>
      </div>

      <div className="hero-swap-direction">
        <button className="hero-swap-dir-btn" type="button" tabIndex={-1} aria-label="Switch direction">
          <ArrowsDownUp size={16} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <div className="hero-swap-row hero-swap-row--receive">
        <div className="hero-swap-row-label">You receive</div>
        <div className="hero-swap-row-main">
          <input
            className="hero-swap-amount-input"
            inputMode="decimal"
            spellCheck={false}
            value={grp(recvNum)}
            onChange={(e) => onRecv(e.target.value)}
            aria-label="Amount you receive"
          />
          <span className="hero-swap-token">
            <img className="hero-swap-token-logo" src="/tokens/scspr.png" alt="token" width={22} height={22} />
            <span className="hero-swap-token-name">$TOKEN</span>
          </span>
        </div>
        <div className="hero-swap-row-sub">
          <span>≈ ${usd(recvNum * 0.0057)}</span>
          <span className="hero-swap-slippage">0.5% slippage</span>
        </div>
      </div>

      <div className="hero-swap-rate">
        1 CSPR = {HERO_SWAP_RATE} $TOKEN
        <span className="hero-swap-rate-tag">via CSPR.trade</span>
      </div>

      <button className="hero-swap-cta" type="button" onClick={onCheck}>
        Check this token first →
      </button>
    </div>
  );
}

// The proof route climbing to the dataset root. Each segment "locks" in
// turn; once the route reaches the root, the home signal is released.
const ROUTE_NODES = [
  { x: 44, y: 210 },
  { x: 96, y: 182 },
  { x: 150, y: 152 },
  { x: 202, y: 118 },
  { x: 250, y: 84 }
];

/**
 * The signal box — the one hero moment.
 *
 * The proof route locks segment by segment up to the root; the home signal's
 * lamp turns from red to green and its semaphore arm drops to clear; the
 * payment train, held until now, passes into the block register. The whole
 * sequence is driven by one GSAP timeline. Under prefers-reduced-motion the
 * scene simply rests in its final, cleared state (see styles.css).
 */
function AgentPaySignalScene() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const scene = sceneRef.current;
      if (!scene) {
        return;
      }

      const computed = getComputedStyle(scene);
      const aspectDanger = computed.getPropertyValue("--aspect-danger").trim();
      const aspectCaution = computed.getPropertyValue("--aspect-caution").trim();
      const aspectClear = computed.getPropertyValue("--aspect-clear").trim();
      const boxInkFaint = computed.getPropertyValue("--box-line").trim();

      const routeSegments = gsap.utils.toArray<SVGGeometryElement>(".sig-route-seg", scene);
      const releaseLink = scene.querySelector<SVGGeometryElement>(".sig-release-link");
      const registerLine = scene.querySelector<SVGGeometryElement>(".sig-reg-line");
      const routeNodes = gsap.utils.toArray<SVGElement>(".sig-node", scene);

      const prepareDraw = (shape: SVGGeometryElement | null) => {
        if (!shape) {
          return 0;
        }
        if (typeof shape.getTotalLength !== "function") {
          gsap.set(shape, {
            strokeDasharray: 0,
            strokeDashoffset: 0
          });
          return 0;
        }
        const length = shape.getTotalLength();
        gsap.set(shape, {
          strokeDasharray: length,
          strokeDashoffset: length
        });
        return length;
      };

      routeSegments.forEach((segment) => {
        prepareDraw(segment);
      });
      prepareDraw(releaseLink);
      prepareDraw(registerLine);

      if (typeof window.matchMedia !== "function") {
        return;
      }

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(routeSegments, { autoAlpha: 1, strokeDashoffset: 0 });
        gsap.set(releaseLink, { autoAlpha: 1, strokeDashoffset: 0 });
        gsap.set(".sig-root", { autoAlpha: 1, scale: 1, transformOrigin: "50% 50%" });
        gsap.set(".sig-arm", { rotation: 40, svgOrigin: "330 150" });
        gsap.set(".sig-lamp", { fill: aspectClear });
        gsap.set(".sig-lamp-halo", { opacity: 1, scale: 1, transformOrigin: "50% 50%" });
        gsap.set(".sig-train", { x: 215 });
        gsap.set(registerLine, { stroke: aspectClear, strokeDashoffset: 0 });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.set(routeSegments, { autoAlpha: 0 });
        gsap.set(releaseLink, { autoAlpha: 0 });
        gsap.set(routeNodes, { transformOrigin: "50% 50%" });
        gsap.set(".sig-root", { autoAlpha: 0, scale: 0.92, transformOrigin: "50% 50%" });
        gsap.set(".sig-arm", { rotation: 0, svgOrigin: "330 150" });
        gsap.set(".sig-lamp", { fill: aspectDanger });
        gsap.set(".sig-lamp-halo", { opacity: 1, scale: 1, transformOrigin: "50% 50%" });
        gsap.set(".sig-train", { x: 0 });
        gsap.set(registerLine, { stroke: boxInkFaint, strokeDashoffset: prepareDraw(registerLine) });

        const timeline = gsap.timeline({
          defaults: { ease: "power2.out" },
          delay: 0.25
        });

        routeSegments.forEach((segment, index) => {
          timeline.to(
            segment,
            {
              autoAlpha: 1,
              strokeDashoffset: 0,
              duration: 0.42
            },
            index === 0 ? 0 : ">-0.16"
          );
          timeline.fromTo(
            routeNodes[index + 1],
            { scale: 0.82 },
            { scale: 1, duration: 0.18, ease: "power1.out" },
            "<+0.24"
          );
        });

        timeline
          .to(".sig-root", { autoAlpha: 1, scale: 1, duration: 0.28, ease: "power1.out" }, ">-0.04")
          .to(releaseLink, { autoAlpha: 1, strokeDashoffset: 0, duration: 0.36, ease: "power1.out" }, ">-0.08")
          .to(".sig-lamp", { fill: aspectCaution, duration: 0.16, ease: "none" }, ">-0.02")
          .to(".sig-lamp", { fill: aspectClear, duration: 0.28, ease: "none" })
          .to(".sig-arm", { rotation: 43, duration: 0.5, ease: "power2.inOut", svgOrigin: "330 150" }, "<-0.1")
          .to(".sig-arm", { rotation: 40, duration: 0.18, ease: "power1.out", svgOrigin: "330 150" })
          .to(".sig-train", { x: 215, duration: 1.05, ease: "power2.inOut" }, ">+0.18")
          .to(registerLine, { stroke: aspectClear, strokeDashoffset: 0, duration: 0.46, ease: "power1.out" }, ">-0.34");

        return () => {
          timeline.kill();
        };
      });

      return () => {
        mm.revert();
      };
    },
    { scope: sceneRef }
  );

  return (
    <div className="signal-scene" ref={sceneRef} aria-hidden="true">
      <svg className="signal-svg" viewBox="0 0 560 420" fill="none" focusable="false">
        {/* the running line */}
        <line className="sig-track" x1="24" y1="350" x2="536" y2="350" />
        {[40, 92, 144, 196, 248, 352, 404, 456, 508].map((x) => (
          <line className="sig-sleeper" key={x} x1={x} y1="344" x2={x} y2="356" />
        ))}

        {/* the proof route, locking up to the root */}
        <polyline className="sig-route-base" points={ROUTE_NODES.map((n) => `${n.x},${n.y}`).join(" ")} />
        {ROUTE_NODES.slice(0, -1).map((node, index) => (
          <line
            className="sig-route-seg"
            key={`${node.x}-${node.y}`}
            x1={node.x}
            y1={node.y}
            x2={ROUTE_NODES[index + 1].x}
            y2={ROUTE_NODES[index + 1].y}
          />
        ))}
        {ROUTE_NODES.map((node) => (
          <circle className="sig-node" key={`node-${node.x}`} cx={node.x} cy={node.y} r="3.5" />
        ))}
        <circle className="sig-root" cx="250" cy="84" r="12" />
        <circle className="sig-node-core" cx="250" cy="84" r="3.5" />
        <text className="sig-label sig-label-brass" x="42" y="228">checks</text>
        <text className="sig-label" x="250" y="62" textAnchor="middle">evidence</text>

        {/* a proven route releases the home signal */}
        <path className="sig-route-base sig-release-link" d="M 250 84 C 288 96 304 108 330 124" />

        {/* the home signal */}
        <line className="sig-post" x1="330" y1="124" x2="330" y2="350" />
        <circle className="sig-finial" cx="330" cy="120" r="5" />
        <g className="sig-arm">
          <rect className="sig-arm-plate" x="252" y="144" width="76" height="12" rx="2" />
          <rect className="sig-arm-stripe" x="258" y="146" width="11" height="8" rx="1" />
        </g>
        <circle className="sig-arm-pivot" cx="330" cy="150" r="5" />
        <circle className="sig-lamp-halo" cx="330" cy="196" r="15" />
        <circle className="sig-lamp" cx="330" cy="196" r="8" />
        <text className="sig-label sig-label-brass" x="344" y="130">signal</text>

        {/* the payment train, held then passing */}
        <g className="sig-train">
          <rect className="sig-train-body" x="60" y="302" width="108" height="44" rx="7" />
          <rect className="sig-train-glass" x="72" y="310" width="22" height="15" rx="3" />
          <rect className="sig-train-glass" x="102" y="310" width="22" height="15" rx="3" />
          <circle className="sig-train-glass" cx="86" cy="350" r="6" />
          <circle className="sig-train-glass" cx="142" cy="350" r="6" />
          <text className="sig-train-label" x="114" y="334" textAnchor="middle">TOKEN</text>
        </g>

        {/* the block register — where the real receipt is recorded */}
        <rect className="sig-register" x="392" y="296" width="150" height="84" rx="7" />
        <line className="sig-reg-line" x1="406" y1="346" x2="528" y2="346" />
        <text className="sig-label sig-label-brass" x="406" y="320">on Casper</text>
        <text className="sig-label" x="406" y="368">verdict stamped</text>
      </svg>
    </div>
  );
}

function AgentPayConnectionPanel({
  connection,
  onConnect,
  onDisconnect
}: {
  connection: AgentConnectionState;
  onConnect: (label: string) => void;
  onDisconnect: () => void;
}) {
  const [agentIdentifier, setAgentIdentifier] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedIdentifier = agentIdentifier.trim();
    const nextError = validateAgentIdentifier(trimmedIdentifier);
    if (nextError) {
      setValidationError(nextError);
      return;
    }
    setValidationError(null);
    onConnect(trimmedIdentifier);
    setAgentIdentifier("");
  }

  if (connection.status === "connected") {
    return (
    <AgentPaySurface asChild variant="connectionActive">
      <section aria-label="AgentPay agent connection">
        <div className="connection-copy">
          <span className="connection-flag">
            <PlugsConnected size={12} aria-hidden="true" />
            Local agent
          </span>
          <h2>{connection.label}</h2>
          <span className="aspect-chip aspect-chip--clear" style={{ marginTop: '4px', width: 'fit-content' }}>Connected</span>
          <p className="muted">Local session only. Backend auth is not configured.</p>
        </div>
        <AgentPayButton variant="secondary" onClick={onDisconnect}>
          Disconnect
        </AgentPayButton>
      </section>
    </AgentPaySurface>
    );
  }

  return (
    <AgentPaySurface asChild variant="connection">
      <section aria-label="AgentPay agent connection">
      <div className="connection-copy">
        <span className="connection-flag">
          <Plugs size={12} aria-hidden="true" />
          Agent identity
        </span>
        <h2>Connect agent</h2>
        <p className="muted">Local session only. Backend auth is not configured.</p>
      </div>
      <form className="agent-connection-form" onSubmit={submitConnection}>
        <AgentPayField className="agent-identifier-field">
          <AgentPayFieldLabel>Agent identifier</AgentPayFieldLabel>
          <AgentPayInput
            autoComplete="off"
            maxLength={96}
            placeholder="desk-agent-alpha"
            value={agentIdentifier}
            onChange={(event) => {
              setAgentIdentifier(event.target.value);
              if (validationError) {
                setValidationError(null);
              }
            }}
          />
        </AgentPayField>
        <AgentPayButton variant="secondary" type="submit">
          Connect agent
        </AgentPayButton>
        {validationError ? <p className="agent-connection-error">{validationError}</p> : null}
      </form>
      </section>
    </AgentPaySurface>
  );
}

function AgentPayPaymentSheet({
  agentConnected,
  quote,
  paymentPayloadText,
  onChangePaymentPayload,
  onContinue
}: {
  agentConnected: boolean;
  quote: Quote;
  paymentPayloadText: string;
  onChangePaymentPayload: (value: string) => void;
  onContinue: () => void;
}) {
  const canAcceptPayment = quote.paymentRequirements.length > 0;

  return (
    <AgentPaySheet open modal={false}>
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
            <AgentPayButton variant="primary" disabled={!agentConnected} onClick={onContinue}>
              Continue settlement
            </AgentPayButton>
          </div>
        ) : (
          <p className="muted">
            AgentPay cannot accept payment for this quote:{" "}
            <AgentPayInlineCode>{quote.paymentReadiness.reason ?? quote.paymentConfigurationReason}</AgentPayInlineCode>.
          </p>
        )}
      </AgentPaySheetContent>
    </AgentPaySheet>
  );
}

function AgentPayRunStrip({
  quote,
  paidReport,
  receipt,
  state,
  verification
}: {
  quote: Quote | null;
  paidReport: PaidReport | null;
  receipt: DecisionReceiptData | null;
  state: RunState;
  verification: Verification | null;
}) {
  return (
    <AgentPaySurface asChild className="control-strip">
      <section aria-label="AgentPay run summary">
      <div>
        <span className="strip-label">Mode</span>
        <strong>{receipt ? "Registry confirmed" : quote ? "Live source quote" : "Waiting"}</strong>
      </div>
      <div>
        <span className="strip-label">Dataset</span>
        <strong>{quote?.datasetId ?? "not quoted"}</strong>
      </div>
      <div>
        <span className="strip-label">Payment</span>
        <strong>{paymentStatusLabel(quote, paidReport, state)}</strong>
      </div>
      <div>
        <span className="strip-label">Proof</span>
        <strong>{verification?.verified ? "root match" : "not run"}</strong>
      </div>
      </section>
    </AgentPaySurface>
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
          {readiness.reason ? readiness.reason : readiness.supportedKind ? readiness.supportedKind.network : readiness.facilitatorUrl}
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
        <p className="muted">{status.reason ? humanizeKey(status.reason) : status.rpc?.chainspecName ?? status.recordScript}</p>
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

function paymentStatusLabel(quote: Quote | null, paidReport: PaidReport | null, state: RunState) {
  if (paidReport) {
    return "settled";
  }
  if (!quote) {
    return state === "payment_required" ? "requires x402" : "awaiting quote";
  }
  if (quote.paymentReadiness.status === "ready") {
    return state === "payment_required" ? "requires x402" : "ready";
  }
  return humanizeKey(quote.paymentReadiness.status);
}

function validateAgentIdentifier(value: string) {
  if (!value) {
    return "Enter a non-secret agent identifier.";
  }
  if (value.length > 64) {
    return "Agent identifier must be 64 characters or less.";
  }
  if (isSecretLikeAgentIdentifier(value)) {
    return "Use the x402 payment payload field for payment data, not the agent identifier.";
  }
  return null;
}

function isSecretLikeAgentIdentifier(value: string) {
  const normalized = value.trim();
  const lowered = normalized.toLowerCase();

  if ((normalized.startsWith("{") && normalized.endsWith("}")) || lowered.includes("x402version")) {
    return true;
  }
  if (lowered.startsWith("bearer ") || lowered.includes("private_key") || lowered.includes("secret")) {
    return true;
  }
  if (/^-----begin [a-z ]+private key-----/i.test(normalized)) {
    return true;
  }
  if (/^00[0-9a-f]{64}$/i.test(normalized) || /^hash-[0-9a-f]{64}$/i.test(normalized)) {
    return true;
  }
  return false;
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
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid x402 payment payload JSON: ${error.message}` : "Invalid x402 payment payload JSON");
  }
}
