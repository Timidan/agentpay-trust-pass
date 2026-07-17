import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VerdictCardData } from "../src/card.js";
import {
  createMemoryPublicArtifactStore,
  openSqlitePublicArtifactStore
} from "../src/publicArtifacts.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.each([
  ["memory", () => createMemoryPublicArtifactStore()],
  ["sqlite", () => openSqlitePublicArtifactStore(temporaryDatabasePath())]
] as const)("public artifact store: %s", (_name, createStore) => {
  it("stores cards and returns shared entries newest first", () => {
    const store = createStore();
    try {
      store.saveCard("card-first", card("aaaaaaaa"), 10);
      store.saveCard("card-second", card("bbbbbbbb"), 10);

      expect(store.shareCard("card-first", 10)).toBe("shared");
      expect(store.shareCard("card-second", 10)).toBe("shared");
      expect(store.shareCard("card-second", 10)).toBe("already_shared");
      expect(store.shareCard("card-missing", 10)).toBe("unknown_card");

      expect(store.listFeed()).toEqual([
        {
          id: "card-second",
          aspect: "CLEAR",
          subjectShortHash: "bbbbbbbb",
          cardImageUrl: "/card/card-second.png"
        },
        {
          id: "card-first",
          aspect: "CLEAR",
          subjectShortHash: "aaaaaaaa",
          cardImageUrl: "/card/card-first.png"
        }
      ]);
      expect(store.getCard("card-first")).toEqual(card("aaaaaaaa"));
    } finally {
      store.close();
    }
  });

  it("enforces card and feed retention without leaving orphaned entries", () => {
    const store = createStore();
    try {
      store.saveCard("card-first", card("aaaaaaaa"), 2);
      store.saveCard("card-second", card("bbbbbbbb"), 2);
      expect(store.shareCard("card-first", 1)).toBe("shared");
      expect(store.shareCard("card-second", 1)).toBe("shared");
      expect(store.listFeed().map((entry) => entry.id)).toEqual(["card-second"]);

      store.saveCard("card-third", card("cccccccc"), 2);
      expect(store.getCard("card-first")).toBeNull();
      expect(store.getCard("card-second")).not.toBeNull();
      expect(store.getCard("card-third")).not.toBeNull();
      expect(store.listFeed().map((entry) => entry.id)).toEqual(["card-second"]);
    } finally {
      store.close();
    }
  });
});

describe("SQLite public artifact persistence", () => {
  it("survives a process-style close and reopen", () => {
    const path = temporaryDatabasePath();
    const first = openSqlitePublicArtifactStore(path);
    first.saveCard("card-persisted", card("dddddddd"), 10);
    expect(first.shareCard("card-persisted", 10)).toBe("shared");
    first.close();

    const reopened = openSqlitePublicArtifactStore(path);
    try {
      expect(reopened.getCard("card-persisted")).toEqual(card("dddddddd"));
      expect(reopened.listFeed()).toMatchObject([
        { id: "card-persisted", subjectShortHash: "dddddddd" }
      ]);
    } finally {
      reopened.close();
    }
  });
});

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentpay-public-artifacts-"));
  temporaryDirectories.push(directory);
  return join(directory, "agentpay.sqlite");
}

function card(subjectShortHash: string): VerdictCardData {
  return {
    aspect: "CLEAR",
    subjectShortHash,
    flags: [],
    notChecked: [],
    decisionTxHash: "4".repeat(64),
    policyHash: "5".repeat(64)
  };
}
