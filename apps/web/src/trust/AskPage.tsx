import { type FormEvent, useEffect, useState } from "react";
import { CircleNotch, MagnifyingGlass, Warning, ShieldCheck, WarningOctagon } from "@phosphor-icons/react";
import { assessSubject, resolveToken, type ResolvedToken, type Verdict } from "../api";
import { friendlyError } from "../lib/friendly-errors";
import { VerdictCard } from "./VerdictCard";
import "./ask-page.css";

type AskStage = "resolving" | "checking";

type AskState =
  | { status: "idle" }
  | { status: "loading"; stage: AskStage }
  | { status: "done"; verdict: Verdict }
  | { status: "error"; message: string; detail?: string };

const HASH_INPUT = /^(hash-)?[0-9a-f]{64}$/i;
const SYMBOL_INPUT = /^[a-z][a-z0-9._-]{1,15}$/i;

const RAIL_STOPS = ["Quote", "Settle x402", "Verify proof", "Record"] as const;

const MEANINGS = [
  {
    aspect: "clear",
    label: "Clear",
    body: "The basics check out. Proceed on your own judgment.",
    Icon: ShieldCheck,
    color: "var(--aspect-clear-ink)"
  },
  {
    aspect: "caution",
    label: "Caution",
    body: "Not proven either way. Look closer before you commit.",
    Icon: Warning,
    color: "var(--aspect-caution-ink)"
  },
  {
    aspect: "danger",
    label: "Danger",
    body: "Something here can cost you. The lamp stays red.",
    Icon: WarningOctagon,
    color: "var(--aspect-danger-ink)"
  }
] as const;

export default function AskPage({ onBack, onOpenFeed }: { onBack?: () => void; onOpenFeed?: () => void }) {
  const [subject, setSubject] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [validationHint, setValidationHint] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedToken | null>(null);
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

  async function runCheck(rawInput: string) {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setValidationHint("Enter a token symbol or paste a package hash first.");
      return;
    }
    setValidationHint(null);
    setResolved(null);

    let assessTarget = trimmed;
    if (!HASH_INPUT.test(trimmed)) {
      if (!SYMBOL_INPUT.test(trimmed)) {
        setValidationHint("Enter a token symbol (like WCSPR) or a 64-character package hash.");
        return;
      }
      setState({ status: "loading", stage: "resolving" });
      try {
        const token = await resolveToken(trimmed);
        if (!token) {
          setState({
            status: "error",
            message: `"${trimmed.toUpperCase()}" isn't listed on CSPR.trade yet. Paste the token's package hash to check it directly.`
          });
          return;
        }
        setResolved(token);
        assessTarget = token.packageHash;
      } catch (err) {
        const friendly = friendlyError(err);
        setState({ status: "error", message: friendly.headline, detail: friendly.detail });
        return;
      }
    }

    setState({ status: "loading", stage: "checking" });
    try {
      const verdict = await assessSubject(assessTarget);
      setState({ status: "done", verdict });
    } catch (err) {
      const friendly = friendlyError(err);
      setState({
        status: "error",
        message: friendly.headline,
        detail: friendly.detail
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runCheck(subject);
  }

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

      <div className="ask2-main">
        {state.status === "done" ? (
          <div className="ask2-result ask2-reveal">
            <h1 className="agentpay-sr-only">Token check result</h1>
            <button type="button" className="ask2-again" onClick={() => setState({ status: "idle" })}>
              ← Check another token
            </button>
            {resolved ? (
              <p className="ask2-resolved">
                {resolved.symbol}
                {resolved.name ? ` · ${resolved.name}` : ""} → <code>{shortHash(resolved.packageHash)}</code>
              </p>
            ) : null}
            <VerdictCard verdict={state.verdict} subjectHint={resolved?.symbol} />
          </div>
        ) : (
          <div className="ask2-grid">
            <section className="ask2-copy">
              <p className="ask2-kicker">Token check</p>
              <h1 className="ask2-title">Buy a Trust Pass before you buy the token.</h1>
              <p className="ask2-lede">
                Type a token symbol or paste its address. The agent buys the evidence over x402,
                verifies the proof against the quoted root, and returns a copyable Casper receipt.
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
                    Token symbol or package hash
                  </label>
                  <input
                    autoComplete="off"
                    className="ask2-input"
                    id="ask-subject"
                    maxLength={128}
                    placeholder="Package hash (hash-…) or token symbol"
                    spellCheck={false}
                    type="text"
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      if (validationHint) setValidationHint(null);
                      if (state.status === "error") setState({ status: "idle" });
                    }}
                  />

                  {validationHint ? (
                    <p className="ask2-hint" role="alert">{validationHint}</p>
                  ) : null}

                  <button
                    className="ask2-submit"
                    disabled={isLoading}
                    type="submit"
                    aria-label={isLoading ? "Checking the token..." : "Check this token"}
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

                {isLoading ? (
                  <div className="ask2-loading" aria-live="polite" aria-busy="true">
                    {state.stage === "resolving" ? (
                      <p className="ask2-wait-copy">Looking up the token on CSPR.trade…</p>
                    ) : (
                      <>
                        {resolved ? (
                          <p className="ask2-resolved">
                            {resolved.symbol}
                            {resolved.name ? ` · ${resolved.name}` : ""} → <code>{shortHash(resolved.packageHash)}</code>
                          </p>
                        ) : null}
                        <ol className="ask2-wait-rail" aria-hidden="true">
                          {RAIL_STOPS.map((stop) => (
                            <li key={stop}>{stop}</li>
                          ))}
                        </ol>
                        <span className="ask2-wait-sweep" aria-hidden="true" />
                        <p className="ask2-wait-copy">
                          Running the paid rail on Casper: quote, x402 settlement, Merkle proof, on-chain
                          record. On-chain confirmation time varies.
                          {elapsed > 2 ? <span className="ask2-wait-elapsed"> {elapsed}s</span> : null}
                        </p>
                      </>
                    )}
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

function shortHash(hash: string): string {
  const bare = hash.replace(/^hash-/, "");
  return `hash-${bare.slice(0, 6)}…${bare.slice(-6)}`;
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
