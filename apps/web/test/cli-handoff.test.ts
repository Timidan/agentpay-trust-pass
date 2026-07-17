import { describe, expect, it } from "vitest";
import { shellArgument } from "../src/audit/cliHandoff";

describe("CLI handoff quoting", () => {
  it("quotes spaces, substitutions, and embedded single quotes as one inert argument", () => {
    expect(shellArgument("https://svc.example/pay?note=a b'$(touch /tmp/x)"))
      .toBe("'https://svc.example/pay?note=a b'\"'\"'$(touch /tmp/x)'");
  });

  it("quotes angle-bracket placeholders so shells do not treat them as redirections", () => {
    expect(shellArgument("<buyer-key.pem>")).toBe("'<buyer-key.pem>'");
  });
});
