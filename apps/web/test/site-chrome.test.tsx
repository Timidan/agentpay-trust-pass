import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SiteFooter, SiteNav } from "../src/components/SiteChrome";

afterEach(cleanup);

describe("site chrome navigation", () => {
  it("keeps product checks in the primary story and moves the console to the footer", () => {
    render(
      <>
        <SiteNav current="app" sub="Evidence console" />
        <SiteFooter current="app" />
      </>
    );

    const primary = screen.getByRole("navigation", { name: "AgentPay pages" });
    expect(within(primary).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Payment checker", "/audit"],
      ["Token check", "/check"],
      ["Wallet check", "/counterparty"],
      ["Shared results", "/feed"],
      ["Agents", "/agents"]
    ]);
    expect(within(primary).queryByRole("link", { name: "Console" })).toBeNull();

    const footer = screen.getByRole("navigation", { name: "AgentPay pages, footer" });
    expect(within(footer).getByRole("link", { name: "Console" }).getAttribute("href")).toBe("/app");
  });
});
