import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef, type MouseEvent } from "react";
import { Moon, Sun, ArrowSquareOut } from "@phosphor-icons/react";
import { AgentPayLogo } from "../components/AgentPayLogo";
import {
  AgentPayButton,
  AgentPayCodeBlock,
  AgentPayIconAction,
} from "../components/AgentPayUi";
import { RUN, short } from "./desk-data";
import { DeskFeed } from "./desk-feed";
import { DeskFooter } from "./DeskFooter";
import { PROOF_EDGES, PROOF_PROVENANCE, shortHash } from "../trust/proof-evidence";
import type { LandingVariantProps } from "./types";
import "./desk.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const HERO_VERDICTS = [
  { aspect: "clear", label: "CLEAR", line: "The basics check out. Proceed on your own judgment." },
  { aspect: "caution", label: "CAUTION", line: "Not proven either way. Look closer first." },
  { aspect: "danger", label: "DANGER", line: "Something here can cost you. The lamp stays red." }
] as const;

const STAGES = [
  {
    name: "Quote",
    body: "The desk assembles a report from live Casper RPC and CSPR.trade observations, then prices it in CSPR with an expiry and a dataset root.",
  },
  {
    name: "Settle x402",
    body: "The report stays locked behind HTTP 402 until the agent answers the same quote with a signed x402 payment payload.",
  },
  {
    name: "Verify",
    body: "The released report carries a Merkle path that must land exactly on the quoted dataset root.",
  },
  {
    name: "Record",
    body: "The decision, report hash, and payment receipt hash are written to the AgentPayRegistry contract on Casper testnet.",
  },
] as const;

const TRUST_PASS_USE_CASES = [
  {
    label: "Before a swap",
    title: "Check the token",
    body: "Look up a symbol or package hash, then buy a verdict backed by the evidence root it was quoted with.",
  },
  {
    label: "Before a deal",
    title: "Check the wallet",
    body: "Paste a Casper account or public key and get an account-control read before sending funds or API access.",
  },
] as const;

const TRUST_PASS_RECEIPT = [
  { label: "Decision", value: "CAUTION" },
  { label: "Dataset root", value: short(RUN.datasetRoot, 10, 8) },
  { label: "x402 receipt", value: short(RUN.receiptHash, 10, 8) },
  { label: "Casper record", value: short(RUN.deployHash, 10, 8) },
] as const;

const QUOTE_ARTIFACT = `{
  "quoteId": "${RUN.quoteId}",
  "datasetRoot": "${RUN.datasetRoot}",
  "amount": "${RUN.amount}",
  "expiresAt": "${RUN.expiresAt}"
}`;

const PAYLOAD_ARTIFACT = `{
  "scheme": "x402",
  "network": "${RUN.network}",
  "quoteId": "${RUN.quoteId}",
  "payTo": "${short(RUN.payTo, 21, 8)}",
  "amount": "${RUN.amountMotes}",
  "signature": "${short(RUN.signature, 16, 12)}"
}`;

const RECEIPT_ARTIFACT = `AgentPayRegistry · ${RUN.network}
decision  approve
report    ${RUN.reportHash}
receipt   ${RUN.receiptHash}
deploy    ${short(RUN.deployHash, 16, 12)}
block     ${RUN.blockHeight}`;

const BEATS = [
  {
    title: "Before payment",
    body: "You hold a quote and a dataset root. The desk has already committed to exactly what it will sell, at what price in CSPR, and until when.",
    caption: `quote · ${RUN.quoteId}`,
    artifact: QUOTE_ARTIFACT,
  },
  {
    title: "At payment",
    body: "You hand over a signed x402 settlement payload. It answers the quoted terms field for field, and settlement is the only thing that unlocks the report.",
    caption: "x402 settlement payload",
    artifact: PAYLOAD_ARTIFACT,
  },
  {
    title: "After payment",
    body: "You hold the proof. The Merkle path lands on the quoted root, and the decision, report hash, and receipt hash sit on the AgentPayRegistry contract on Casper testnet.",
    caption: "registry receipt",
    artifact: RECEIPT_ARTIFACT,
  },
] as const;

