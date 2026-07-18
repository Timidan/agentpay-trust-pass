import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ProofCorridorPage from "../../src/cinematic/proof-corridor/ProofCorridorPage";

const proofCorridorCssPath = resolve(process.cwd(), "src/cinematic/proof-corridor/proof-corridor.css");

afterEach(() => {
  cleanup();
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
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  return () => {
    let iterations = 0;
    while (frames.size > 0) {
      const [id, callback] = frames.entries().next().value as [number, FrameRequestCallback];
      frames.delete(id);
      callback(iterations * 16);
      iterations += 1;
      if (iterations > 1000) throw new Error("Proof Corridor animation did not settle");
    }
  };
}

function reducedMotionMatchMedia() {
  return (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

describe("Proof Corridor", () => {
  it("renders the full truthful product story and real final links", () => {
    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "The path from charge to proof." })).toBeTruthy();
    expect(screen.getByText("Your wallet signs. AgentPay never receives the key.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Payment checker/i }).getAttribute("href")).toBe("/audit");
    expect(screen.getByRole("link", { name: /Console/i }).getAttribute("href")).toBe("/app");
  });

  it("uses browser-valid timeline segments and reveals the existing workflow icon strokes", () => {
    const css = readFileSync(proofCorridorCssPath, "utf8");

    expect(css).not.toMatch(/--pc-[^:]+:[^;]+\/ 0\./);
    expect(css).toContain(".proof-corridor .pc-station__icon .tl-stroke");
    expect(css).toContain("stroke-dashoffset: 0");
  });

  it("keeps the hero first and all narrative beats in flow for reduced motion", () => {
    const css = readFileSync(proofCorridorCssPath, "utf8");
    const reducedMotionCss = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedMotionCss).toContain("flex-direction: column");
    expect(reducedMotionCss).toContain(".proof-corridor .pc-opening { order: 1; }");
    expect(reducedMotionCss).toContain(".proof-corridor .pc-final { order: 7; }");
  });

  it("renders the opening scroll cue without an interactive control", () => {
    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);

    expect(screen.getByText(/Enter the corridor/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enter the corridor/i })).toBeNull();
  });

  it("keeps the final rail inert until it is visible", () => {
    const flushFrames = installAnimationFrameQueue();
    vi.stubGlobal("innerHeight", 900);
    vi.stubGlobal("scrollY", 0);

    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);
    const section = document.querySelector<HTMLElement>(".cinematic-scroll");
    const final = document.querySelector<HTMLElement>(".pc-final");
    expect(section).toBeTruthy();
    expect(final).toBeTruthy();
    if (!section || !final) throw new Error("Proof Corridor timeline is missing");
    expect(final.hasAttribute("inert")).toBe(true);

    Object.defineProperty(section, "offsetHeight", { configurable: true, value: 4600 });
    section.getBoundingClientRect = () => ({
      bottom: 4600,
      height: 4600,
      left: 0,
      right: 1440,
      top: 0,
      width: 1440,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));
    act(() => flushFrames());

    vi.stubGlobal("scrollY", 3700);
    fireEvent.scroll(window);
    act(() => flushFrames());

    expect(final.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("link", { name: /Console/i }).getAttribute("href")).toBe("/app");

    const css = readFileSync(proofCorridorCssPath, "utf8");
    expect(css).toMatch(/\.pc-final\[inert\][^\{]*\{[^\}]*pointer-events: none;/s);
  });

  it("keeps the final rail interactive immediately for reduced motion", () => {
    vi.stubGlobal("matchMedia", reducedMotionMatchMedia());

    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);

    expect(document.querySelector(".pc-final")?.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("link", { name: /Payment checker/i }).getAttribute("href")).toBe("/audit");
  });

  it("preserves every payment-request term on mobile", () => {
    const css = readFileSync(proofCorridorCssPath, "utf8");

    expect(css).not.toMatch(/\.pc-request-card__terms div:last-child\s*\{\s*display:\s*none;/);
  });

  it("describes the evidence console's real workflow", () => {
    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);

    expect(screen.getByRole("link", { name: /Console/i }).textContent).toContain(
      "Follow a quote through x402 settlement, Merkle verification, and the registry workflow.",
    );
  });

  it("labels receipt finalization as always-live and keeps anchoring qualified", () => {
    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);

    expect(screen.getByText("Finalize receipt")).toBeTruthy();
    expect(screen.queryByText("Anchor receipt")).toBeNull();
    expect(screen.getByText(/when configured, can be anchored on Casper Testnet/i)).toBeTruthy();
  });
});
