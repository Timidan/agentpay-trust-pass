import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { CinematicRailItem } from "./types";

type CinematicRailProps = {
  ariaLabel: string;
  items: readonly CinematicRailItem[];
};

const SWIPE_THRESHOLD = 48;

export function CinematicRail({ ariaLabel, items }: CinematicRailProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const cardRefs = useRef<Array<HTMLLIElement | null>>([]);
  const pointerStartX = useRef<number | null>(null);
  const lastIndex = Math.max(0, items.length - 1);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, lastIndex));
  }, [lastIndex]);

  useEffect(() => {
    cardRefs.current[activeIndex]?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex]);

  const moveTo = (index: number) => {
    setActiveIndex(Math.max(0, Math.min(lastIndex, index)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTo(activeIndex - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTo(activeIndex + 1);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    pointerStartX.current = event.clientX;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const startX = pointerStartX.current;
    pointerStartX.current = null;
    if (startX === null) return;

    const distance = event.clientX - startX;
    if (distance <= -SWIPE_THRESHOLD) moveTo(activeIndex + 1);
    if (distance >= SWIPE_THRESHOLD) moveTo(activeIndex - 1);
  };

  return (
    <section
      className="cinematic-rail"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onPointerCancel={() => {
        pointerStartX.current = null;
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      tabIndex={0}
    >
      <div className="cinematic-rail__controls">
        <button
          type="button"
          className="cinematic-rail__control"
          aria-label="Previous item"
          disabled={items.length === 0 || activeIndex === 0}
          onClick={() => moveTo(activeIndex - 1)}
        >
          <span aria-hidden="true">←</span>
        </button>
        <span className="cinematic-rail__status" role="status" aria-live="polite" aria-atomic="true">
          {items.length === 0 ? "0 / 0" : `${activeIndex + 1} / ${items.length}`}
        </span>
        <button
          type="button"
          className="cinematic-rail__control"
          aria-label="Next item"
          disabled={items.length === 0 || activeIndex === lastIndex}
          onClick={() => moveTo(activeIndex + 1)}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <ol className="cinematic-rail__track">
        {items.map((item, index) => (
          <li
            className="cinematic-rail__item"
            data-active={index === activeIndex ? "true" : undefined}
            id={`cinematic-rail-${item.id}`}
            key={item.id}
            ref={(node) => {
              cardRefs.current[index] = node;
            }}
          >
            <a className="cinematic-rail__card" href={item.href} onFocus={() => moveTo(index)}>
              <span className="cinematic-rail__eyebrow">{item.eyebrow}</span>
              <strong className="cinematic-rail__title">{item.title}</strong>
              <span className="cinematic-rail__body">{item.body}</span>
              <span className="cinematic-rail__arrow" aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
