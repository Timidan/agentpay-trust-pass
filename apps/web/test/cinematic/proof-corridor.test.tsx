import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ProofCorridorPage from "../../src/cinematic/proof-corridor/ProofCorridorPage";

describe("Proof Corridor", () => {
  it("renders the full truthful product story and real final links", () => {
    render(<MemoryRouter><ProofCorridorPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "The path from charge to proof." })).toBeTruthy();
    expect(screen.getByText("Your wallet signs. AgentPay never receives the key.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Payment checker/i }).getAttribute("href")).toBe("/audit");
    expect(screen.getByRole("link", { name: /Console/i }).getAttribute("href")).toBe("/app");
  });

  it("uses browser-valid timeline segments and reveals the existing workflow icon strokes", () => {
    const css = readFileSync(resolve(process.cwd(), "src/cinematic/proof-corridor/proof-corridor.css"), "utf8");

    expect(css).not.toMatch(/--pc-[^:]+:[^;]+\/ 0\./);
    expect(css).toContain(".proof-corridor .pc-station__icon .tl-stroke");
    expect(css).toContain("stroke-dashoffset: 0");
  });

  it("keeps the hero first and all narrative beats in flow for reduced motion", () => {
    const css = readFileSync(resolve(process.cwd(), "src/cinematic/proof-corridor/proof-corridor.css"), "utf8");
    const reducedMotionCss = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedMotionCss).toContain("flex-direction: column");
    expect(reducedMotionCss).toContain(".proof-corridor .pc-opening { order: 1; }");
    expect(reducedMotionCss).toContain(".proof-corridor .pc-final { order: 7; }");
  });
});
