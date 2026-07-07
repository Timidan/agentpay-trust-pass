import { type FormEvent, useEffect, useState } from "react";
import { CircleNotch, MagnifyingGlass, Warning, ShieldCheck, WarningOctagon } from "@phosphor-icons/react";
import { assessAccount, type Verdict } from "../api";
import { friendlyError } from "../lib/friendly-errors";
import { VerdictCard } from "./VerdictCard";
import "./ask-page.css";

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; verdict: Verdict }
  | { status: "error"; message: string; detail?: string };

// account-hash-<64hex>, or an ed25519 (01…) / secp256k1 (02…) public key.
const ACCOUNT_INPUT = /^(account-hash-[0-9a-f]{64}|01[0-9a-f]{64}|02[0-9a-f]{66})$/i;

const RAIL_STOPS = ["Quote", "Settle x402", "Verify proof", "Record"] as const;

const MEANINGS = [
  {
    aspect: "clear",
    label: "Clear",
    body: "Funded and sanely controlled. Reasonable to transact with.",
    Icon: ShieldCheck,
    color: "var(--aspect-clear-ink)"
  },
  {
    aspect: "caution",
    label: "Caution",
    body: "Thin balance or loose key control. Look closer before you commit.",
    Icon: Warning,
    color: "var(--aspect-caution-ink)"
  },
  {
    aspect: "danger",
    label: "Danger",
    body: "No account at this address, or a control red flag. Don't send.",
    Icon: WarningOctagon,
    color: "var(--aspect-danger-ink)"
  }
] as const;

export default function CounterpartyPage({ onBack, onOpenCheck }: { onBack?: () => void; onOpenCheck?: () => void }) {
  const [account, setAccount] = useState("");
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const [hint, setHint] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const isLoading = state.status === "loading";

  useEffect(() => {
    if (!isLoading) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  async function runCheck(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setHint("Paste an account hash or public key first.");
      return;
    }
    if (!ACCOUNT_INPUT.test(trimmed)) {
      setHint("Enter an account-hash-… or a public key (starts with 01 or 02).");
      return;
    }
    setHint(null);
    setState({ status: "loading" });
    try {
      const verdict = await assessAccount(trimmed);
      setState({ status: "done", verdict });
    } catch (err) {
      const friendly = friendlyError(err);
      setState({ status: "error", message: friendly.headline, detail: friendly.detail });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runCheck(account);
  }

  return (
    <div className="ask2">
      <nav className="ask2-nav" aria-label="AgentPay Trust Signal">
        <div className="ask2-brand">
          <span className="ask2-brand-name">AgentPay</span>
          <span className="ask2-brand-sub">Counterparty</span>
        </div>
        <div className="ask2-navlinks">
          <a href="/" onClick={navClick(onBack)}>Overview</a>
          <a href="/check" onClick={navClick(onOpenCheck)}>Check a token</a>
        </div>
      </nav>

      <div className="ask2-main">
        {state.status === "done" ? (
          <div className="ask2-result ask2-reveal">
            <h1 className="agentpay-sr-only">Counterparty check result</h1>
            <button type="button" className="ask2-again" onClick={() => setState({ status: "idle" })}>
              ← Check another account
            </button>
            <VerdictCard verdict={state.verdict} subjectLabel="Account" />
          </div>
        ) : (
          <div className="ask2-grid">
            <section className="ask2-copy">
              <p className="ask2-kicker">Counterparty check</p>
              <h1 className="ask2-title">Buy a Trust Pass before you deal with the wallet.</h1>
              <p className="ask2-lede">
                Paste a Casper account and the agent reads it on-chain: does it exist, what it holds,
                how its keys are controlled. Then it buys the evidence over x402 and returns a receipt.
              </p>
              <ul className="ask2-meanings">
                {MEANINGS.map((m) => (
                  <li className={`ask2-meaning ask2-meaning--${m.aspect}`} key={m.aspect}>
                    <m.Icon size={16} weight="bold" style={{ color: m.color }} aria-hidden="true" />
                    <div>
                      <span className="ask2-meaning-label" style={{ color: m.color }}>{m.label}</span>
                      <span className="ask2-meaning-body">{m.body}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="ask2-panel">
              <div className="ask2-card">
                <form onSubmit={handleSubmit} noValidate>
                  <label className="ask2-field-label" htmlFor="cp-account">
                    Account hash or public key
                  </label>
                  <input
                    autoComplete="off"
                    className="ask2-input"
                    id="cp-account"
                    maxLength={128}
                    placeholder="account-hash-… or a public key (01…)"
                    spellCheck={false}
                    type="text"
                    value={account}
                    onChange={(e) => {
                      setAccount(e.target.value);
                      if (hint) setHint(null);
                      if (state.status === "error") setState({ status: "idle" });
                    }}
                  />

                  {hint ? <p className="ask2-hint" role="alert">{hint}</p> : null}

                  <button
                    className="ask2-submit"
                    disabled={isLoading}
                    type="submit"
                    aria-label={isLoading ? "Checking the account..." : "Check this account"}
                  >
                    {isLoading ? (
                      <>
                        <CircleNotch size={16} weight="bold" className="ask2-spin" aria-hidden="true" />
                        Checking the account…
                      </>
                    ) : (
                      <>
                        <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
                        Check this account
                      </>
                    )}
                  </button>
                </form>

                {isLoading ? (
                  <div className="ask2-loading" aria-live="polite" aria-busy="true">
                    <ol className="ask2-wait-rail" aria-hidden="true">
                      {RAIL_STOPS.map((stop) => (
                        <li key={stop}>{stop}</li>
                      ))}
                    </ol>
                    <span className="ask2-wait-sweep" aria-hidden="true" />
                    <p className="ask2-wait-copy">
                      Reading the account on Casper, then running the paid rail: quote, x402, Merkle
                      proof, on-chain record. On-chain confirmation time varies.
                      {elapsed > 2 ? <span className="ask2-wait-elapsed"> {elapsed}s</span> : null}
                    </p>
                  </div>
                ) : null}

                {state.status === "error" ? (
                  <div className="ask2-error" role="alert">
                    <WarningOctagon size={16} weight="bold" style={{ color: "var(--aspect-danger-ink)", flexShrink: 0 }} aria-hidden="true" />
                    <span>
                      {state.message}
                      {state.detail ? <code className="ask2-error-detail">{state.detail}</code> : null}
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="ask2-foot">No wallet, no signup. Every Trust Pass is re-checkable on Casper.</p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function navClick(handler?: () => void) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!handler || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    handler();
  };
}
