import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FeedPage from "../src/trust/FeedPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Shared results", () => {
  it("links every result directly to its AgentPay card image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            entries: [
              {
                id: "relative",
                aspect: "CLEAR",
                subjectShortHash: "12345678",
                cardImageUrl: "/card/example.png"
              },
              {
                id: "absolute",
                aspect: "CAUTION",
                subjectShortHash: "abcdef01",
                cardImageUrl: "https://cards.example/result.png"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    render(<FeedPage />);

    // Scope to the results list: the shared site nav and footer add their own links.
    const list = await screen.findByRole("list", { name: "Shared check results" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    const relativeLink = screen.getByRole("link", { name: "Clear, 12345678" });
    const absoluteLink = screen.getByRole("link", { name: "Caution, abcdef01" });

    expect(relativeLink.getAttribute("href")).toBe("http://localhost:3000/api/card/example.png");
    expect(absoluteLink.getAttribute("href")).toBe("https://cards.example/result.png");
  });
});
