import { useEffect, useState } from "react";
import { ArrowSquareOut, MagnifyingGlass } from "@phosphor-icons/react";
import type { FeedEntry } from "../api";
import { getFeed } from "../api";
import { friendlyError } from "../lib/friendly-errors";
import { SiteFooter, SiteNav } from "../components/SiteChrome";
import "./ask-page.css";

type FeedState =
  | { status: "loading" }
  | { status: "done"; entries: FeedEntry[] }
  | { status: "error"; message: string };

function toSentenceCase(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export default function FeedPage({
  navigate,
  theme,
  onToggleTheme,
}: {
  navigate?: (path: string) => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
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
      <SiteNav current="feed" sub="Shared results" navigate={navigate} theme={theme} onToggleTheme={onToggleTheme} />

      {/* div, not <main>: App already wraps this page in a <main> landmark. */}
      <div className="ask2-main">
        <div className="ask2-feed">
          <h1 className="ask2-title">Checks people chose to share</h1>
          <p className="ask2-feed-note">
            Only results their owners opted to publish appear here — this is not a full history of
            AgentPay decisions.
          </p>

          {state.status === "loading" ? (
            <div className="ask2-card ask2-feed-card" aria-live="polite" aria-busy="true">
              <p className="ask2-feed-note">Loading shared results…</p>
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
              <p className="ask2-feed-note">Nothing shared yet. Run a check and choose to share it.</p>
              <button type="button" className="ask2-submit ask2-feed-cta" onClick={() => navigate?.("/check")}>
                <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
                Check a token
              </button>
            </div>
          ) : (
            <div className="ask2-card ask2-feed-card">
              <ul className="ask2-feed-list" aria-label="Shared check results">
                {state.entries.map((entry) => (
                  <li key={entry.id} className={`ask2-feed-row ask2-feed-row--${entry.aspect.toLowerCase()}`}>
                    <a
                      href={entry.cardImageUrl}
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

      <SiteFooter current="feed" navigate={navigate} />
    </div>
  );
}
