import { Link } from "react-router-dom";
import { AgentPayLogo } from "../components/AgentPayLogo";
import type { CinematicSlug } from "./types";
import "./cinematic-base.css";

const CINEMATIC_CONCEPTS: ReadonlyArray<{
  slug: CinematicSlug;
  label: string;
}> = [
  { slug: "proof-corridor", label: "Proof Corridor" },
  { slug: "signal-field", label: "Signal Field" },
  { slug: "evidence-chamber", label: "Evidence Chamber" },
];

type CinematicChromeProps = {
  current: CinematicSlug;
  progressLabel: string;
};

export function CinematicChrome({ current, progressLabel }: CinematicChromeProps) {
  return (
    <header className="cinematic-chrome">
      <Link className="cinematic-chrome__brand" to="/" aria-label="Back to AgentPay">
        <AgentPayLogo className="cinematic-chrome__logo" decorative variant="full" />
      </Link>

      <nav className="cinematic-chrome__concepts" aria-label="Cinematic concepts">
        {CINEMATIC_CONCEPTS.map(({ slug, label }) => (
          <Link
            className="cinematic-chrome__concept"
            key={slug}
            to={`/cinematic/${slug}`}
            aria-current={slug === current ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="cinematic-chrome__progress" aria-label={progressLabel}>
        <span>{progressLabel}</span>
        <span className="cinematic-chrome__progress-line" aria-hidden="true" />
      </div>
    </header>
  );
}
