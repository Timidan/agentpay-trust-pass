import { useEffect, useState } from "react";
import { CinematicChrome } from "../CinematicChrome";
import { CinematicRail } from "../CinematicRail";
import type { CinematicRailItem } from "../types";
import { useCinematicTimeline } from "../useCinematicTimeline";
import {
  IconCheck,
  IconProbe,
  IconReceiptAnchored,
  IconVerify,
} from "../../landing2/icons";
import "./evidence-chamber.css";

const auditLayers = [
  {
    id: "binding",
    eyebrow: "01 · Capture",
    title: "Request binding",
    detail: "Method + URL + 402 body",
    Icon: IconProbe,
  },
  {
    id: "terms",
    eyebrow: "02 · Terms",
    title: "Charge terms",
    detail: "Amount · asset · network · payee",
    Icon: IconCheck,
  },
  {
    id: "policy",
    eyebrow: "03 · Policy",
    title: "Spend controls",
    detail: "Limits + provider rules",
    Icon: IconCheck,
  },
  {
    id: "authorization",
    eyebrow: "04 · Authority",
    title: "Payer authorization",
    detail: "Wallet boundary · not yet signed",
    Icon: IconProbe,
  },
  {
    id: "settlement",
    eyebrow: "05 · Verify",
    title: "Settlement match",
    detail: "Executed transfer vs. approved terms",
    Icon: IconVerify,
  },
  {
    id: "receipt",
    eyebrow: "06 · Record",
    title: "Receipt anchor",
    detail: "Receipt hash + Casper readback",
    Icon: IconReceiptAnchored,
  },
] as const;

const finalLinks = [
  {
    id: "audit",
    eyebrow: "01 · Check",
    title: "Open payment checker",
    body: "Inspect a captured x402 charge before the wallet signs.",
    href: "/audit",
  },
  {
    id: "agents",
    eyebrow: "02 · Integrate",
    title: "Agent integration",
    body: "Use the MCP, HTTP, CLI, or TypeScript surfaces.",
    href: "/agents",
  },
  {
    id: "console",
    eyebrow: "03 · Operate",
    title: "Operations console",
    body: "Follow settlement, verification, and receipt state.",
    href: "/app",
  },
  {
    id: "home",
    eyebrow: "04 · Overview",
    title: "AgentPay home",
    body: "Return to the checked-payment overview.",
    href: "/",
  },
] as const satisfies readonly CinematicRailItem[];

const FINAL_RAIL_INTERACTIVE_PROGRESS = 0.95;

