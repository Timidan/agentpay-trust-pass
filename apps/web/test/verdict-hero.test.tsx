import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPayVerdictHero } from "../src/components/AgentPayVerdictHero";

afterEach(cleanup);

describe("console verdict summary", () => {
  it("never says that a caution verdict has no recorded flags", () => {
    render(
      <AgentPayVerdictHero
        evidenceNetwork="casper-mainnet"
        mode="verdict"
        networkLabel="Casper Mainnet"
        onChangeEvidenceNetwork={vi.fn()}
        onChangeSubject={vi.fn()}
        onRun={vi.fn()}
        primaryLabel="Checking"
        running={false}
        settlementHash={null}
        subjectInput="WCSPR"
        subjectLabel="WCSPR"
        summary={null}
        verdict={{
          aspect: "CAUTION",
          decision: "needs_review",
          flags: [],
          notChecked: [],
          passed: []
        }}
      />
    );

    expect(screen.getByText("Review the check results below before you continue.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("No specific flags were recorded");
  });
});
