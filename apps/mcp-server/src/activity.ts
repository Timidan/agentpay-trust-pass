/**
 * In-memory feed of real bridge traffic. Every /tools/* call an agent makes
 * (MCP stdio excluded — that transport has its own client) lands here so the
 * web console can observe live activity instead of simulating a connection.
 */

export type BridgeActivityEntry = {
  tool: string;
  status: number;
  ms: number;
  at: string;
};

const MAX_ENTRIES = 50;
const entries: BridgeActivityEntry[] = [];

export function recordBridgeActivity(entry: BridgeActivityEntry): void {
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }
}

export function listBridgeActivity(): BridgeActivityEntry[] {
  return [...entries];
}
