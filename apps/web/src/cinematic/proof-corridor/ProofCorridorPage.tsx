import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { CinematicChrome } from "../CinematicChrome";
import { CinematicRail } from "../CinematicRail";
import type { CinematicRailItem } from "../types";
import { useCinematicTimeline } from "../useCinematicTimeline";
import {
  IconCheck,
  IconReceiptAnchored,
  IconSignLocally,
  IconVerify,
} from "../../landing2/icons";
import "./proof-corridor.css";

const workflowStations = [
  { id: "check", label: "Check terms", Icon: IconCheck },
  { id: "sign", label: "Sign locally", Icon: IconSignLocally },
  { id: "verify", label: "Verify settlement", Icon: IconVerify },
  { id: "receipt", label: "Finalize receipt", Icon: IconReceiptAnchored },
] as const;

const finalLinks = [
  {
    id: "payment-checker",
    eyebrow: "01 · Inspect",
    title: "Payment checker",
    body: "Review an x402 charge before the wallet signs.",
    href: "/audit",
  },
  {
    id: "token-check",
    eyebrow: "02 · Evidence",
    title: "Token check",
    body: "Inspect indexed and native Casper token evidence.",
    href: "/check",
  },
  {
    id: "wallet-check",
    eyebrow: "03 · Counterparty",
    title: "Wallet check",
    body: "Review the account on the other side of a payment.",
    href: "/counterparty",
  },
  {
    id: "agents",
    eyebrow: "04 · Integrate",
    title: "Agents",
    body: "Use scoped tools without handing over a signing key.",
    href: "/agents",
  },
  {
    id: "console",
    eyebrow: "05 · Operate",
    title: "Console",
    body: "Follow a quote through x402 settlement, Merkle verification, and the registry workflow.",
    href: "/app",
  },
] as const satisfies readonly CinematicRailItem[];

const FINAL_RAIL_INTERACTIVE_PROGRESS = 0.9;

function useFinalRailInteractivity(stageRef: RefObject<HTMLElement | null>, reducedMotion: boolean) {
  const [interactive, setInteractive] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setInteractive(true);
      return;
    }

    const stage = stageRef.current;
    if (!stage) {
      setInteractive(false);
      return;
    }

    const syncInteractivity = () => {
      const rawProgress = stage.style.getPropertyValue("--cinematic-p") || "0";
      const parsedProgress = Number.parseFloat(rawProgress);
      const progress = Number.isFinite(parsedProgress) ? parsedProgress : 0;
      const nextInteractive = progress >= FINAL_RAIL_INTERACTIVE_PROGRESS;

      setInteractive((current) => current === nextInteractive ? current : nextInteractive);
    };

    syncInteractivity();
    const observer = new MutationObserver(syncInteractivity);
    observer.observe(stage, { attributeFilter: ["style"], attributes: true });

    return () => observer.disconnect();
  }, [reducedMotion, stageRef]);

  return interactive;
}

