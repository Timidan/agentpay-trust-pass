import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import {
  ArrowSquareOut,
  CheckCircle,
  Copy,
  Check,
  List,
  MinusCircle,
  Moon,
  ShieldCheck,
  Sun,
  X,
} from "@phosphor-icons/react";
import { AgentPayLogo } from "../components/AgentPayLogo";
import {
  callTool,
  getBridgeHealth,
  getReportHealth,
  type PaymentReadiness,
  type RegistryStatus,
  type TokenEvidenceStatus,
} from "../api";
import { friendlyReason } from "../lib/friendly-errors";
import type { LandingVariantProps } from "./types";
import casperLogo from "../assets/brand-logos/casper.png";
import x402Logo from "../assets/brand-logos/x402.svg";
import csprCloudLogo from "../assets/brand-logos/cspr-cloud.svg";
import csprTradeLogo from "../assets/brand-logos/cspr-trade-mark.svg";
import mcpLogo from "../assets/brand-logos/mcp.svg";
import {
  AGENT_SURFACES,
  CLI_NPM_URL,
  EXPLORER,
  MCP_NPM_URL,
  shortHash,
} from "./data";
import { WorkflowTimeline } from "./Timeline";
import { IconNonCustodial, IconTokenData } from "./icons";
import "./landing2.css";

// ------------------------------------------------------------------ //
//  Motion — one recipe: opacity 0->1, translateY 8->0, blur 4->0,    //
//  ~0.6s ease-out, ~70ms stagger. All behind prefers-reduced-motion  //
//  (a reduced viewer gets the settled state, no transition).         //
// ------------------------------------------------------------------ //

const EASE_OUT: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

// scroll-into-view entrances rely on IntersectionObserver. Where it (or a
// reduced-motion preference) is absent — jsdom, older engines — we render the
// settled state directly rather than animate.
const canObserve = () => typeof IntersectionObserver !== "undefined";

function useSettled() {
  const reduce = useReducedMotion();
  return Boolean(reduce) || !canObserve();
}

const ITEM_VARIANTS: Variants = {
  // 28px + 0.75s reads as a deliberate rise at normal scroll speed; the
  // original 8px/0.6s finished before the eye reached the element.
  hidden: { opacity: 0, y: 28, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.75, ease: EASE_OUT },
    // A lingering blur(0px) keeps the block on its own compositing layer and
    // rasterizes text soft on fractional-DPR displays; drop it once settled.
    transitionEnd: { filter: "none" },
  },
};

function useReveal() {
  const settled = useSettled();
  return (delay = 0) =>
    settled
      ? {}
      : ({
          initial: { opacity: 0, y: 28, filter: "blur(4px)" },
          whileInView: { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } },
          // Fire only once the element is well inside the viewport so the
          // entrance happens where the viewer is actually looking.
          viewport: { once: true, margin: "-14% 0px -14% 0px" },
          transition: { duration: 0.75, ease: EASE_OUT, delay },
        } as const);
}

type LandingStatus = {
  bridge: "checking" | "ready" | "unavailable";
  payment: PaymentReadiness | null;
  registry: RegistryStatus | null;
  tokenEvidence: TokenEvidenceStatus | null;
  checkedAt: string | null;
};

