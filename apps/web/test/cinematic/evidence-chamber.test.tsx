import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import EvidenceChamberPage from "../../src/cinematic/evidence-chamber/EvidenceChamberPage";

const evidenceChamberCssPath = resolve(
  process.cwd(),
  "src/cinematic/evidence-chamber/evidence-chamber.css",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Evidence Chamber", () => {
  it("shows the exact audit sequence and real actions", () => {
    render(
      <MemoryRouter>
        <EvidenceChamberPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Before the wallet signs anything.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Amount, asset, network, payee, and request binding."),
    ).toBeTruthy();
    expect(screen.getByText("PIN / DENY and spend controls")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Open payment checker/i }).getAttribute("href"),
    ).toBe("/audit");
  });

  it("unlocks only after the final fade and locks again when progress reverses", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    render(
      <MemoryRouter>
        <EvidenceChamberPage />
      </MemoryRouter>,
    );

    const stage = document.querySelector<HTMLElement>(".ec-stage");
    const final = document.querySelector<HTMLElement>(".ec-final");
    if (!stage || !final) throw new Error("Evidence Chamber timeline is missing");

    expect(final.hasAttribute("inert")).toBe(true);

    act(() => stage.style.setProperty("--cinematic-p", "0.96"));
    await waitFor(() => expect(final.hasAttribute("inert")).toBe(false));

    act(() => stage.style.setProperty("--cinematic-p", "0.9499"));
    await waitFor(() => expect(final.hasAttribute("inert")).toBe(true));

    act(() => stage.style.setProperty("--cinematic-p", "0.95"));
    await waitFor(() => expect(final.hasAttribute("inert")).toBe(false));

    act(() => stage.style.setProperty("--cinematic-p", "0.9499"));
    await waitFor(() => expect(final.hasAttribute("inert")).toBe(true));
  });

  it("separates mobile narrative and evidence into distinct vertical regions", () => {
    const css = readFileSync(evidenceChamberCssPath, "utf8");
    const mobileCss = css.slice(
      css.indexOf("@media (max-width: 640px)"),
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );

    expect(mobileCss).toContain("--ec-mobile-panel-center: 31%;");
    expect(mobileCss).toContain("--ec-mobile-evidence-center: 70%;");
    expect(mobileCss).toMatch(/\.ec-panel\s*\{[^}]*top:\s*var\(--ec-mobile-panel-center\);/s);
    expect(mobileCss).toMatch(
      /\.ec-evidence__layer\s*\{[^}]*top:\s*var\(--ec-mobile-evidence-center\);/s,
    );
  });
});
