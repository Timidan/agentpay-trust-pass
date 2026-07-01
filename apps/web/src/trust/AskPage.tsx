import { type FormEvent, useState } from "react";
import { CircleNotch, MagnifyingGlass, Warning, ShieldCheck, WarningOctagon } from "@phosphor-icons/react";
import { assessSubject, type Verdict } from "../api";
import { VerdictCard } from "./VerdictCard";
import "./ask-page.css";

type AskState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; verdict: Verdict }
  | { status: "error"; message: string };

const MEANINGS = [
  {
    aspect: "clear",
    label: "Clear",
    body: "The basics check out — proceed on your own judgment.",
    Icon: ShieldCheck,
    color: "var(--aspect-clear)"
  },
  {
    aspect: "caution",
    label: "Caution",
    body: "Not proven either way. Look closer before you commit.",
    Icon: Warning,
    color: "var(--aspect-caution)"
  },
  {
    aspect: "danger",
    label: "Danger",
    body: "Something here can cost you — the lamp stays red.",
    Icon: WarningOctagon,
    color: "var(--aspect-danger)"
  }
] as const;

// A real testnet CEP-18 (the x402 settlement token) so "try it" hits live data.
const SAMPLE_TOKEN = "hash-a7888ddfbc31455396f3c57583547962a28bcb3b20e60d6be2dea3a8f2991d4d";

export default function AskPage({ onBack, onOpenFeed }: { onBack?: () => void; onOpenFeed?: () => void }) {
  const [subject, setSubject] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [validationHint, setValidationHint] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = subject.trim();
    if (!trimmed) {
      setValidationHint("Paste a token address or package hash first.");
      return;
    }
    setValidationHint(null);
    setState({ status: "loading" });
    try {
      const verdict = await assessSubject(trimmed);
      setState({ status: "done", verdict });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Assessment failed"
      });
    }
  }

  const isLoading = state.status === "loading";

  return (
    <div className="ask2">
      <nav className="ask2-nav" aria-label="AgentPay Trust Signal">
        <div className="ask2-brand">
          <span className="ask2-brand-name">AgentPay</span>
          <span className="ask2-brand-sub">Trust Signal</span>
        </div>
        <div className="ask2-navlinks">
          <a href="/" onClick={navClick(onBack)}>Overview</a>
          <a href="/feed" onClick={navClick(onOpenFeed)}>Recent checks</a>
        </div>
      </nav>

      <main className="ask2-main">
        {state.status === "done" ? (
          <div className="ask2-result">
            <button type="button" className="ask2-again" onClick={() => setState({ status: "idle" })}>
              ← Check another token
            </button>
            <VerdictCard verdict={state.verdict} />
          </div>
        ) : (
          <div className="ask2-grid">
            <section className="ask2-copy">
              <p className="ask2-kicker">Token check</p>
              <h1 className="ask2-title">Check a token before you buy it.</h1>
              <p className="ask2-lede">
                Paste a Casper token address and the agent checks it on-chain — mint authority,
                holder concentration, age — then calls it clear, caution, or danger.
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
                  <label className="ask2-field-label" htmlFor="ask-subject">
                    Token address or package hash
                  </label>
                  <input
                    autoComplete="off"
                    className="ask2-input"
                    id="ask-subject"
                    maxLength={128}
                    placeholder="Paste a token address (hash-…) or 64-character package hash"
                    spellCheck={false}
                    type="text"
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      if (validationHint) setValidationHint(null);
                    }}
                  />

                  {validationHint ? (
                    <p className="ask2-hint" role="alert">{validationHint}</p>
                  ) : null}

                  <button
                    className="ask2-submit"
                    disabled={isLoading}
                    type="submit"
                    aria-label={isLoading ? "Checking the token..." : "ASK — Check this token"}
                  >
                    {isLoading ? (
                      <>
                        <CircleNotch size={16} weight="bold" className="ask2-spin" aria-hidden="true" />
                        Checking the token…
                      </>
                    ) : (
                      <>
                        <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
                        Check this token
                      </>
                    )}
                  </button>
                </form>

                <div className="ask2-try">
                  <span className="ask2-try-label">Try</span>
                  <button
                    type="button"
                    className="ask2-chip"
                    onClick={() => {
                      setSubject(SAMPLE_TOKEN);
                      setValidationHint(null);
                    }}
                  >
                    a sample token ↗
                  </button>
                </div>

                {isLoading ? (
                  <div className="ask2-loading" aria-live="polite" aria-busy="true">
                    Checking the token on-chain. This takes a few seconds.
                  </div>
                ) : null}

                {state.status === "error" ? (
                  <div className="ask2-error" role="alert">
                    <WarningOctagon size={16} weight="bold" style={{ color: "var(--aspect-danger)", flexShrink: 0 }} aria-hidden="true" />
                    <span>{state.message}</span>
                  </div>
                ) : null}
              </div>
              <p className="ask2-foot">No wallet, no signup. Every verdict is re-checkable on Casper.</p>
            </section>
          </div>
        )}
      </main>
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
