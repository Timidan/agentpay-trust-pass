import { useEffect, useState } from "react";
import { CinematicChrome } from "../CinematicChrome";
import { CinematicRail } from "../CinematicRail";
import type { CinematicRailItem } from "../types";
import { useCinematicTimeline } from "../useCinematicTimeline";
import "./signal-field.css";

const signalAnatomy = [
  {
    id: "terms",
    eyebrow: "01 · Intent",
    title: "Terms",
    body: "What the charge requests.",
    href: "/audit",
  },
  {
    id: "policy",
    eyebrow: "02 · Decision",
    title: "Policy",
    body: "What the agent may approve.",
    href: "/audit",
  },
  {
    id: "wallet-boundary",
    eyebrow: "03 · Authority",
    title: "Wallet boundary",
    body: "Where the key stays local.",
    href: "/agents",
  },
  {
    id: "settlement",
    eyebrow: "04 · Execution",
    title: "Settlement",
    body: "What the network finalized.",
    href: "/app",
  },
  {
    id: "receipt",
    eyebrow: "05 · Proof",
    title: "Receipt",
    body: "What remains verifiable.",
    href: "/app",
  },
] as const satisfies readonly CinematicRailItem[];

const FINAL_RAIL_INTERACTIVE_PROGRESS = 0.88;

export default function SignalFieldPage() {
  const { reducedMotion, sectionRef, stageRef } = useCinematicTimeline({ smoothing: 0.16 });
  const [finalRailInteractive, setFinalRailInteractive] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setFinalRailInteractive(true);
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;

    const syncInteractivity = () => {
      const parsedProgress = Number.parseFloat(
        stage.style.getPropertyValue("--cinematic-p") || "0",
      );
      const progress = Number.isFinite(parsedProgress) ? parsedProgress : 0;
      setFinalRailInteractive(progress >= FINAL_RAIL_INTERACTIVE_PROGRESS);
    };

    syncInteractivity();
    const observer = new MutationObserver(syncInteractivity);
    observer.observe(stage, { attributeFilter: ["style"], attributes: true });

    return () => observer.disconnect();
  }, [reducedMotion, stageRef]);

  return (
    <main className="cinematic-page signal-field">
      <section className="cinematic-scroll" ref={sectionRef} aria-label="AgentPay signal field">
        <section
          className="cinematic-stage sf-stage"
          data-motion={reducedMotion ? "reduced" : "full"}
          ref={stageRef}
        >
          <CinematicChrome current="signal-field" progressLabel="Noise to signal" />

          <div className="cinematic-world-layer sf-world" data-cinematic-layer aria-hidden="true">
            <div className="sf-haze sf-haze--upper" />
            <div className="sf-haze sf-haze--lower" />

            <div className="sf-membranes">
              <div className="sf-membrane sf-membrane--one"><span /></div>
              <div className="sf-membrane sf-membrane--two"><span /></div>
              <div className="sf-membrane sf-membrane--three"><span /></div>
              <div className="sf-membrane sf-membrane--four"><span /></div>
              <div className="sf-membrane sf-membrane--five"><span /></div>
            </div>

            <div className="sf-orbit sf-orbit--wide">
              <span /><span /><span /><span />
            </div>
            <div className="sf-orbit sf-orbit--tight">
              <span /><span /><span />
            </div>

            <svg className="sf-proof-glyph" viewBox="0 0 260 260" focusable="false">
              <defs>
                <radialGradient id="sf-proof-core" cx="34%" cy="27%" r="76%">
                  <stop offset="0" stopColor="#fff" stopOpacity=".98" />
                  <stop offset=".24" stopColor="#dcd4ff" stopOpacity=".94" />
                  <stop offset=".66" stopColor="#8f78ff" stopOpacity=".8" />
                  <stop offset="1" stopColor="#392451" stopOpacity=".9" />
                </radialGradient>
                <linearGradient id="sf-proof-ring" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity=".92" />
                  <stop offset=".48" stopColor="#ab96ff" stopOpacity=".7" />
                  <stop offset="1" stopColor="#5c3a76" stopOpacity=".36" />
                </linearGradient>
                <filter id="sf-proof-glow" x="-70%" y="-70%" width="240%" height="240%">
                  <feGaussianBlur stdDeviation="7" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <circle className="sf-proof-glyph__halo" cx="130" cy="130" r="116" />
              <circle className="sf-proof-glyph__ring" cx="130" cy="130" r="83" />
              <circle className="sf-proof-glyph__core" cx="130" cy="130" r="57" />
              <path className="sf-proof-glyph__trace" d="M58 130h36l14-24 23 48 20-40 13 16h38" />
              <text className="sf-proof-glyph__mark" x="130" y="139" textAnchor="middle">AP</text>
              <path className="sf-proof-glyph__check" d="m159 167 10 10 22-28" />
            </svg>

            <div className="sf-resolved-signal">
              <span className="sf-resolved-signal__line" />
              <span className="sf-resolved-signal__pulse" />
            </div>
            <div className="sf-grain" />
          </div>

          <figure className="sf-static-signal" data-cinematic-content aria-hidden="true">
            <svg viewBox="0 0 720 260" focusable="false">
              <defs>
                <linearGradient id="sf-static-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#a78bfa" stopOpacity="0" />
                  <stop offset=".28" stopColor="#a78bfa" stopOpacity=".68" />
                  <stop offset=".5" stopColor="#ede9fe" />
                  <stop offset=".72" stopColor="#a78bfa" stopOpacity=".68" />
                  <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
                </linearGradient>
                <radialGradient id="sf-static-core" cx="35%" cy="28%" r="74%">
                  <stop offset="0" stopColor="#fff" />
                  <stop offset=".32" stopColor="#ddd6fe" />
                  <stop offset="1" stopColor="#7c5ce2" />
                </radialGradient>
              </defs>
              <path className="sf-static-signal__line" d="M40 130h640" />
              <ellipse className="sf-static-signal__orbit" cx="360" cy="130" rx="128" ry="74" />
              <circle className="sf-static-signal__core" cx="360" cy="130" r="48" />
              <text className="sf-static-signal__mark" x="360" y="139" textAnchor="middle">AP</text>
              <path className="sf-static-signal__check" d="m386 160 9 9 20-25" />
            </svg>
          </figure>

          <section className="cinematic-narrative-layer sf-opening" data-cinematic-content>
            <p className="sf-kicker">Autonomous payment · before the receipt</p>
            <h1>Every payment leaves a shape.</h1>
            <p className="sf-opening__note">Terms. Authority. Settlement. Proof.</p>
            {!reducedMotion && <p className="sf-scroll-cue">Find the signal <span aria-hidden="true">↓</span></p>}
          </section>

          <div
            className="cinematic-interaction-layer sf-final"
            data-cinematic-content
            inert={finalRailInteractive ? undefined : true}
          >
            <div className="sf-final__copy">
              <p className="sf-kicker">One payment · five readable parts</p>
              <h2>AgentPay makes it legible.</h2>
            </div>
            <CinematicRail ariaLabel="Signal anatomy" items={signalAnatomy} />
          </div>
        </section>
      </section>
    </main>
  );
}
