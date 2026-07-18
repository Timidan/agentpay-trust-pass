import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SignalFieldPage from "../../src/cinematic/signal-field/SignalFieldPage";

describe("Signal Field", () => {
  it("keeps the experiment minimal while exposing a usable signal catalog", () => {
    render(
      <MemoryRouter>
        <SignalFieldPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Every payment leaves a shape.",
      }),
    ).toBeTruthy();
    expect(screen.getByText("AgentPay makes it legible.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Signal anatomy" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Wallet boundary/i }).getAttribute("href"),
    ).toBe("/agents");
  });
});
