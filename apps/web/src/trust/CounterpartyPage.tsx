import { type FormEvent, useState } from "react";
import { CircleNotch, MagnifyingGlass, Warning, ShieldCheck, WarningOctagon } from "@phosphor-icons/react";
import { assessAccount, type EvidenceNetwork } from "../api";
import { SiteFooter, SiteNav } from "../components/SiteChrome";
import { VerdictVocabularyLegend } from "../components/VerdictVocabularyLegend";
import { useTrustCheck } from "./useTrustCheck";
import { VerdictCard } from "./VerdictCard";
import "./ask-page.css";

// account-hash-<64hex>, or an ed25519 (01…) / secp256k1 (02…) public key.
const ACCOUNT_INPUT = /^(account-hash-[0-9a-f]{64}|01[0-9a-f]{64}|02[0-9a-f]{66})$/i;
const CSPR_NAME_INPUT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.cspr$/i;

const RAIL_STOPS = ["Price", "Pay on Testnet", "Read Casper data", "Record result"] as const;

const MEANINGS = [
  {
    aspect: "clear",
    label: "Clear",
    body: "The account exists, holds at least 1 CSPR, and its key setup passed the required checks.",
    Icon: ShieldCheck,
    color: "var(--aspect-clear-ink)"
  },
  {
    aspect: "caution",
    label: "Caution",
    body: "The balance is below 1 CSPR, the key setup needs attention, or a required fact was unavailable.",
    Icon: Warning,
    color: "var(--aspect-caution-ink)"
  },
  {
    aspect: "danger",
    label: "Danger",
    body: "Casper could not find this account.",
    Icon: WarningOctagon,
    color: "var(--aspect-danger-ink)"
  }
] as const;

export default function CounterpartyPage({
  navigate,
  theme,
  onToggleTheme,
}: {
  navigate?: (path: string) => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
  const [account, setAccount] = useState("");
  const [network, setNetwork] = useState<EvidenceNetwork>("casper-mainnet");
  const [hint, setHint] = useState<string | null>(null);
  const check = useTrustCheck();
  const { state, isLoading, elapsed } = check;

  async function runCheck(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setHint("Paste an account hash or public key first.");
      return;
    }
    if (!ACCOUNT_INPUT.test(trimmed) && !CSPR_NAME_INPUT.test(trimmed)) {
      setHint("Enter a .cspr name, an account-hash-… value, or a public key that starts with 01 or 02.");
      return;
    }
    setHint(null);
    check.begin();
    try {
      check.succeed(await assessAccount(trimmed, network));
    } catch (err) {
      check.failFrom(err);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runCheck(account);
  }

  return (
    <div className="ask2">
      <SiteNav current="counterparty" sub="Wallet check" navigate={navigate} theme={theme} onToggleTheme={onToggleTheme} />

      <div className="ask2-main">
        {state.status === "done" ? (
          <div className="ask2-result ask2-reveal">
            <h1 className="agentpay-sr-only">Wallet check result</h1>
            <button type="button" className="ask2-again" onClick={() => check.reset()}>
              ← Check another account
            </button>
            {state.verdict.resolvedAccount ? (
              <p className="ask2-resolved">
                {state.verdict.resolvedAccount.name} → <code>{shortAccount(state.verdict.resolvedAccount.accountHash)}</code>
              </p>
            ) : null}
            <VerdictCard
              verdict={state.verdict}
              subjectLabel="Account"
              subjectHint={state.verdict.resolvedAccount?.name}
            />
          </div>
        ) : (
          <div className="ask2-grid">
            <section className="ask2-copy">
              <h1 className="ask2-title">Check a Casper account before you send funds.</h1>
              <p className="ask2-lede">
                Enter a CSPR.name, account hash, or public key. AgentPay resolves the name, reads the
                account directly from Casper, covers the Testnet service fee, and gives you a receipt.
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
                    <legend>Casper network</legend>
                    <div className="ask2-network-options">
                      {(["casper-mainnet", "casper-testnet"] as const).map((option) => (
                        <button
                          aria-pressed={network === option}
                          className={network === option ? "is-active" : undefined}
                          disabled={option === "casper-testnet" && CSPR_NAME_INPUT.test(account.trim())}
                          key={option}
                          onClick={() => {
                            setNetwork(option);
                            setHint(null);
                            if (state.status === "error") check.reset();
                          }}
                          type="button"
                        >
                          {option === "casper-mainnet" ? "Mainnet" : "Testnet"}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="ask2-field-label" htmlFor="cp-account">
                    CSPR.name, account hash, or public key
                  </label>
                  <input
                    autoComplete="off"
                    className="ask2-input"
                    id="cp-account"
                    maxLength={253}
                    placeholder="alice.cspr, account-hash-…, or public key"
                    spellCheck={false}
                    type="text"
                    value={account}
                    onChange={(e) => {
                      const nextAccount = e.target.value;
                      setAccount(nextAccount);
                      if (CSPR_NAME_INPUT.test(nextAccount.trim())) setNetwork("casper-mainnet");
                      if (hint) setHint(null);
                      if (state.status === "error") check.reset();
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
                      AgentPay is reading the account, covering the Testnet fee, and recording the result
                      on Casper. Confirmation time varies.
                      {elapsed > 2 ? <span className="ask2-wait-elapsed"> {elapsed}s</span> : null}
                    </p>
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
              <p className="ask2-foot">The hosted check uses Testnet funds. You do not need a wallet or account.</p>
            </section>
          </div>
        )}
      </div>

      <SiteFooter current="counterparty" navigate={navigate} />
    </div>
  );
}

function shortAccount(accountHash: string): string {
  const value = accountHash.replace(/^account-hash-/, "");
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
