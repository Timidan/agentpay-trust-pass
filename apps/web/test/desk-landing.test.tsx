import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPayIconAction, AgentPayTooltipProvider } from "../src/components/AgentPayUi";
import App from "../src/App";

function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Landing integration", () => {
  it("renders the Desk landing by default and opens the console on Launch", () => {
    render(<App />);
    // Desk-unique copy proves LandingDesk (not the old hero) is mounted.
    expect(screen.getByText("One rail, four stops, always in order.")).toBeTruthy();
    // Launch opens the console workspace.
    fireEvent.click(screen.getAllByRole("button", { name: /launch agentpay/i })[0]);
    expect(screen.getByText("Token check console")).toBeTruthy();
  });
});

describe("AgentPayIconAction", () => {
  it("renders an icon button with the label and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <AgentPayTooltipProvider>
        <AgentPayIconAction label="Switch to dark mode" onClick={onClick}>
          <span aria-hidden="true">x</span>
        </AgentPayIconAction>
      </AgentPayTooltipProvider>
    );
    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

import LandingDesk from "../src/landing/LandingDesk";
import { AgentPayTooltipProvider as Provider } from "../src/components/AgentPayUi";

describe("LandingDesk theme toggle", () => {
  const noop = () => {};

  it("shows the correct aria-label per theme and fires onToggleTheme", () => {
    const onToggleTheme = vi.fn();
    const { rerender } = render(
      <Provider>
        <LandingDesk
          theme="light"
          onToggleTheme={onToggleTheme}
          onOpenApp={noop}
          onOpenTrust={noop}
          onOpenFeed={noop}
          onOpenAgents={noop}
        />
      </Provider>
    );
    const toLight = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(toLight);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    rerender(
      <Provider>
        <LandingDesk
          theme="dark"
          onToggleTheme={onToggleTheme}
          onOpenApp={noop}
          onOpenTrust={noop}
          onOpenFeed={noop}
          onOpenAgents={noop}
        />
      </Provider>
    );
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeTruthy();
  });
});

describe("Illustrative data labeling", () => {
  const noop = () => {};
  it("shows a visible Example/Demo qualifier on the feed", () => {
    render(
      <Provider>
        <LandingDesk
          theme="light"
          onToggleTheme={noop}
          onOpenApp={noop}
          onOpenTrust={noop}
          onOpenFeed={noop}
          onOpenAgents={noop}
        />
      </Provider>
    );
    // Visible (not sr-only) qualifier — asserts on the specific visible bar string.
    expect(screen.getByText(/example · settlement desk/i)).toBeTruthy();
  });
});

describe("Theme persistence", () => {
  it("initializes theme from localStorage", () => {
    window.localStorage.setItem("agentpay-theme", "dark");
    render(<App />);
    // The theme effect adds the `dark` class to <html> when theme is dark.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    window.localStorage.removeItem("agentpay-theme");
  });
});

describe("Ask/Feed entry points", () => {
  it("exposes Ask + Feed links on the landing and opens the Ask page (and returns home)", () => {
    render(<App />);
    // Both entry points are present on the Desk landing (nav + footer both expose them).
    expect(screen.getAllByRole("button", { name: "Check a token" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Recent checks" }).length).toBeGreaterThan(0);
    // "Check a token" opens the Ask page (AskPage-unique copy).
    fireEvent.click(screen.getAllByRole("button", { name: "Check a token" })[0]);
    expect(screen.getByText(/paste a casper token address/i)).toBeTruthy();
    // "Overview" returns to the landing.
    fireEvent.click(screen.getByText("Overview"));
    expect(screen.getByText("One rail, four stops, always in order.")).toBeTruthy();
  });
});

describe("Agent integration entry point", () => {
  it("opens the agent integration page from the landing nav", () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: "Agent docs" })[0]);

    expect(screen.getByRole("heading", { name: "How agents talk to AgentPay" })).toBeTruthy();
    expect(screen.getByText("curl $AGENT_PAY_BASE_URL/skill.md")).toBeTruthy();
    expect(screen.getByText("skill://agentpay")).toBeTruthy();
  });

  it("renders the agent integration page directly at /agents", () => {
    window.history.pushState({}, "", "/agents");

    render(<App />);

    expect(screen.getByRole("heading", { name: "How agents talk to AgentPay" })).toBeTruthy();
  });
});
