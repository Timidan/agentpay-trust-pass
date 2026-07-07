import { useEffect, useState } from "react";
import { ArrowSquareOut, MagnifyingGlass } from "@phosphor-icons/react";
import type { FeedEntry } from "../api";
import { getFeed, voteUrl } from "../api";
import { friendlyError } from "../lib/friendly-errors";
import "./ask-page.css";

type FeedState =
  | { status: "loading" }
  | { status: "done"; entries: FeedEntry[] }
  | { status: "error"; message: string };

function toSentenceCase(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export default function FeedPage({ onBack, onOpenAsk }: { onBack?: () => void; onOpenAsk?: () => void }) {
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getFeed()
      .then((result) => {
        if (!cancelled) {
          setState({ status: "done", entries: result?.entries ?? [] });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: "error", message: friendlyError(err).headline });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className="ask2">
      <nav className="ask2-nav" aria-label="AgentPay Trust Signal">
        <div className="ask2-brand">
          <span className="ask2-brand-name">AgentPay</span>
          <span className="ask2-brand-sub">Trust Signal</span>
        </div>
        <div className="ask2-navlinks">
          <a href="/" onClick={navClick(onBack)}>Overview</a>
          <a href="/check" onClick={navClick(onOpenAsk)}>Check a token</a>
        </div>
      </nav>

      {/* div, not <main>: App already wraps this page in a <main> landmark. */}
      <div className="ask2-main">
        <div className="ask2-feed">
          <p className="ask2-kicker">Community feed</p>
          <h1 className="ask2-title">Recent checks</h1>

          {state.status === "loading" ? (
            <div className="ask2-card ask2-feed-card" aria-live="polite" aria-busy="true">
              <p className="ask2-feed-note">Loading recent checks…</p>
            </div>
          ) : state.status === "error" ? (
            <div className="ask2-card ask2-feed-card ask2-feed-empty" role="alert">
              <p className="ask2-feed-note">{state.message}</p>
              <button type="button" className="ask2-submit ask2-feed-cta" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </button>
            </div>
          ) : state.entries.length === 0 ? (
            <div className="ask2-card ask2-feed-card ask2-feed-empty">
              <p className="ask2-feed-note">No checks yet. Be the first.</p>
              <button type="button" className="ask2-submit ask2-feed-cta" onClick={onOpenAsk}>
                <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
                Check a token
              </button>
            </div>
          ) : (
            <div className="ask2-card ask2-feed-card">
              <ul className="ask2-feed-list" aria-label="Recent token checks">
                {state.entries.map((entry) => (
                  <li key={entry.id} className={`ask2-feed-row ask2-feed-row--${entry.aspect.toLowerCase()}`}>
                    <a
                      href={`${voteUrl}?card=${encodeURIComponent(entry.cardImageUrl)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ask2-feed-link"
                      aria-label={`${toSentenceCase(entry.aspect)}, ${entry.subjectShortHash}`}
                    >
                      <code className="ask2-feed-hash">{entry.subjectShortHash}</code>
                      <span className="ask2-feed-verdict">{entry.aspect.toUpperCase()}</span>
                      <ArrowSquareOut size={14} weight="bold" className="ask2-feed-ext" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
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