function useLandingStatus(): LandingStatus {
  const [status, setStatus] = useState<LandingStatus>({
    bridge: "checking",
    payment: null,
    registry: null,
    tokenEvidence: null,
    checkedAt: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const [bridgeResult, paymentResult, registryResult, reportResult] = await Promise.allSettled([
        getBridgeHealth(),
        callTool<PaymentReadiness>("payment_status", {}),
        callTool<RegistryStatus>("registry_status", {}),
        getReportHealth(),
      ]);
      if (cancelled) return;

      const payment =
        paymentResult.status === "fulfilled" && typeof paymentResult.value?.status === "string"
          ? paymentResult.value
          : null;
      const registry =
        registryResult.status === "fulfilled" && typeof registryResult.value?.status === "string"
          ? registryResult.value
          : null;
      const reportHealth = reportResult.status === "fulfilled" ? reportResult.value : null;
      setStatus({
        bridge:
          bridgeResult.status === "fulfilled" && bridgeResult.value
            ? "ready"
            : "unavailable",
        payment,
        registry,
        tokenEvidence: reportHealth?.tokenEvidence ?? null,
        checkedAt: payment?.checkedAt ?? registry?.checkedAt ?? reportHealth?.checkedAt ?? new Date().toISOString(),
      });
    }

    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return status;
}

// ------------------------------------------------------------------ //

// The agents-band code frame with a surface selector: pills cycle through the
// three public integration surfaces (MCP package, CLI package, HTTP bridge)
// and their code samples. Auto-advances every few seconds until the viewer
// interacts (click, hover, or focus), then stays under manual control.
function AgentSurfaces() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  // Code-editor feel: each sample types itself out slowly under a blinking
  // caret. Reduced-motion viewers get the full text instantly, no caret.
  const [typed, setTyped] = useState(0);
  const [paused, setPaused] = useState(false);
  const hovering = useRef(false);
  const resumeTimer = useRef<number | null>(null);

  const surface = AGENT_SURFACES[active];
  const done = reduce || typed >= surface.code.length;

  useEffect(() => {
    setTyped(0);
  }, [active]);

  useEffect(() => {
    if (reduce || done) return;
    const timer = window.setInterval(() => setTyped((n) => n + 1), 24);
    return () => window.clearInterval(timer);
  }, [reduce, done]);

  // Advance only after the sample finished typing plus a reading dwell.
  useEffect(() => {
    if (reduce || paused || !done) return;
    const timer = window.setInterval(() => {
      if (!hovering.current) setActive((i) => (i + 1) % AGENT_SURFACES.length);
    }, 3400);
    return () => window.clearInterval(timer);
  }, [reduce, paused, done]);

  useEffect(() => () => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
  }, []);

  const pick = (i: number) => {
    setActive(i);
    setPaused(true);
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setPaused(false), 12000);
  };

  return (
    <div
      className="lp2-codeframe"
      onMouseEnter={() => { hovering.current = true; }}
      onMouseLeave={() => { hovering.current = false; }}
    >
      <div className="lp2-codeframe-bar">
        <span className="lp2-dot" aria-hidden="true" />
        <span className="lp2-dot" aria-hidden="true" />
        <span className="lp2-dot" aria-hidden="true" />
        <span className="lp2-codeframe-title">{surface.title}</span>
        <div className="lp2-surface-tabs" role="tablist" aria-label="Integration surface">
          {AGENT_SURFACES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              className="lp2-surface-tab"
              data-active={i === active ? "true" : "false"}
              onClick={() => pick(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      {/* All samples stay mounted in one grid cell so the frame keeps the
          height of the tallest sample; the hidden ones size the frame while
          the active one types itself out. */}
      <div className="lp2-code-stack">
        {AGENT_SURFACES.map((s, i) => (
          <pre className="lp2-code" data-on={i === active ? "true" : "false"} key={s.id} aria-hidden={i !== active}>
            {i === active && !reduce ? (
              <code>
                {s.code.slice(0, typed)}
                <span className="lp2-caret" aria-hidden="true" />
              </code>
            ) : (
              <code>{s.code}</code>
            )}
          </pre>
        ))}
      </div>
    </div>
  );
}

function CopyHash({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="lp2-hash"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        );
      }}
    >
      <code>{shortHash(value)}</code>
      {copied ? <Check size={13} weight="bold" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

export default function Landing2({
  theme,
  onToggleTheme,
  onOpenApp,
  onOpenTrust,
  onOpenFeed,
  onOpenAgents,
  onOpenCounterparty,
  onOpenAudit,
}: LandingVariantProps) {
  const reveal = useReveal();
  const liveStatus = useLandingStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const openAudit = onOpenAudit ?? onOpenApp;

  // The technology AgentPay runs on and integrates with — not partners or
  // endorsers. Marks sit on light chips so they read in both themes.
  const TECH: ReadonlyArray<{ name: string; src?: string }> = [
    { name: "Casper Network", src: casperLogo },
    { name: "CSPR.trade", src: csprTradeLogo },
    { name: "CSPR.name" },
    { name: "CSPR.live" },
    { name: "CSPR.cloud", src: csprCloudLogo },
    { name: "x402", src: x402Logo },
    { name: "MCP", src: mcpLogo },
  ];

  const scrollTo = (id: string) => (event: React.MouseEvent) => {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    setMenuOpen(false);
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="lp2">
      {/* ---------------------------------------------------------- nav */}
      <header className="lp2-nav">
        <div className="lp2-nav-inner">
          <a className="lp2-brand" href="#top" onClick={scrollTo("top")}>
            <AgentPayLogo className="lp2-logo" decorative />
            <span className="lp2-brandword">AgentPay</span>
          </a>

          <nav className="lp2-navlinks" aria-label="Sections">
            <a className="lp2-navlink" href="#lp2-how" onClick={scrollTo("lp2-how")}>
              How it works
            </a>
            <a className="lp2-navlink" href="#lp2-services" onClick={scrollTo("lp2-services")}>
              Services
            </a>
            <a className="lp2-navlink" href="#lp2-agents" onClick={scrollTo("lp2-agents")}>
              Agents
            </a>
            <button type="button" className="lp2-navlink" onClick={onOpenAgents}>
              Developers
            </button>
          </nav>

          <div className="lp2-nav-actions">
            <button
              type="button"
              className="lp2-theme"
              aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              onClick={onToggleTheme}
            >
              {theme === "light" ? (
                <Moon size={17} weight="bold" aria-hidden="true" />
              ) : (
                <Sun size={17} weight="bold" aria-hidden="true" />
              )}
            </button>
            <button type="button" className="lp2-pill is-primary lp2-nav-cta" onClick={openAudit}>
              Open the payment checker
            </button>
            <button
              type="button"
              className="lp2-menu-btn"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="lp2-mobile-menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={18} weight="bold" aria-hidden="true" /> : <List size={18} weight="bold" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="lp2-mobile-menu" id="lp2-mobile-menu">
            <a className="lp2-navlink" href="#lp2-how" onClick={scrollTo("lp2-how")}>
              How it works
            </a>
            <a className="lp2-navlink" href="#lp2-services" onClick={scrollTo("lp2-services")}>
              Services
            </a>
            <a className="lp2-navlink" href="#lp2-agents" onClick={scrollTo("lp2-agents")}>
              Agents
            </a>
            <button type="button" className="lp2-navlink" onClick={() => { setMenuOpen(false); onOpenAgents(); }}>
              Developers
            </button>
            <button type="button" className="lp2-pill is-primary" onClick={() => { setMenuOpen(false); openAudit(); }}>
              Open the payment checker
            </button>
          </div>
        ) : null}
      </header>

      <main id="top" className="lp2-main">
        {/* -------------------------------------------------------- hero */}
        <section className="lp2-band is-wash lp2-hero">
          <div className="lp2-inner lp2-hero-inner">
            <motion.h1 className="lp2-h1" {...reveal(0)}>
              Let AI agents pay Casper APIs without signing blind.
            </motion.h1>

            <motion.p className="lp2-lede" {...reveal(0.06)}>
              AgentPay checks who gets paid, how much they asked for, and the buyer's rules before
              signing. After settlement, it checks the Casper transfer, records the service response,
              and creates a receipt tied to Casper.
            </motion.p>

            <motion.div className="lp2-ctas" {...reveal(0.12)}>
              <button type="button" className="lp2-pill is-primary" onClick={openAudit}>
                Open the payment checker
              </button>
              <button type="button" className="lp2-pill is-tint" onClick={onOpenFeed}>
                See shared results
              </button>
            </motion.div>

            <motion.div className="lp2-artifact" {...reveal(0.18)}>
              <HeroArtifact />
            </motion.div>

            <motion.div className="lp2-tech" {...reveal(0.24)}>
              <span className="lp2-tech-label">Connected to</span>
              <ul className="lp2-tech-row" aria-label="Networks and services AgentPay connects to">
                {TECH.map((tech) => (
                  <li className="lp2-chip" key={tech.name}>
                    {tech.src ? (
                      <img className="lp2-chip-logo" src={tech.src} alt="" aria-hidden="true" />
                    ) : null}
                    <span>{tech.name}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </section>

        {/* ------------------------------------------------------ agents */}
        <section id="lp2-agents" className="lp2-band is-plain lp2-agents">
          <div className="lp2-inner lp2-center">
            <motion.h2 className="lp2-h2" {...reveal(0)}>
              Made for agents that <em className="lp2-accent">pay</em>.
            </motion.h2>
            <motion.p className="lp2-lede" {...reveal(0.06)}>
              Your agent calls AgentPay over MCP or HTTP before it signs. The published MCP and CLI
              packages and the hosted bridge use the same payment rules. Signing stays in the
              buyer's wallet.
            </motion.p>

            <motion.p className="lp2-package-links" {...reveal(0.09)}>
              Published on npm: <a href={MCP_NPM_URL} target="_blank" rel="noreferrer">@timidan/agentpay-mcp</a>
              <span aria-hidden="true"> / </span>
              <a href={CLI_NPM_URL} target="_blank" rel="noreferrer">@timidan/agentpay-cli</a>
            </motion.p>

            <motion.div {...reveal(0.12)}>
              <AgentSurfaces />
            </motion.div>

            <motion.div className="lp2-ctas is-center" {...reveal(0.18)}>
              <button type="button" className="lp2-pill is-primary" onClick={onOpenAgents}>
                Agent docs
              </button>
              <button type="button" className="lp2-pill is-tint" onClick={openAudit}>
                Open the payment checker
              </button>
            </motion.div>
          </div>
        </section>

        {/* ---------------------------------------------------- workflow */}
        <section id="lp2-how" className="lp2-band is-plain lp2-how">
          <div className="lp2-inner">
            <motion.div className="lp2-sec-head" {...reveal(0)}>
              <h2 className="lp2-h2 is-left">From the charge to a receipt on Casper.</h2>
              <p className="lp2-sub">
                Eight steps in four phases, always in this order. Approval is never payment. Your
                key stays in the wallet, and no receipt is written to Casper until the transfer is
                verified.
              </p>
            </motion.div>

            <WorkflowTimeline />
          </div>
        </section>

        {/* ---------------------------------------------------- services */}
        <section id="lp2-services" className="lp2-band is-wash lp2-services">
          <div className="lp2-inner">
            <motion.div className="lp2-sec-head" {...reveal(0)}>
              <h2 className="lp2-h2 is-left">Two paid checks, and the results people share.</h2>
              <p className="lp2-sub">
                The token and wallet checks are paid checks: each one settles over x402 and returns
                a receipt. Shared results is a view of checks other people chose to publish.
              </p>
            </motion.div>

            <Stagger className="lp2-cards">
              <StaggerItem as="article" className="lp2-card">
                <h3 className="lp2-card-title">Token check</h3>
                <p className="lp2-card-body">
                  Look up a Casper token before a swap. AgentPay reports what it could verify and
                  clearly lists the signals it could not check — not a complete scam determination.
                </p>
                <button type="button" className="lp2-pill is-tint lp2-card-cta" onClick={onOpenTrust}>
                  Check a token
                </button>
              </StaggerItem>

              <StaggerItem as="article" className="lp2-card">
                <h3 className="lp2-card-title">Wallet check</h3>
                <p className="lp2-card-body">
                  Enter a CSPR.name, account hash, or public key. AgentPay resolves the account,
                  confirms it on Casper, and reports how its keys are controlled.
                </p>
                <button
                  type="button"
                  className="lp2-pill is-tint lp2-card-cta"
                  onClick={onOpenCounterparty ?? onOpenTrust}
                >
                  Check a wallet
                </button>
              </StaggerItem>

              <StaggerItem as="article" className="lp2-card">
                <h3 className="lp2-card-title">Shared results</h3>
                <p className="lp2-card-body">
                  Check results that people chose to publish. Nothing appears here unless the
                  person who ran the check shared it.
                </p>
                <button type="button" className="lp2-pill is-tint lp2-card-cta" onClick={onOpenFeed}>
                  See shared results
                </button>
              </StaggerItem>
            </Stagger>
          </div>
        </section>

        {/* -------------------------------------------------- live status */}
        <section className="lp2-band is-light lp2-facts">
          <div className="lp2-inner">
            <motion.div className="lp2-facts-head" {...reveal(0)}>
              <h2 className="lp2-h2 is-left">Live AgentPay status.</h2>
              <p className="lp2-facts-tag">
                Read from the public services. No paid check runs when this status loads.
                {liveStatus.checkedAt ? ` Last checked ${formatStatusTime(liveStatus.checkedAt)}.` : ""}
              </p>
            </motion.div>

            <Stagger className="lp2-statgrid">
              <StatCard
                icon={<img className="lp2-statcard-logo" src={mcpLogo} alt="" />}
                value={bridgeStatusLabel(liveStatus.bridge)}
                line={
                  liveStatus.bridge === "ready"
                    ? "The public MCP and HTTP bridge answered its health check."
                    : liveStatus.bridge === "checking"
                      ? "Checking the public agent bridge now."
                      : "The public agent bridge did not answer this check."
                }
              />
              <StatCard
                icon={<img className="lp2-statcard-logo" src={x402Logo} alt="" />}
                value={paymentStatusLabel(liveStatus.payment)}
                line={paymentStatusLine(liveStatus.payment)}
              />
              <StatCard
                icon={<img className="lp2-statcard-logo" src={casperLogo} alt="" />}
                value={registryStatusLabel(liveStatus.registry)}
                line={registryStatusLine(liveStatus.registry)}
                hash={liveStatus.registry?.registryPackageHash ?? undefined}
                hashLabel="current registry package hash"
              />
              <StatCard
                icon={<IconNonCustodial size={30} />}
                value="Non-custodial"
                line="The backend never receives a buyer private key."
              />
              <StatCard
                icon={<IconTokenData size={30} />}
                value={tokenEvidenceStatusLabel(liveStatus.tokenEvidence)}
                line={tokenEvidenceStatusLine(liveStatus.tokenEvidence)}
              />
              <StatCard
                icon={<img className="lp2-statcard-logo" src={casperLogo} alt="" />}
                value="Casper Testnet"
                line="Public paid checks and Casper receipt records use Testnet funds while evidence may come from Mainnet or Testnet."
              />
            </Stagger>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------- footer */}
      <footer className="lp2-band is-dark lp2-footer">
        <div className="lp2-inner lp2-footer-inner">
          <div className="lp2-footer-brand">
            <span className="lp2-brand">
              <AgentPayLogo className="lp2-logo" decorative />
              <span className="lp2-brandword">AgentPay</span>
            </span>
            <p className="lp2-footer-line">Checks the charge before your agent signs it.</p>
            <div className="lp2-footer-marks">
              <img className="lp2-mark" src={casperLogo} alt="Casper" />
              <img className="lp2-mark is-x402" src={x402Logo} alt="x402" />
              <span className="lp2-net">Casper Testnet</span>
            </div>
          </div>

          <nav className="lp2-footer-col" aria-label="Product">
            <span className="lp2-footer-h">Product</span>
            <button type="button" className="lp2-footer-link" onClick={openAudit}>Payment checker</button>
            <button type="button" className="lp2-footer-link" onClick={onOpenTrust}>Token check</button>
            <button type="button" className="lp2-footer-link" onClick={onOpenCounterparty ?? onOpenTrust}>Wallet check</button>
            <button type="button" className="lp2-footer-link" onClick={onOpenFeed}>Shared results</button>
          </nav>

          <nav className="lp2-footer-col" aria-label="Build">
            <span className="lp2-footer-h">Build</span>
            <button type="button" className="lp2-footer-link" onClick={onOpenAgents}>Agents</button>
            <button type="button" className="lp2-footer-link" onClick={onOpenApp}>Open the console</button>
            <a
              className="lp2-footer-link"
              href={EXPLORER}
              target="_blank"
              rel="noreferrer"
            >
              Casper Testnet explorer
              <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
            </a>
          </nav>
        </div>
        <div className="lp2-inner lp2-footer-base">
          <span>Casper Testnet · non-custodial</span>
          <span>Approval is not payment. Signing stays in the wallet.</span>
        </div>
      </footer>
    </div>
  );
}

function bridgeStatusLabel(status: LandingStatus["bridge"]): string {
  if (status === "ready") return "Agent bridge live";
  if (status === "checking") return "Checking bridge";
  return "Bridge unavailable";
}

function paymentStatusLabel(status: PaymentReadiness | null): string {
  if (!status) return "Payment status unavailable";
  if (status.status === "ready") return "x402 payments ready";
  if (status.status === "configuration_required") return "Payments need setup";
  if (status.status === "facilitator_unavailable") return "Payment service unavailable";
  return "Payment terms unsupported";
}

function paymentStatusLine(status: PaymentReadiness | null): string {
  if (!status) return "The public payment status did not answer this check.";
  if (status.status === "ready") {
    return `AgentPay can accept ${status.supportedKind?.network ?? "the configured Casper Testnet payment"}.`;
  }
  return status.reason
    ? friendlyReason(status.reason).headline
    : "AgentPay cannot accept the configured payment right now.";
}

function registryStatusLabel(status: RegistryStatus | null): string {
  if (!status) return "Registry status unavailable";
  if (status.status === "ready") return "Registry ready";
  if (status.status === "configuration_required") return "Registry needs setup";
  return "Registry RPC unavailable";
}

function registryStatusLine(status: RegistryStatus | null): string {
  if (!status) return "The public registry status did not answer this check.";
  if (status.status === "ready") {
    return "AgentPay can submit receipt hashes to its configured Testnet registry.";
  }
  return status.reason
    ? friendlyReason(status.reason).headline
    : "The receipt registry is not ready right now.";
}

function tokenEvidenceStatusLabel(status: TokenEvidenceStatus | null): string {
  if (!status) return "Token data status unavailable";
  return status.status === "complete" ? "Full token data ready" : "Token data limited";
}

function tokenEvidenceStatusLine(status: TokenEvidenceStatus | null): string {
  if (!status) return "AgentPay could not read the current token-data coverage.";
  if (status.status === "complete") {
    return "Supply controls, contract age, holder count, and top-holder share are available.";
  }
  return "Supply controls are available. Contract age and holder checks are unavailable right now.";
}

function formatStatusTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "just now";
}

// -------------------------------------------------------------- pieces

function StatCard({
  value,
  line,
  href,
  hash,
  hashLabel,
  icon,
}: {
  value: string;
  line: string;
  href?: string;
  hash?: string;
  hashLabel?: string;
  icon?: ReactNode;
}) {
  const settled = useSettled();
  return (
    <motion.article className="lp2-statcard" variants={settled ? undefined : ITEM_VARIANTS}>
      {icon ? <span className="lp2-statcard-icon" aria-hidden="true">{icon}</span> : null}
      <span className="lp2-statcard-value">{value}</span>
      <p className="lp2-statcard-line">{line}</p>
      {hash && hashLabel ? (
        <div className="lp2-statcard-hash">
          <CopyHash value={hash} label={hashLabel} />
          {href ? (
            <a className="lp2-statcard-link" href={href} target="_blank" rel="noreferrer" aria-label="Open on Casper Testnet explorer">
              <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </motion.article>
  );
}

// A compact checklist of what AgentPay evaluates. It is deliberately not a
// sample result: no provider, amount, or verdict is invented for the landing.
function HeroArtifact() {
  return (
    <figure className="lp2-audit">
      <figcaption className="lp2-audit-tag">
        <span className="lp2-audit-tag-dotless">What AgentPay checks</span>
        <span className="lp2-audit-tag-sep" aria-hidden="true">·</span>
        <span>before signing</span>
      </figcaption>
      <div className="lp2-audit-frame">
        <div className="lp2-audit-head">
          <div>
            <span className="lp2-audit-kicker">x402 payment request</span>
            <p className="lp2-audit-charge">Read the terms before the wallet signs.</p>
          </div>
        </div>

        <dl className="lp2-audit-meta">
          <div>
            <dt>Provider</dt>
            <dd>Domain and payee</dd>
          </div>
          <div>
            <dt>Charge</dt>
            <dd>Amount and token</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>Your limits</dd>
          </div>
        </dl>

        <ul className="lp2-audit-reasons">
          <li className="is-none">
            <CheckCircle size={16} weight="regular" aria-hidden="true" />
            <span>Does this service control the payment destination?</span>
          </li>
          <li className="is-none">
            <CheckCircle size={16} weight="regular" aria-hidden="true" />
            <span>Are the amount, token, network, and expiry allowed?</span>
          </li>
          <li className="is-none">
            <CheckCircle size={16} weight="regular" aria-hidden="true" />
            <span>Has the request changed or already been used?</span>
          </li>
          <li className="is-none">
            <MinusCircle size={16} weight="regular" aria-hidden="true" />
            <span>Anything AgentPay cannot verify is listed clearly.</span>
          </li>
        </ul>

        <p className="lp2-audit-foot">
          <ShieldCheck size={14} weight="bold" aria-hidden="true" />
          The answer is PAY, REVIEW, or BLOCK, with reasons.
        </p>
      </div>
    </figure>
  );
}

// ---------------------------------------------------- stagger helpers

const STAGGER_CONTAINER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

function Stagger({ className, children }: { className?: string; children: ReactNode }) {
  const settled = useSettled();
  if (settled) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      variants={STAGGER_CONTAINER}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-14% 0px -14% 0px" }}
    >
      {children}
    </motion.div>
  );
}

function StaggerItem({
  as = "div",
  className,
  children,
}: {
  as?: "div" | "article";
  className?: string;
  children: ReactNode;
}) {
  const settled = useSettled();
  if (settled) {
    if (as === "article") return <article className={className}>{children}</article>;
    return <div className={className}>{children}</div>;
  }
  const Comp = as === "article" ? motion.article : motion.div;
  return (
    <Comp className={className} variants={ITEM_VARIANTS}>
      {children}
    </Comp>
  );
}
