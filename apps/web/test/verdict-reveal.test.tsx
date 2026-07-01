import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import VerdictRevealDemo from "../src/trust/VerdictRevealDemo";

afterEach(cleanup);

// jsdom has no WebGL, so VerdictReveal takes its fallback path and ships the
// final, readable state immediately — which is exactly the honesty guardrail we
// want to verify renders correctly.
describe("VerdictReveal prototype", () => {
  it("renders the default DANGER verdict and its rationale in the fallback path", () => {
    render(<VerdictRevealDemo />);
    const stage = document.querySelector(".vr-root") as HTMLElement;
    expect(stage).toBeTruthy();
    expect(stage.dataset.supported).toBe("fallback");
    expect(within(stage).getByText("DANGER")).toBeTruthy();
    expect(within(stage).getByText(/mint authority is still open/i)).toBeTruthy();
  });

  it("switches the verdict word and copy when another aspect is chosen", () => {
    render(<VerdictRevealDemo />);
    const stage = document.querySelector(".vr-root") as HTMLElement;

    // The control row and the reveal both say DANGER initially.
    fireEvent.click(screen.getByRole("button", { name: "CLEAR" }));

    expect(within(stage).getByText("CLEAR")).toBeTruthy();
    expect(within(stage).getByText(/basics check out/i)).toBeTruthy();
    expect(within(stage).queryByText(/mint authority is still open/i)).toBeNull();
  });
});
