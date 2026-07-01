import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "agents",
  "SKILL.md"
);

export const AGENT_PAY_SKILL_URI = "skill://agentpay";

export function agentPaySkillMarkdown(origin = agentPayPublicOrigin()) {
  if (!existsSync(SKILL_PATH)) {
    throw new Error(`AgentPay skill file not found at ${SKILL_PATH}`);
  }
  return readFileSync(SKILL_PATH, "utf8").replace(/\$AGENT_PAY_BASE_URL/g, origin);
}

export function agentPayPublicOrigin() {
  const configured = process.env.AGENT_PAY_PUBLIC_ORIGIN?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return process.env.REPORT_API_URL ?? `http://127.0.0.1:${process.env.REPORT_API_PORT ?? 4021}`;
}
