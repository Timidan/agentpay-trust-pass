import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CinematicChrome } from "../../src/cinematic/CinematicChrome";
import { CinematicRail } from "../../src/cinematic/CinematicRail";
import { useCinematicTimeline } from "../../src/cinematic/useCinematicTimeline";

const items = [
  { id: "terms", eyebrow: "01", title: "Terms", body: "Read the exact charge.", href: "/audit" },
  { id: "receipt", eyebrow: "02", title: "Receipt", body: "Verify the result.", href: "/app" },
];
const cinematicCssPath = resolve(process.cwd(), "src/cinematic/cinematic-base.css");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installAnimationFrameQueue() {
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });

  return () => {
    let iterations = 0;
    while (frames.size > 0) {
      const [id, callback] = frames.entries().next().value as [number, FrameRequestCallback];
      frames.delete(id);
      callback(iterations * 16);
      iterations += 1;
      if (iterations > 100) throw new Error("Cinematic animation did not converge");
    }
  };
}

function matchMedia(matches: boolean) {
  return (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

function TimelineHarness({ smoothing = 1 }: { smoothing?: number }) {
  const { jumpToProgress, reducedMotion, sectionRef, stageRef } = useCinematicTimeline({ smoothing });

  return (
    <section ref={sectionRef} data-testid="timeline-section">
      <div ref={stageRef} data-testid="timeline-stage" />
      <span>{reducedMotion ? "Reduced motion" : "Animated motion"}</span>
      <button type="button" onClick={() => jumpToProgress(0.25)}>Jump to quarter</button>
    </section>
  );
}

function setTimelineGeometry(section: HTMLElement) {
  const getBoundingClientRect = vi.fn(() => ({
    bottom: 1500,
    height: 2000,
    left: 0,
    right: 1000,
    top: -500,
    width: 1000,
    x: 0,
    y: -500,
    toJSON: () => ({}),
  }));
  Object.defineProperty(section, "offsetHeight", { configurable: true, value: 2000 });
  section.getBoundingClientRect = getBoundingClientRect;
  return getBoundingClientRect;
}

describe("cinematic shared UI", () => {
  it("links all concepts and marks the current one", () => {
    render(<MemoryRouter><CinematicChrome current="signal-field" progressLabel="Scroll to inspect" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Signal Field" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Proof Corridor" }).getAttribute("href")).toBe("/cinematic/proof-corridor");
    expect(screen.getByRole("link", { name: "Signal Field" }).getAttribute("href")).toBe("/cinematic/signal-field");
    expect(screen.getByRole("link", { name: "Evidence Chamber" }).getAttribute("href")).toBe("/cinematic/evidence-chamber");
    expect(screen.getByRole("link", { name: "Back to AgentPay" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("Scroll to inspect")).toBeTruthy();
  });

  it("moves the accessible rail with previous and next controls", () => {
    render(<MemoryRouter><CinematicRail ariaLabel="Signal anatomy" items={items} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Next item" }));
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous item" }));
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("keeps real rail links operable with keyboard and pointer swipes", () => {
    render(<MemoryRouter><CinematicRail ariaLabel="Signal anatomy" items={items} /></MemoryRouter>);
    const region = screen.getByRole("region", { name: "Signal anatomy" });

    expect(screen.getByRole("link", { name: /Terms/ }).getAttribute("href")).toBe("/audit");
    expect(screen.getByRole("link", { name: /Receipt/ }).getAttribute("href")).toBe("/app");

    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent(region, new MouseEvent("pointerdown", { bubbles: true, clientX: 180 }));
    fireEvent(region, new MouseEvent("pointerup", { bubbles: true, clientX: 80 }));
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });
});

describe("cinematic timeline hook", () => {
  it("writes cached local progress and pointer values and jumps from the section offset", () => {
    const flushFrames = installAnimationFrameQueue();
    const scrollTo = vi.fn();
    vi.stubGlobal("innerHeight", 1000);
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("scrollY", 500);
    vi.stubGlobal("scrollTo", scrollTo);

    render(<TimelineHarness />);
    const section = screen.getByTestId("timeline-section");
    const stage = screen.getByTestId("timeline-stage");
    const getBoundingClientRect = setTimelineGeometry(section);

    fireEvent(window, new Event("resize"));
    flushFrames();
    const measurements = getBoundingClientRect.mock.calls.length;

    fireEvent.scroll(window);
    fireEvent(window, new MouseEvent("pointermove", { clientX: 1000, clientY: 0 }));
    flushFrames();

    expect(Number(stage.style.getPropertyValue("--cinematic-p"))).toBeCloseTo(0.5);
    expect(Number(stage.style.getPropertyValue("--cinematic-x"))).toBe(1);
    expect(Number(stage.style.getPropertyValue("--cinematic-y"))).toBe(-1);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(measurements);

    fireEvent.click(screen.getByRole("button", { name: "Jump to quarter" }));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 250 });
  });

  it("sets the playhead directly and zeros pointer values for reduced motion", () => {
    const flushFrames = installAnimationFrameQueue();
    vi.stubGlobal("matchMedia", matchMedia(true));
    vi.stubGlobal("innerHeight", 1000);
    vi.stubGlobal("innerWidth", 1000);
    vi.stubGlobal("scrollY", 500);

    render(<TimelineHarness smoothing={0.05} />);
    const section = screen.getByTestId("timeline-section");
    const stage = screen.getByTestId("timeline-stage");
    setTimelineGeometry(section);

    fireEvent(window, new Event("resize"));
    fireEvent.scroll(window);
    fireEvent(window, new MouseEvent("pointermove", { clientX: 1000, clientY: 0 }));
    flushFrames();

    expect(screen.getByText("Reduced motion")).toBeTruthy();
    expect(Number(stage.style.getPropertyValue("--cinematic-p"))).toBeCloseTo(0.5);
    expect(Number(stage.style.getPropertyValue("--cinematic-x"))).toBe(0);
    expect(Number(stage.style.getPropertyValue("--cinematic-y"))).toBe(0);
  });
});

describe("cinematic base styles", () => {
  it("defines the scoped scene, layer bands, responsive lengths, focus, and reduced-motion flow", () => {
    expect(existsSync(cinematicCssPath)).toBe(true);
    const css = readFileSync(cinematicCssPath, "utf8");

    expect(css).toContain(".cinematic-page");
    expect(css).toContain(".cinematic-page .cinematic-scroll");
    expect(css).toContain(".cinematic-page .cinematic-stage");
    expect(css).toContain("--cinematic-z-world: 0");
    expect(css).toContain("--cinematic-z-narrative: 10");
    expect(css).toContain("--cinematic-z-rail: 20");
    expect(css).toContain("--cinematic-z-chrome: 30");
    expect(css).toContain("height: 4600px");
    expect(css).toContain("height: 3600px");
    expect(css).toContain("height: 3000px");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("position: static");
  });
});
