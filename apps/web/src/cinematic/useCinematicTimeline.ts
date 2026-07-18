import { useCallback, useEffect, useRef, useState } from "react";
import { clamp, lerp } from "./timeline";

type CinematicTimelineOptions = {
  smoothing?: number;
};

type Geometry = {
  sectionTop: number;
  travel: number;
};

type Playhead = {
  progress: number;
  pointerX: number;
  pointerY: number;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const DEFAULT_SMOOTHING = 0.12;
const CONVERGENCE_EPSILON = 0.0005;

const initialReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;

export function useCinematicTimeline(options: CinematicTimelineOptions = {}) {
  const smoothing = clamp(options.smoothing ?? DEFAULT_SMOOTHING, 0.01, 1);
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const frameRef = useRef<number | null>(null);
  const targetRef = useRef<Playhead>({ progress: 0, pointerX: 0, pointerY: 0 });
  const playheadRef = useRef<Playhead>({ progress: 0, pointerX: 0, pointerY: 0 });
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  const reducedMotionRef = useRef(reducedMotion);

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);

    setReducedMotion(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const writePlayhead = (playhead: Playhead) => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.style.setProperty("--cinematic-p", String(playhead.progress));
      stage.style.setProperty("--cinematic-x", String(playhead.pointerX));
      stage.style.setProperty("--cinematic-y", String(playhead.pointerY));
    };

    const scheduleFrame = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(updatePlayhead);
    };

    const updateTargetProgress = () => {
      const geometry = geometryRef.current;
      if (!geometry) return;
      targetRef.current.progress = clamp((window.scrollY - geometry.sectionTop) / geometry.travel);
    };

    const measure = () => {
      const rect = section.getBoundingClientRect();
      geometryRef.current = {
        sectionTop: rect.top + window.scrollY,
        travel: Math.max(1, section.offsetHeight - window.innerHeight),
      };
      updateTargetProgress();
      scheduleFrame();
    };

    const onScroll = () => {
      updateTargetProgress();
      scheduleFrame();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion) {
        targetRef.current.pointerX = 0;
        targetRef.current.pointerY = 0;
      } else {
        targetRef.current.pointerX = clamp((event.clientX / Math.max(1, window.innerWidth)) * 2 - 1, -1, 1);
        targetRef.current.pointerY = clamp((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1, -1, 1);
      }
      scheduleFrame();
    };

    function updatePlayhead() {
      frameRef.current = null;
      const current = playheadRef.current;
      const target = targetRef.current;

      if (reducedMotion) {
        current.progress = target.progress;
        current.pointerX = 0;
        current.pointerY = 0;
      } else {
        current.progress = lerp(current.progress, target.progress, smoothing);
        current.pointerX = lerp(current.pointerX, target.pointerX, smoothing);
        current.pointerY = lerp(current.pointerY, target.pointerY, smoothing);
      }

      const converged =
        Math.abs(current.progress - target.progress) <= CONVERGENCE_EPSILON &&
        Math.abs(current.pointerX - (reducedMotion ? 0 : target.pointerX)) <= CONVERGENCE_EPSILON &&
        Math.abs(current.pointerY - (reducedMotion ? 0 : target.pointerY)) <= CONVERGENCE_EPSILON;

      if (converged) {
        current.progress = target.progress;
        current.pointerX = reducedMotion ? 0 : target.pointerX;
        current.pointerY = reducedMotion ? 0 : target.pointerY;
      }

      writePlayhead(current);
      if (!converged) scheduleFrame();
    }

    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [reducedMotion, smoothing]);

  const jumpToProgress = useCallback((progress: number) => {
    const section = sectionRef.current;
    if (!section) return;

    const cached = geometryRef.current;
    const sectionTop = cached?.sectionTop ?? section.getBoundingClientRect().top + window.scrollY;
    const travel = cached?.travel ?? Math.max(1, section.offsetHeight - window.innerHeight);
    window.scrollTo({
      behavior: reducedMotionRef.current ? "auto" : "smooth",
      top: sectionTop + travel * clamp(progress),
    });
  }, []);

  return { sectionRef, stageRef, reducedMotion, jumpToProgress };
}