export default function LandingDesk({
  onOpenApp,
  onOpenTrust,
  onOpenFeed,
  onOpenAgents,
  onOpenCounterparty,
  theme,
  onToggleTheme
}: LandingVariantProps) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-rise]", {
          autoAlpha: 0,
          y: 18,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.09,
          delay: 0.05,
          clearProps: "all",
        });
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, {
            autoAlpha: 0,
            y: 16,
            duration: 0.6,
            ease: "power2.out",
            clearProps: "all",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });
      });

      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          desktop: "(min-width: 1000px)",
        },
        (ctx) => {
          const { motion, desktop } = ctx.conditions as {
            motion: boolean;
            desktop: boolean;
          };
          if (!motion) return;

          const rail = scope.current?.querySelector<HTMLElement>(".lv-desk-rail");
          const fill = scope.current?.querySelector<HTMLElement>(".lv-desk-railfill");
          const stops = gsap.utils.toArray<HTMLElement>(".lv-desk-stop");
          if (!rail || !fill) return;

          rail.classList.add("is-armed");
          gsap.set(fill, desktop ? { scaleX: 0 } : { scaleY: 0 });

          const railTl = gsap.timeline({
            scrollTrigger: {
              trigger: ".lv-desk-railsec",
              start: desktop ? "top top" : "top 70%",
              end: desktop ? "+=1700" : "bottom 55%",
              pin: desktop,
              scrub: 0.4,
              onUpdate: (self) => {
                const idx = Math.min(3, Math.floor(self.progress * 4.2));
                stops.forEach((stop, i) =>
                  stop.classList.toggle("is-on", i <= idx),
                );
              },
            },
          });
          railTl.to(fill, {
            ...(desktop ? { scaleX: 1 } : { scaleY: 1 }),
            ease: "none",
            duration: 1,
          });

          return () => {
            rail.classList.remove("is-armed");
            stops.forEach((stop) => stop.classList.remove("is-on"));
            gsap.set(fill, { clearProps: "all" });
          };
        },
      );
    },
    { scope },
  );

  const onRailLink = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById("lv-desk-rail-sec");
    if (!target) return;
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="lv-desk" ref={scope}>
      <header className="lv-desk-nav">
        <div className="lv-desk-shell lv-desk-navrow">
          <span className="lv-desk-brand">
            <AgentPayLogo className="lv-desk-logo" decorative />
            <span className="lv-desk-brandword">AgentPay</span>
          </span>
          <nav className="lv-desk-navlinks" aria-label="AgentPay sections">
            <button type="button" className="lv-desk-navlink" onClick={onOpenTrust}>
              Check a token
            </button>
            {onOpenCounterparty ? (
              <button type="button" className="lv-desk-navlink" onClick={onOpenCounterparty}>
                Check a wallet
              </button>
            ) : null}
            <button type="button" className="lv-desk-navlink" onClick={onOpenAgents}>
              Agent docs
            </button>
            <button type="button" className="lv-desk-navlink" onClick={onOpenFeed}>
              Recent checks
            </button>
          </nav>
          <span className="lv-desk-navrule" aria-hidden="true" />
          <AgentPayIconAction
            label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            onClick={onToggleTheme}
          >
            {theme === "light" ? (
              <Moon size={17} weight="bold" aria-hidden="true" />
            ) : (
              <Sun size={17} weight="bold" aria-hidden="true" />
            )}
          </AgentPayIconAction>
          <AgentPayButton
            type="button"
            variant="secondary"
            className="lv-desk-btn lv-desk-nav-cta"
            onClick={onOpenApp}
          >
            Open the console
          </AgentPayButton>
        </div>
      </header>

      <section className="lv-desk-hero">
        <div className="lv-desk-shell lv-desk-herogrid">
          <div className="lv-desk-herocopy">
            <p className="lv-desk-name" data-rise>
              AgentPay Trust Pass <span className="dim">· check a token or wallet before you trust it</span>
            </p>
            <h1 className="agentpay-sr-only">
              AgentPay Trust Pass: buy a proven CLEAR, CAUTION or DANGER verdict on any Casper token or wallet
            </h1>
            <div className="lv-desk-manifesto" aria-hidden="false">
              {HERO_VERDICTS.map((v) => (
                <button
                  key={v.aspect}
                  type="button"
                  className={`lv-desk-verdict lv-desk-verdict--${v.aspect}`}
                  onClick={onOpenTrust}
                  data-rise
                >
                  <span className="lv-desk-verdict-word">{v.label}</span>
                  <span className="lv-desk-verdict-line">{v.line}</span>
                </button>
              ))}
            </div>
            <p className="lv-desk-lede" data-rise>
              AgentPay sells evidence, not trust by assertion. It buys live Casper observations over x402,
              folds every proof onto the root it quoted, and returns a Trust Pass anyone can re-check later.
            </p>
            <div className="lv-desk-ctarow" data-rise>
              <AgentPayButton
                type="button"
                variant="primary"
                className="lv-desk-btn lv-desk-btn-primary"
                onClick={onOpenTrust}
              >
                Check a token
              </AgentPayButton>
              <button type="button" className="lv-desk-herolink" onClick={onOpenApp}>
                Open the console
              </button>
              <a
                className="lv-desk-herolink"
                href="#lv-desk-rail-sec"
                onClick={onRailLink}
              >
                How the rail runs
              </a>
            </div>
          </div>
          <div className="lv-desk-heropanel" data-rise>
            <DeskFeed />
            <p className="lv-desk-panelnote">
              An example run, in the exact order the desk executes it.
            </p>
          </div>
        </div>
      </section>

      <section className="lv-desk-passsec" aria-labelledby="lv-desk-pass-title">
        <div className="lv-desk-shell lv-desk-passgrid">
          <div className="lv-desk-passcopy">
            <p className="lv-desk-eyebrow">Consumer Trust Pass</p>
            <h2 className="lv-desk-h2" id="lv-desk-pass-title">
              A verdict people can carry, not a log agents forget.
            </h2>
            <p className="lv-desk-sub">
              The consumer product is simple: check the thing you are about to trust, get CLEAR,
              CAUTION, or DANGER, and keep the proof packet that explains what was paid for and
              what landed on Casper.
            </p>
            <div className="lv-desk-passactions">
              <AgentPayButton
                type="button"
                variant="primary"
                className="lv-desk-btn lv-desk-btn-primary"
                onClick={onOpenTrust}
              >
                Check a token
              </AgentPayButton>
              {onOpenCounterparty ? (
                <button type="button" className="lv-desk-herolink" onClick={onOpenCounterparty}>
                  Check a wallet
                </button>
              ) : null}
            </div>
          </div>
          <div className="lv-desk-passpanel" aria-label="Example AgentPay Trust Pass receipt">
            <div className="lv-desk-passpanel-head">
              <span>AgentPay Trust Pass</span>
              <span>re-checkable</span>
            </div>
            <div className="lv-desk-passverdict">
              <span>CAUTION</span>
              <p>Evidence passed, but one signal was unavailable. The missing field stays explicit.</p>
            </div>
            <ol className="lv-desk-passcases">
              {TRUST_PASS_USE_CASES.map((item) => (
                <li key={item.title}>
                  <span>{item.label}</span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </li>
              ))}
            </ol>
            <dl className="lv-desk-passreceipt">
              {TRUST_PASS_RECEIPT.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="lv-desk-railsec" id="lv-desk-rail-sec">
        <div className="lv-desk-shell">
          <div className="lv-desk-railhead">
            <h2 className="lv-desk-h2">One rail, four stops, always in order.</h2>
            <p className="lv-desk-sub">
              Every report the desk sells moves through the same sequence.
              Nothing unlocks early, and nothing is paid blind.
            </p>
          </div>
          <div className="lv-desk-rail">
            <div className="lv-desk-railline" aria-hidden="true">
              <span className="lv-desk-railfill" />
            </div>
            <ol className="lv-desk-stops">
              {STAGES.map((stage, i) => (
                <li
                  className={`lv-desk-stop ${i % 2 === 0 ? "is-above" : "is-below"}`}
                  key={stage.name}
                >
                  <span className="lv-desk-stoptick" aria-hidden="true" />
                  <div className="lv-desk-stopbody">
                    <h3 className="lv-desk-stopname">
                      <span className="lv-desk-stopnum">{i + 1}</span>
                      {stage.name}
                    </h3>
                    <p>{stage.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="lv-desk-proofsec">
        <div className="lv-desk-shell">
          <div className="lv-desk-proofhead" data-reveal>
            <h2 className="lv-desk-h2">What you hold, at every step.</h2>
            <p className="lv-desk-sub">
              The proof model is symmetric around payment: inspect what the
              desk committed to before you pay, and check what it delivered
              after.
            </p>
          </div>
          <div className="lv-desk-beats">
            {BEATS.map((beat) => (
              <article className="lv-desk-beat" data-reveal key={beat.title}>
                <div className="lv-desk-beattext">
                  <h3>{beat.title}</h3>
                  <p>{beat.body}</p>
                </div>
                <figure className="lv-desk-artifact">
                  <figcaption>{beat.caption}</figcaption>
                  <AgentPayCodeBlock className="whitespace-pre">{beat.artifact}</AgentPayCodeBlock>
                </figure>
              </article>
            ))}
          </div>

          <div className="lv-desk-verify" data-reveal>
            <p className="lv-desk-verifylead">
              The walkthrough above is illustrative. A real run lands on Casper Testnet, and you can re-check it yourself.
            </p>
            <ul className="lv-desk-verifylist">
              {PROOF_EDGES.map((edge) => (
                <li className="lv-desk-verifyrow" key={edge.hash}>
                  <span className="lv-desk-verifylabel">{edge.label}</span>
                  <a className="lv-desk-verifylink" href={edge.href} target="_blank" rel="noreferrer">
                    <code>{shortHash(edge.hash)}</code>
                    <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
            <p className="lv-desk-verifynote">{PROOF_PROVENANCE}</p>
          </div>
        </div>
      </section>

      <section className="lv-desk-closing">
        <div className="lv-desk-shell lv-desk-closeinner" data-reveal>
          <h2 className="lv-desk-h2">Put an agent on the desk.</h2>
          <p className="lv-desk-sub">
            Launch AgentPay, request a quote, and pay only when the proof lands
            on the root you were quoted.
          </p>
          <AgentPayButton
            type="button"
            variant="primary"
            className="lv-desk-btn lv-desk-btn-primary"
            onClick={onOpenApp}
          >
            Open the console
          </AgentPayButton>
        </div>
      </section>

      <DeskFooter onOpenApp={onOpenApp} onOpenTrust={onOpenTrust} onOpenFeed={onOpenFeed} onOpenAgents={onOpenAgents} />
    </div>
  );
}
