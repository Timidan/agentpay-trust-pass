import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_PATHS = [
  resolve(MODULE_DIR, "SKILL.md"),
  resolve(MODULE_DIR, "..", "..", "..", "docs", "agents", "SKILL.md")
];

export const AGENT_PAY_SKILL_URI = "skill://agentpay";

export function agentPaySkillMarkdown(origin = agentPayPublicOrigin()) {
  const skillPath = SKILL_PATHS.find((candidate) => existsSync(candidate));
  if (!skillPath) throw new Error("AgentPay skill file is missing");
  return readFileSync(skillPath, "utf8").replace(/\$AGENT_PAY_BASE_URL/g, origin);
}

export function agentPayPublicOrigin() {
  const configured =
    process.env.AGENT_PAY_PUBLIC_API_URL?.trim() ||
    process.env.AGENT_PAY_RESOURCE_BASE_URL?.trim() ||
    process.env.REPORT_API_PUBLIC_URL?.trim() ||
    process.env.AGENTPAY_PUBLIC_ORIGIN?.trim() ||
    process.env.AGENT_PAY_PUBLIC_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("AGENT_PAY_RESOURCE_BASE_URL is required for the public AgentPay skill");
  }
  return process.env.REPORT_API_URL ?? `http://127.0.0.1:${process.env.REPORT_API_PORT ?? 4021}`;
}
