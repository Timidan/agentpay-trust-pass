// Throwaway: capture the current UI for an honest AI-slop critique. Delete after.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5174";
const OUT = "/tmp/agentpay-look";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "AgentPay", exact: true }).first().waitFor();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/01-hero-light.png` });
await page.screenshot({ path: `${OUT}/02-full-light.png`, fullPage: true });
// scroll the how-it-works + proof-model into view for reveal animations
await page.evaluate(() => document.getElementById("how-it-works")?.scrollIntoView({ block: "start" }));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/03-how-it-works.png` });
await page.evaluate(() => document.getElementById("proof-model")?.scrollIntoView({ block: "start" }));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/04-proof-model.png` });
// dark mode hero
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
const dark = page.getByRole("button", { name: /Switch to dark mode/i }).first();
if (await dark.count()) await dark.click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/05-hero-dark.png` });
await browser.close();
console.log("captured");
