import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../src/App";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("cinematic routes", () => {
  for (const [path, heading] of [
    ["/cinematic/proof-corridor", "The path from charge to proof."],
    ["/cinematic/signal-field", "Every payment leaves a shape."],
    ["/cinematic/evidence-chamber", "Before the wallet signs anything."],
  ] as const) {
    it(`renders ${path} directly`, () => {
      window.history.pushState({}, "", path);
      render(<App />);
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
      expect(document.documentElement.classList.contains("route-cinematic")).toBe(true);
    });
  }

  it("leaves the existing landing copy intact", () => {
    render(<App />);
    expect(screen.getByText("From the charge to a receipt on Casper.")).toBeTruthy();
    expect(document.documentElement.classList.contains("route-cinematic")).toBe(false);
  });
});
