import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();

describe("public social metadata", () => {
  it("publishes complete Open Graph and Twitter preview tags", async () => {
    const html = await readFile(`${webRoot}/index.html`, "utf8");

    expect(html).toContain(
      '<meta property="og:title" content="AgentPay: check x402 charges before paying on Casper" />'
    );
    expect(html).toContain(
      '<meta property="og:description" content="Read the charge, decide PAY, REVIEW, or BLOCK, and prove the settled payment matched." />'
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://agentpay.timidan.xyz/og-agentpay.png" />'
    );
    expect(html).toContain('<meta property="og:image:alt" content="AgentPay payment checker on Casper" />');
    expect(html).toContain('<meta property="og:url" content="https://agentpay.timidan.xyz" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(
      '<meta name="twitter:title" content="AgentPay: check x402 charges before paying on Casper" />'
    );
    expect(html).toContain(
      '<meta name="twitter:description" content="Read the charge, decide PAY, REVIEW, or BLOCK, and prove the settled payment matched." />'
    );
    expect(html).toContain(
      '<meta name="twitter:image" content="https://agentpay.timidan.xyz/og-agentpay.png" />'
    );
  });

  it("serves the social preview image from the public web root", async () => {
    const image = await stat(`${webRoot}/public/og-agentpay.png`);

    expect(image.isFile()).toBe(true);
    expect(image.size).toBeGreaterThan(0);
  });
});
