import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { PHASES } from "./data";
import { PHASE_ICONS } from "./icons";

// The workflow timeline (owner-chosen "arc dial" treatment): the eight backend
// steps grouped into four narrative phases riding a rotating arc. The dial
// turns each phase into the spotlight; the copy pane and its real sub-step
// tags follow. Auto-advances once in view; any click takes manual control.
// Reduced motion (or no IntersectionObserver) renders a settled list instead.
const COUNT = PHASES.length;

export function WorkflowTimeline() {
  const reduce = useReducedMotion();
  const settled = Boolean(reduce) || typeof IntersectionObserver === "undefined";
  return <div className="tl">{settled ? <PhaseList /> : <DialTimeline />}</div>;
}

function PhaseCopy({ index, active }: { index: number; active: boolean }) {
  const phase = PHASES[index];
  return (
    <div className="tl-copy" data-on={active ? "true" : "false"}>
      <span className="tl-num">{String(index + 1).padStart(2, "0")} / {String(COUNT).padStart(2, "0")}</span>
      <h3 className="tl-name">{phase.name}</h3>
      <p className="tl-body">{phase.body}</p>
      <ul className="tl-steps" aria-label={`Steps inside ${phase.name}`}>
        {phase.steps.map((step, i) => (
          <li className="tl-step-tag" key={step} style={{ transitionDelay: active ? `${0.15 + i * 0.12}s` : "0s" }}>
            {step}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DialTimeline() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(false);
  // Autoplay pauses on a manual pick, then resumes: a click means "let me
  // read this one", not "stop the show".
  const [paused, setPaused] = useState(false);
  const resumeTimer = useRef<number | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => setInView(entry.isIntersecting)),
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || paused) return;
    const timer = window.setInterval(() => setActive((i) => (i + 1) % COUNT), 3600);
    return () => window.clearInterval(timer);
  }, [inView, paused]);

  useEffect(() => () => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
  }, []);

  const pick = (i: number) => {
    setActive(i);
    setPaused(true);
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setPaused(false), 9000);
  };

  // 40° between stations; the active one rests at the dial's 3 o'clock.
  const STEP_DEG = 40;
  const rotation = -active * STEP_DEG;

  return (
    <div className="tld" ref={hostRef}>
      <div className="tld-wheel-well" aria-hidden="true">
        <span className="tld-ring" />
        <div className="tld-wheel" style={{ "--tld-rot": `${rotation}deg` } as React.CSSProperties}>
          {PHASE_ICONS.map(({ key, Icon }, i) => (
            <button
              key={key}
              type="button"
              tabIndex={-1}
              className="tld-station"
              data-on={i === active ? "true" : "false"}
              style={{ "--tld-angle": `${i * STEP_DEG}deg` } as React.CSSProperties}
              onClick={() => pick(i)}
            >
              <span className="tld-station-inner" style={{ transform: `rotate(${-rotation - i * STEP_DEG}deg)` }}>
                <Icon size={40} />
              </span>
            </button>
          ))}
        </div>
      </div>
      {/* Narrow screens hide the orbit wheel; this horizontal stepper carries
          the same auto-advancing spotlight so the dial still animates. */}
      <div className="tld-mobile" aria-hidden="true">
        {PHASE_ICONS.map(({ key, Icon }, i) => (
          <button
            key={key}
            type="button"
            tabIndex={-1}
            className="tld-mstation"
            data-on={i === active ? "true" : "false"}
            onClick={() => pick(i)}
          >
            <Icon size={26} />
          </button>
        ))}
      </div>
      <div className="tld-copy">
        {PHASES.map((p, i) => (
          <div className="tld-pane" data-on={i === active ? "true" : "false"} key={p.name} aria-hidden={i !== active}>
            <PhaseCopy index={i} active={i === active} />
          </div>
        ))}
        <div className="tld-jump" role="tablist" aria-label="Workflow phases">
          {PHASES.map((p, i) => (
            <button
              key={p.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              className="tld-jump-btn"
              data-on={i === active ? "true" : "false"}
              onClick={() => pick(i)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Settled fallback: reduced motion / no IntersectionObserver. */
function PhaseList() {
  return (
    <div className="tl-rail is-static" role="list" aria-label="The AgentPay workflow, in order">
      {PHASES.map((phase, i) => {
        const { Icon } = PHASE_ICONS[i];
        return (
          <article className="tl-station" role="listitem" key={phase.name} data-on="true">
            <span className="tl-icon">
              <Icon size={40} />
            </span>
            <PhaseCopy index={i} active />
          </article>
        );
      })}
    </div>
  );
}
