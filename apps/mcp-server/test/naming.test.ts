import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("AgentPay naming", () => {
  it("does not export product-owned Casper identifiers", async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    const files = await sourceFiles(join(repoRoot, "apps"));
    const offenders: string[] = [];
    const exportedIdentifierPatterns = [
      /\bexport\s+(?:async\s+)?function\s+([A-Za-z0-9_]*Casper[A-Za-z0-9_]*)/g,
      /\bexport\s+type\s+([A-Za-z0-9_]*Casper[A-Za-z0-9_]*)/g,
      /\bexport\s+interface\s+([A-Za-z0-9_]*Casper[A-Za-z0-9_]*)/g,
      /\bexport\s+class\s+([A-Za-z0-9_]*Casper[A-Za-z0-9_]*)/g
    ];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      for (const pattern of exportedIdentifierPatterns) {
        for (const match of contents.matchAll(pattern)) {
          offenders.push(`${relative(repoRoot, file)}:${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function sourceFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        if (["dist", "node_modules", "target", "test"].includes(entry.name)) {
          return [];
        }
        return sourceFiles(entryPath);
      }
      return entry.isFile() && /\.[cm]?[tj]sx?$/.test(entry.name) ? [entryPath] : [];
    })
  );
  return files.flat();
}
