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
  theme,
  onToggleTheme
}: LandingVariantProps) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      // Entrance and scroll reveals: motion-gated, content visible by default.
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

      // The rail: one flow line, highlighted stage by stage on scroll.
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
            variant="ghost"
            className="lv-desk-btn lv-desk-btn-quiet"
            onClick={onOpenTrust}
          >
            Check a token
          </AgentPayButton>
          <AgentPayButton
            type="button"
            variant="ghost"
            className="lv-desk-btn lv-desk-btn-quiet"
            onClick={onOpenAgents}
          >
            Agent docs
          </AgentPayButton>
          <AgentPayButton
            type="button"
            variant="ghost"
            className="lv-desk-btn lv-desk-btn-quiet"
            onClick={onOpenFeed}
          >
            Recent checks
          </AgentPayButton>
          <AgentPayButton
            type="button"
            variant="secondary"
            className="lv-desk-btn lv-desk-btn-quiet"
            onClick={onOpenApp}
          >
            Open app
          </AgentPayButton>
        </div>
      </header>

      <section className="lv-desk-hero">
        <div className="lv-desk-shell lv-desk-herogrid">
          <div className="lv-desk-herocopy">
            <p className="lv-desk-name" data-rise>
              AgentPay <span className="dim">· an evidence desk for autonomous agents</span>
            </p>
            <h1 className="lv-desk-display" data-rise>
              Only proven evidence clears onto Casper.
            </h1>
            <p className="lv-desk-lede" data-rise>
              AgentPay is an x402-paid evidence desk on Casper: it assembles
              reports from live Casper RPC and CSPR.trade observations, and
              quotes each one in CSPR with an expiry and a committed dataset
              root.
            </p>
            <p className="lv-desk-lede" data-rise>
              The report stays behind HTTP 402 until a signed x402 payment
              settles it, and every released proof must land on that exact root
              before the decision is recorded on Casper testnet.
            </p>
            <div className="lv-desk-ctarow" data-rise>
              <AgentPayButton
                type="button"
                variant="primary"
                className="lv-desk-btn lv-desk-btn-primary"
                onClick={onOpenApp}
              >
                Launch AgentPay
              </AgentPayButton>
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
              A full settlement run, replayed exactly as the desk executes it.
            </p>
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
                  <span className="lv-desk-stopdot" aria-hidden="true" />
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
              The walkthrough above is illustrative &mdash; but a real run is on Casper Testnet. Re-check it yourself.
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
            Launch AgentPay
          </AgentPayButton>
        </div>
      </section>

      <DeskFooter onOpenApp={onOpenApp} onOpenTrust={onOpenTrust} onOpenFeed={onOpenFeed} onOpenAgents={onOpenAgents} />
    </div>
  );
}
