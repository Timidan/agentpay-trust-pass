import { type FormEvent, useEffect, useState } from "react";
import { CircleNotch, MagnifyingGlass, Warning, ShieldCheck, WarningOctagon } from "@phosphor-icons/react";
import {
  assessSubject,
  getReportHealth,
  resolveToken,
  type EvidenceNetwork,
  type ResolvedToken,
  type TokenEvidenceStatus
} from "../api";
import { SiteFooter, SiteNav } from "../components/SiteChrome";
import { VerdictVocabularyLegend } from "../components/VerdictVocabularyLegend";
import { useTrustCheck } from "./useTrustCheck";
import { VerdictCard } from "./VerdictCard";
import "./ask-page.css";

type AskStage = "resolving" | "checking";

const HASH_INPUT = /^(hash-)?[0-9a-f]{64}$/i;
const SYMBOL_INPUT = /^[a-z][a-z0-9._-]{1,15}$/i;

const RAIL_STOPS = ["Price", "Pay on Testnet", "Read Casper data", "Record result"] as const;

const MEANINGS = [
  {
    aspect: "clear",
    label: "Clear",
    body: "Every check required by this policy ran and passed. Review the receipt before you proceed.",
    Icon: ShieldCheck,
    color: "var(--aspect-clear-ink)"
  },
  {
    aspect: "caution",
    label: "Caution",
    body: "A risk was found or an important fact could not be checked. Review the details before you proceed.",
    Icon: Warning,
    color: "var(--aspect-caution-ink)"
  },
  {
    aspect: "danger",
    label: "Danger",
    body: "AgentPay found a serious risk. Do not proceed unless you can resolve it.",
    Icon: WarningOctagon,
    color: "var(--aspect-danger-ink)"
  }
] as const;

export default function AskPage({
  navigate,
  theme,
  onToggleTheme,
}: {
  navigate?: (path: string) => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [validationHint, setValidationHint] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedToken | null>(null);
  const [network, setNetwork] = useState<EvidenceNetwork>("casper-mainnet");
  const [tokenEvidence, setTokenEvidence] = useState<TokenEvidenceStatus | null>(null);
  const check = useTrustCheck<AskStage>();
  const { state, elapsed } = check;
  // Local discriminant alias so TypeScript narrows state.stage in the loading branch.
  const isLoading = state.status === "loading";

  const inputIsSymbol = SYMBOL_INPUT.test(subject.trim()) && !HASH_INPUT.test(subject.trim());

  useEffect(() => {
    let active = true;
    void getReportHealth().then((health) => {
      if (active) setTokenEvidence(health?.tokenEvidence ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  async function runCheck(rawInput: string) {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      setValidationHint("Enter a token symbol or paste a package hash first.");
      return;
    }
    setValidationHint(null);
    setResolved(null);

    let assessTarget = trimmed;
    let evidenceNetwork = network;
    if (!HASH_INPUT.test(trimmed)) {
      if (!SYMBOL_INPUT.test(trimmed)) {
        setValidationHint("Enter a token symbol (like WCSPR) or a 64-character package hash.");
        return;
      }
      check.begin("resolving");
      try {
        const token = await resolveToken(trimmed);
        if (!token) {
          check.fail(
            `"${trimmed.toUpperCase()}" isn't listed on CSPR.trade yet. Paste the token's package hash to check it directly.`
          );
          return;
        }
        setResolved(token);
        assessTarget = token.packageHash;
        evidenceNetwork = token.network;
        setNetwork(token.network);
      } catch (err) {
        check.failFrom(err);
        return;
      }
    }

    check.setStage("checking");
    try {
      check.succeed(await assessSubject(assessTarget, evidenceNetwork));
    } catch (err) {
      check.failFrom(err);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runCheck(subject);
  }

  return (
    <div className="ask2">
      <SiteNav current="check" sub="Token check" navigate={navigate} theme={theme} onToggleTheme={onToggleTheme} />

      <div className="ask2-main">
        {state.status === "done" ? (
          <div className="ask2-result ask2-reveal">
            <h1 className="agentpay-sr-only">Token check result</h1>
            <button type="button" className="ask2-again" onClick={() => check.reset()}>
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
              <h1 className="ask2-title">Check a token before you buy it.</h1>
              <p className="ask2-lede">
                Enter a token symbol or package hash. AgentPay checks live Casper data, covers a small
                Testnet service fee, and gives you a receipt that shows what passed, what failed, and
                what was unavailable.
              </p>
              <VerdictVocabularyLegend className="ask2-vocabulary" />
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
                  <fieldset className="ask2-network">
                    <legend>Token network</legend>
                    <div className="ask2-network-options">
                      {(["casper-mainnet", "casper-testnet"] as const).map((option) => (
                        <button
                          aria-pressed={network === option}
                          className={network === option ? "is-active" : undefined}
                          disabled={option === "casper-testnet" && inputIsSymbol}
                          key={option}
                          onClick={() => {
                            setNetwork(option);
                            setValidationHint(null);
                            if (state.status === "error") check.reset();
                          }}
                          type="button"
                        >
                          {option === "casper-mainnet" ? "Mainnet" : "Testnet"}
                        </button>
                      ))}
                    </div>
                  </fieldset>
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
                      const nextSubject = e.target.value;
                      setSubject(nextSubject);
                      if (SYMBOL_INPUT.test(nextSubject.trim()) && !HASH_INPUT.test(nextSubject.trim())) {
                        setNetwork("casper-mainnet");
                      }
                      if (validationHint) setValidationHint(null);
                      if (state.status === "error") check.reset();
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
                          AgentPay is covering the Testnet fee, reading Casper data, and recording the
                          result on Casper. Confirmation time varies.
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
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="ask2-foot">
                Token symbols resolve on Mainnet. Package hashes can be checked on either network.
                The hosted service fee uses Testnet funds, so you do not need a wallet.
                {tokenEvidence?.status === "limited"
                  ? " Current coverage is limited: supply controls work, but contract age and holder data are not connected yet."
                  : ""}
              </p>
            </section>
          </div>
        )}
      </div>

      <SiteFooter current="check" navigate={navigate} />
    </div>
  );
}

function shortHash(hash: string): string {
  const bare = hash.replace(/^hash-/, "");
  return `hash-${bare.slice(0, 6)}…${bare.slice(-6)}`;
}