export default function ProofCorridorPage() {
  const { reducedMotion, sectionRef, stageRef } = useCinematicTimeline({ smoothing: 0.1 });
  const finalRailInteractive = useFinalRailInteractivity(stageRef, reducedMotion);

  return (
    <main className="cinematic-page proof-corridor">
      <section className="cinematic-scroll" ref={sectionRef} aria-label="AgentPay checked payment journey">
        <section
          className="cinematic-stage pc-stage"
          data-motion={reducedMotion ? "reduced" : "full"}
          ref={stageRef}
        >
          <CinematicChrome current="proof-corridor" progressLabel="Charge to proof" />

          <div className="cinematic-world-layer pc-world" data-cinematic-layer aria-hidden="true">
            <div className="pc-aurora pc-aurora--near" />
            <div className="pc-aurora pc-aurora--far" />
            <div className="pc-corridor-rings">
              {Array.from({ length: 8 }, (_, index) => (
                <span className={`pc-ring pc-ring--${index + 1}`} key={index} />
              ))}
            </div>
            <div className="pc-corridor-wall pc-corridor-wall--left" />
            <div className="pc-corridor-wall pc-corridor-wall--right" />
            <div className="pc-proof-beam">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="pc-grain" />
          </div>

          <ol className="cinematic-narrative-layer pc-stations" aria-label="Checked payment workflow">
            {workflowStations.map(({ Icon, id, label }, index) => (
              <li className={`pc-station pc-station--${id}`} key={id}>
                <span className="pc-station__number">0{index + 1}</span>
                <Icon className="pc-station__icon" size={44} />
                <span className="pc-station__label">{label}</span>
              </li>
            ))}
          </ol>

          <section className="cinematic-narrative-layer pc-story-panel pc-opening" data-cinematic-content>
            <p className="pc-kicker">A checked x402 payment · start to finish</p>
            <h1>The path from charge to proof.</h1>
            <p className="pc-lede">
              Inspect the request, apply policy, sign at the wallet boundary, then match the settlement
              to a receipt you can verify.
            </p>
            {!reducedMotion && (
              <p className="pc-scroll-cue">
                Enter the corridor <span aria-hidden="true">↓</span>
              </p>
            )}
          </section>

          <article className="cinematic-narrative-layer pc-request-card" data-cinematic-content aria-label="Illustrative payment request">
            <header className="pc-request-card__header">
              <span>x402 · payment required</span>
              <span className="pc-request-card__state">Unsigned</span>
            </header>
            <div className="pc-request-card__title-row">
              <div className="pc-request-card__mark" aria-hidden="true">AP</div>
              <div>
                <p>Bound request</p>
                <h2>Premium dataset access</h2>
              </div>
            </div>
            <dl className="pc-request-card__terms">
              <div><dt>Method</dt><dd>GET</dd></div>
              <div><dt>Amount</dt><dd>Bound to quote</dd></div>
              <div><dt>Asset</dt><dd>Casper package hash</dd></div>
              <div><dt>Network</dt><dd>Casper Testnet</dd></div>
              <div><dt>Payee</dt><dd>Exact address</dd></div>
            </dl>
            <footer>
              <span className="pc-request-card__pulse" aria-hidden="true" />
              Waiting for AgentPay check
            </footer>
          </article>

          <section className="cinematic-narrative-layer pc-story-panel pc-check" data-cinematic-content>
            <p className="pc-kicker">01 · Check before signing</p>
            <h2>The charge meets policy—or it stops here.</h2>
            <p>
              AgentPay binds the x402 terms to the original request, loads Casper token evidence, and
              returns one explicit decision.
            </p>
            <ul className="pc-verdicts" aria-label="Possible payment decisions">
              <li className="pc-verdict pc-verdict--pay"><strong>PAY</strong><span>Terms and policy align</span></li>
              <li className="pc-verdict pc-verdict--review"><strong>REVIEW</strong><span>Operator attention needed</span></li>
              <li className="pc-verdict pc-verdict--block"><strong>BLOCK</strong><span>Do not authorize</span></li>
            </ul>
          </section>

          <section className="cinematic-narrative-layer pc-story-panel pc-signing" data-cinematic-content>
            <p className="pc-kicker">02 · Sign, then settle</p>
            <h2>Your wallet signs. AgentPay never receives the key.</h2>
            <p>
              Only a PAY decision advances to the browser wallet. The client retries the authorized
              payment and watches for its Casper settlement.
            </p>
            <div className="pc-boundary" aria-label="Wallet signing boundary">
              <span>AgentPay</span><span aria-hidden="true">→</span><strong>Your wallet</strong>
            </div>
          </section>

          <section className="cinematic-narrative-layer pc-story-panel pc-receipt" data-cinematic-content>
            <p className="pc-kicker">03 · Verify and remember</p>
            <h2>Approved terms meet the executed transaction.</h2>
            <p>
              AgentPay compares the network, asset, payer, payee, amount, authorization digest,
              execution, and finality. One bounded response then finalizes an immutable receipt.
            </p>
            <div className="pc-anchor">
              <div className="pc-anchor__seal" aria-hidden="true">
                <span>CASPER</span><strong>✓</strong><span>TESTNET</span>
              </div>
              <p>
                The receipt hash verifies offline and, when configured, can be anchored on Casper Testnet.
              </p>
            </div>
          </section>

          <div
            className="cinematic-interaction-layer pc-final"
            data-cinematic-content
            inert={finalRailInteractive ? undefined : true}
          >
            <div className="pc-final__heading">
              <p className="pc-kicker">The proof is yours</p>
              <h2>Choose where to inspect next.</h2>
            </div>
            <CinematicRail ariaLabel="AgentPay product destinations" items={finalLinks} />
          </div>
        </section>
      </section>
    </main>
  );
}