export default function EvidenceChamberPage() {
  const { reducedMotion, sectionRef, stageRef } = useCinematicTimeline({ smoothing: 0.11 });
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
    <main className="cinematic-page evidence-chamber">
      <section
        className="cinematic-scroll"
        ref={sectionRef}
        aria-label="AgentPay payment evidence audit"
      >
        <section
          className="cinematic-stage ec-stage"
          data-motion={reducedMotion ? "reduced" : "full"}
          ref={stageRef}
        >
          <CinematicChrome current="evidence-chamber" progressLabel="Request to evidence" />

          <div className="cinematic-world-layer ec-world" data-cinematic-layer aria-hidden="true">
            <div className="ec-room-grid ec-room-grid--floor" />
            <div className="ec-room-grid ec-room-grid--wall" />
            <div className="ec-paper-glow ec-paper-glow--left" />
            <div className="ec-paper-glow ec-paper-glow--right" />
            <div className="ec-plum-sweep" />
            <div className="ec-desk-shadow" />
            <div className="ec-grain" />
          </div>

          <section className="cinematic-narrative-layer ec-panel ec-opening" data-cinematic-content>
            <p className="ec-kicker">Payment audit · evidence before authority</p>
            <h1>Before the wallet signs anything.</h1>
            <p className="ec-lede">
              AgentPay opens the charge into six inspectable checkpoints. A REVIEW decision pauses
              here; it does not authorize payment.
            </p>
            {!reducedMotion && (
              <p className="ec-scroll-cue">
                Open the evidence <span aria-hidden="true">↓</span>
              </p>
            )}
          </section>

          <article
            className="cinematic-narrative-layer ec-request"
            data-cinematic-content
            aria-label="Illustrative payment request under review"
          >
            <header className="ec-request__header">
              <span>x402 · payment required</span>
              <span className="ec-verdict ec-verdict--review">REVIEW</span>
            </header>

            <div className="ec-request__service">
              <span className="ec-request__mark" aria-hidden="true">AP</span>
              <div>
                <p>Captured charge</p>
                <h2>Research archive access</h2>
              </div>
            </div>

            <dl className="ec-request__terms">
              <div><dt>Amount</dt><dd>2.50 CSPR</dd></div>
              <div><dt>Asset</dt><dd>Native CSPR</dd></div>
              <div><dt>Network</dt><dd>Casper Testnet</dd></div>
              <div><dt>Payee</dt><dd>account-hash-8f…2ac1</dd></div>
              <div><dt>Request</dt><dd>GET /archive/report</dd></div>
            </dl>

            <footer className="ec-request__footer">
              <span><i aria-hidden="true" /> Check paused</span>
              <strong>Unsigned</strong>
            </footer>
          </article>

          <ol className="cinematic-narrative-layer ec-evidence" aria-label="Payment audit checkpoints">
            {auditLayers.map(({ Icon, detail, eyebrow, id, title }) => (
              <li className={`ec-evidence__layer ec-evidence__layer--${id}`} key={id}>
                <Icon className="ec-evidence__icon" size={37} />
                <span className="ec-evidence__copy">
                  <span>{eyebrow}</span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <span className="ec-evidence__pin" aria-hidden="true" />
              </li>
            ))}
          </ol>

          <section className="cinematic-narrative-layer ec-panel ec-panel--request" data-cinematic-content>
            <p className="ec-kicker">01 · Exact request</p>
            <h2>Read what is actually being asked.</h2>
            <p>Amount, asset, network, payee, and request binding.</p>
            <dl className="ec-proof-list">
              <div><dt>Capture</dt><dd>Real 402 response</dd></div>
              <div><dt>Bind</dt><dd>Method + URL + charge</dd></div>
              <div><dt>Status</dt><dd>Not signed</dd></div>
            </dl>
          </section>

          <section className="cinematic-narrative-layer ec-panel ec-panel--policy" data-cinematic-content>
            <p className="ec-kicker">02 · Policy decision</p>
            <h2>REVIEW means stop and inspect.</h2>
            <p>PIN / DENY and spend controls</p>
            <ul className="ec-decisions" aria-label="Possible payment decisions">
              <li className="ec-decision ec-decision--pay"><strong>PAY</strong><span>May ask the wallet</span></li>
              <li className="ec-decision ec-decision--review" aria-current="true"><strong>REVIEW</strong><span>Operator attention</span></li>
              <li className="ec-decision ec-decision--block"><strong>BLOCK</strong><span>Do not authorize</span></li>
            </ul>
            <p className="ec-fine-print">A later PAY decision is required before signing can begin.</p>
          </section>

          <section className="cinematic-narrative-layer ec-panel ec-panel--settlement" data-cinematic-content>
            <p className="ec-kicker">03 · After a local signature</p>
            <h2>Compare execution with approval.</h2>
            <p>
              Once the buyer signs and Casper executes the transfer, AgentPay compares that
              transaction with the exact approved terms.
            </p>
            <div className="ec-match-card">
              <IconVerify size={35} />
              <span><strong>Settlement verdicts</strong>match · pending · mismatch · unverifiable</span>
            </div>
          </section>

          <section className="cinematic-narrative-layer ec-panel ec-panel--receipt" data-cinematic-content>
            <p className="ec-kicker">04 · Receipt evidence</p>
            <h2>Keep the body and anchor state distinct.</h2>
            <p>
              The immutable receipt body carries its hash. Casper record status remains a separate,
              refreshable readback.
            </p>
            <div className="ec-anchor-states" aria-label="Receipt anchor states">
              <span>off-chain verified</span><span>pending</span><span>anchored</span><span>failed</span>
            </div>
          </section>

          <article
            className="cinematic-narrative-layer ec-stamped-receipt"
            data-cinematic-content
            aria-label="Illustrative matched payment receipt"
          >
            <header>
              <span>AgentPay · illustrative receipt</span>
              <IconReceiptAnchored size={40} />
            </header>
            <dl>
              <div><dt>Decision</dt><dd>PAY after review</dd></div>
              <div><dt>Settlement</dt><dd className="ec-positive">match</dd></div>
              <div><dt>Receipt hash</dt><dd>8b3d…4e21</dd></div>
              <div><dt>Casper record</dt><dd className="ec-positive">read back</dd></div>
            </dl>
            <div className="ec-stamp" aria-label="Settlement matched stamp">
              <span>Settlement</span>
              <strong>MATCHED</strong>
              <small>Receipt ready</small>
            </div>
          </article>

          <div
            className="cinematic-interaction-layer ec-final"
            data-cinematic-content
            inert={finalRailInteractive ? undefined : true}
          >
            <div className="ec-final__heading">
              <p className="ec-kicker">The evidence remains inspectable</p>
              <h2>Take the next real action.</h2>
            </div>
            <CinematicRail ariaLabel="Evidence Chamber destinations" items={finalLinks} />
          </div>
        </section>
      </section>
    </main>
  );
}
