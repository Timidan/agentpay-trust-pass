import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import EvidenceChamberPage from "../../src/cinematic/evidence-chamber/EvidenceChamberPage";

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
});
