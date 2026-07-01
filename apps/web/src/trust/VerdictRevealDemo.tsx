import { useMemo, useState } from "react";
import { VerdictReveal, type Aspect } from "./VerdictReveal";
import { drawTokenChart } from "./chart-asset";
import "../styles.css";
import "./verdict-reveal-demo.css";

/**
 * Standalone playground for VerdictReveal.
 * Mounted at #verdict-reveal (see main.tsx) so it never touches the real app.
 *
 * The "real asset" defaults to a procedurally-drawn token price chart (so the
 * demo runs offline with no CORS), but you can paste any image URL to feel the
 * shader treatment on a real logo/screenshot.
 */

type AspectCopy = { rationale: string; flags: { code: string; message: string }[] };

const COPY: Record<Aspect, AspectCopy> = {
  CLEAR: {
    rationale:
      "Mint authority renounced, supply fixed, liquidity locked, holders distributed. The basics check out — proceed on your own judgment.",
    flags: [
      { code: "MINT_RENOUNCED", message: "mint authority burned" },
      { code: "LP_LOCKED", message: "liquidity locked 12mo" }
    ]
  },
  CAUTION: {
    rationale:
      "Token is 3 days old and thinly held, and one liquidity source couldn't be read on chain. Nothing damning, nothing reassuring — look closer before you commit.",
    flags: [
      { code: "NEW_TOKEN", message: "deployed 3d ago" },
      { code: "THIN_HOLDERS", message: "42 holders" }
    ]
  },
  DANGER: {
    rationale:
      "Mint authority is still open and the top wallet controls 64% of supply. Either one can cost you — the lamp stays red.",
    flags: [
      { code: "MINT_OPEN", message: "mint authority active" },
      { code: "HOLDER_CONC", message: "top wallet 64%" }
    ]
  }
};

const ASPECTS: Aspect[] = ["CLEAR", "CAUTION", "DANGER"];

export default function VerdictRevealDemo() {
  const [aspect, setAspect] = useState<Aspect>("DANGER");
  const [runId, setRunId] = useState(0);
  const [durationMs, setDurationMs] = useState(2200);
  const [urlInput, setUrlInput] = useState("");
  const sampleChart = useMemo(() => drawTokenChart(), []);
  const [imageSrc, setImageSrc] = useState(sampleChart);

  function play(next: Aspect) {
    setAspect(next);
    setRunId((id) => id + 1);
  }

  function useUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      return;
    }
    setImageSrc(trimmed);
    setRunId((id) => id + 1);
  }

  function useSample() {
    setImageSrc(drawTokenChart());
    setRunId((id) => id + 1);
  }

  const copy = COPY[aspect];

  return (
    <main className="vrd-page" data-theme="dark">
      <header className="vrd-header">
        <div>
          <p className="mono-label">Prototype</p>
          <h1>Verdict reveal</h1>
          <p className="vrd-sub">
            One tweened scalar drives a WebGL shader on a real asset <em>and</em> the DOM — the
            distortion resolves to clarity, and the residual disorder encodes the verdict.
          </p>
        </div>
        <div className="vrd-controls">
          <div className="vrd-aspect-row" role="group" aria-label="Verdict">
            {ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                className={`vrd-btn vrd-btn--${a.toLowerCase()} ${aspect === a ? "is-active" : ""}`}
                onClick={() => play(a)}
              >
                {a}
              </button>
            ))}
          </div>
          <button type="button" className="vrd-btn vrd-btn--ghost" onClick={() => setRunId((id) => id + 1)}>
            ↻ Replay
          </button>
          <label className="vrd-field">
            <span>Duration {durationMs}ms</span>
            <input
              type="range"
              min={800}
              max={4000}
              step={100}
              value={durationMs}
              onChange={(e) => setDurationMs(Number(e.target.value))}
            />
          </label>
          <div className="vrd-asset-row">
            <input
              type="text"
              className="vrd-url"
              placeholder="paste any image URL (CORS-enabled) — logo, screenshot…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <button type="button" className="vrd-btn vrd-btn--ghost" onClick={useUrl}>
              Use image
            </button>
            <button type="button" className="vrd-btn vrd-btn--ghost" onClick={useSample}>
              New chart
            </button>
          </div>
        </div>
      </header>

      <div className="vrd-stage">
        <VerdictReveal
          aspect={aspect}
          imageSrc={imageSrc}
          label="Token 0x9f3ac1d2"
          rationale={copy.rationale}
          flags={copy.flags}
          runId={runId}
          durationMs={durationMs}
        />
      </div>

      <footer className="vrd-foot">
        <p>
          Honesty guardrails: under <code>prefers-reduced-motion</code> or without WebGL it ships the
          final, readable state instantly. Try DANGER vs CLEAR — DANGER keeps a red glitch and shakes;
          CLEAR resolves clean and quiet.
        </p>
      </footer>
    </main>
  );
}
