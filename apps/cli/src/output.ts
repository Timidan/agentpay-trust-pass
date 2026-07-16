import { canonicalJson } from "@agent-pay/core";

export type ExitCode = 0 | 2 | 3 | 4;

export type CommandResult = {
  value: unknown;
  exitCode: ExitCode;
  summary: string;
};

export type CommandError = {
  code: string;
  message: string;
  retryable?: boolean;
  verdict?: string;
  checkId?: string | null;
};

export function paymentVerdictExitCode(verdict: unknown): ExitCode {
  if (verdict === "pay") return 0;
  if (verdict === "review") return 2;
  if (verdict === "block") return 3;
  return 4;
}

export function settlementVerdictExitCode(verdict: unknown): ExitCode {
  if (verdict === "match") return 0;
  if (verdict === "pending") return 2;
  if (verdict === "mismatch") return 3;
  return 4;
}

export function writeResult(result: CommandResult, json: boolean): void {
  process.stdout.write(`${json ? canonicalJson(result.value) : result.summary}\n`);
}

export function writeError(error: CommandError, json: boolean): void {
  const line = json ? canonicalJson({ error }) : `Error: ${error.message}`;
  const stream = json ? process.stdout : process.stderr;
  stream.write(`${line}\n`);
}
