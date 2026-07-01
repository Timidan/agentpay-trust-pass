import { useEffect, useState } from "react";
import { ArrowSquareOut, CaretRight } from "@phosphor-icons/react";
import type { FeedEntry } from "../api";
import { getFeed, voteUrl } from "../api";

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

  useEffect(() => {
    let cancelled = false;
    getFeed()
      .then((result) => {
        if (!cancelled) {
          setState({ status: "done", entries: result.entries });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load feed"
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-fog feed-page-fog">
      <div className="glass-frame feed-glass-frame">
        {/* Nav lockup inside the glass frame */}
        <nav className="feed-frame-nav" aria-label="AgentPay Trust Signal">
          <div className="brand-lockup">
            <div className="brand-copy">
              <span className="brand-name" style={{ color: "var(--box-ink)" }}>AgentPay</span>
              <span className="brand-sub" style={{ color: "var(--box-ink-2)" }}>Trust Signal</span>
            </div>
          </div>
          <div className="hero-nav-links feed-frame-links" aria-label="Trust Signal navigation">
            <a href="/" onClick={navClick(onBack)} style={{ color: "hsla(206,34%,92%,.7)" }}>Overview</a>
            <a href="/ask" onClick={navClick(onOpenAsk)} style={{ color: "hsla(206,34%,92%,.7)" }}>Check a token</a>
          </div>
        </nav>

        {/* Focal content */}
        <div className="feed-focal">
          <p className="mono-label">Community feed</p>
          <h2 className="feed-section-title">Recent checks</h2>

          {state.status === "loading" ? (
            <div className="glass-card feed-list-card" aria-live="polite" aria-busy="true">
              <p style={{ color: "var(--box-ink-2)", padding: "clamp(20px,3vw,32px)", margin: 0 }}>
                Loading recent checks…
              </p>
            </div>
          ) : state.status === "error" ? (
            <div className="glass-card feed-list-card" role="alert">
              <p style={{ color: "var(--box-ink)", padding: "clamp(20px,3vw,32px)", margin: 0 }}>
                {state.message}
              </p>
            </div>
          ) : state.entries.length === 0 ? (
            <div className="glass-card feed-list-card feed-empty-card">
              <p style={{ color: "var(--box-ink)" }}>No checks yet. Check a token to see it here.</p>
            </div>
          ) : (
            <div className="glass-card feed-list-card">
              <ul className="feed-list" aria-label="Recent token checks">
                {state.entries.map((entry, idx) => (
                  <li
                    key={entry.id}
                    className="feed-row"
                    style={{ "--row-idx": idx } as React.CSSProperties}
                  >
                    <a
                      href={`${voteUrl}?card=${encodeURIComponent(entry.cardImageUrl)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="feed-row-link"
                      aria-label={`${toSentenceCase(entry.aspect)} — ${entry.subjectShortHash}`}
                    >
                      <span
                        className={`aspect-dot aspect-dot--${entry.aspect.toLowerCase()}`}
                        aria-hidden="true"
                      />
                      <code className="data-mono feed-row-hash">{entry.subjectShortHash}</code>
                      <span className="feed-row-verdict">{toSentenceCase(entry.aspect)}</span>
                      <span className="feed-row-actions" aria-hidden="true">
                        <ArrowSquareOut size={14} weight="bold" className="feed-row-ext" />
                        <CaretRight size={14} weight="bold" className="feed-row-caret" style={{ color: "var(--box-ink)" }} />
                      </span>
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
