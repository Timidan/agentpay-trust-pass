import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseVerdictCardData, type VerdictCardData } from "./card.js";

export type PublicFeedEntry = {
  id: string;
  aspect: VerdictCardData["aspect"];
  subjectShortHash: string;
  cardImageUrl: string;
};

export type ShareCardResult = "shared" | "already_shared" | "unknown_card";

export interface PublicArtifactStore {
  saveCard(id: string, data: VerdictCardData, maximumCards: number): void;
  getCard(id: string): VerdictCardData | null;
  shareCard(id: string, maximumFeedEntries: number): ShareCardResult;
  listFeed(): PublicFeedEntry[];
  close(): void;
}

export function createMemoryPublicArtifactStore(): PublicArtifactStore {
  return new MemoryPublicArtifactStore();
}

export function openSqlitePublicArtifactStore(path: string): PublicArtifactStore {
  if (!path) throw new TypeError("Public artifact SQLite path must not be empty");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new SqlitePublicArtifactStore(path);
}

export function isPublicArtifactId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(value);
}

class MemoryPublicArtifactStore implements PublicArtifactStore {
  private readonly cards = new Map<string, VerdictCardData>();
  private readonly feed: string[] = [];

  saveCard(id: string, data: VerdictCardData, maximumCards: number): void {
    validateId(id);
    validateMaximum(maximumCards, "maximumCards");
    if (!this.cards.has(id)) this.cards.set(id, copyCard(data));
    while (this.cards.size > maximumCards) {
      const oldestId = this.cards.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.cards.delete(oldestId);
      removeItem(this.feed, oldestId);
    }
  }

  getCard(id: string): VerdictCardData | null {
    const data = this.cards.get(id);
    return data ? copyCard(data) : null;
  }

  shareCard(id: string, maximumFeedEntries: number): ShareCardResult {
    validateId(id);
    validateMaximum(maximumFeedEntries, "maximumFeedEntries");
    if (!this.cards.has(id)) return "unknown_card";
    if (this.feed.includes(id)) return "already_shared";
    this.feed.push(id);
    while (this.feed.length > maximumFeedEntries) this.feed.shift();
    return "shared";
  }

  listFeed(): PublicFeedEntry[] {
    return this.feed
      .slice()
      .reverse()
      .flatMap((id) => {
        const card = this.cards.get(id);
        return card ? [feedEntry(id, card)] : [];
      });
  }

  close(): void {}
}

class SqlitePublicArtifactStore implements PublicArtifactStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS public_verdict_cards (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public_feed_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL UNIQUE,
        FOREIGN KEY (card_id) REFERENCES public_verdict_cards(id) ON DELETE CASCADE
      );
    `);
  }

  saveCard(id: string, data: VerdictCardData, maximumCards: number): void {
    validateId(id);
    validateMaximum(maximumCards, "maximumCards");
    this.transaction(() => {
      this.database
        .prepare("INSERT OR IGNORE INTO public_verdict_cards (id, data_json) VALUES (?, ?)")
        .run(id, JSON.stringify(data));
      const count = this.count("public_verdict_cards");
      const excess = count - maximumCards;
      if (excess > 0) {
        this.database
          .prepare(`DELETE FROM public_verdict_cards
                    WHERE sequence IN (
                      SELECT sequence FROM public_verdict_cards ORDER BY sequence ASC LIMIT ?
                    )`)
          .run(excess);
      }
    });
  }

  getCard(id: string): VerdictCardData | null {
    const row = this.database
      .prepare("SELECT data_json FROM public_verdict_cards WHERE id = ?")
      .get(id) as { data_json?: unknown } | undefined;
    if (!row) return null;
    return parseStoredCard(row.data_json);
  }

  shareCard(id: string, maximumFeedEntries: number): ShareCardResult {
    validateId(id);
    validateMaximum(maximumFeedEntries, "maximumFeedEntries");
    return this.transaction(() => {
      if (!this.getCard(id)) return "unknown_card";
      const result = this.database
        .prepare("INSERT OR IGNORE INTO public_feed_entries (card_id) VALUES (?)")
        .run(id);
      if (result.changes === 0) return "already_shared";
      const count = this.count("public_feed_entries");
      const excess = count - maximumFeedEntries;
      if (excess > 0) {
        this.database
          .prepare(`DELETE FROM public_feed_entries
                    WHERE sequence IN (
                      SELECT sequence FROM public_feed_entries ORDER BY sequence ASC LIMIT ?
                    )`)
          .run(excess);
      }
      return "shared";
    });
  }

  listFeed(): PublicFeedEntry[] {
    const rows = this.database
      .prepare(`SELECT f.card_id, c.data_json
                FROM public_feed_entries f
                JOIN public_verdict_cards c ON c.id = f.card_id
                ORDER BY f.sequence DESC`)
      .all() as Array<{ card_id?: unknown; data_json?: unknown }>;
    return rows.map((row) => {
      if (typeof row.card_id !== "string") throw new Error("Stored feed card id is invalid");
      return feedEntry(row.card_id, parseStoredCard(row.data_json));
    });
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private count(table: "public_verdict_cards" | "public_feed_entries"): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count?: unknown;
    };
    if (typeof row.count !== "number" || !Number.isSafeInteger(row.count)) {
      throw new Error(`Could not count ${table}`);
    }
    return row.count;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function parseStoredCard(value: unknown): VerdictCardData {
  if (typeof value !== "string") throw new Error("Stored verdict card JSON is invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("Stored verdict card JSON is invalid", { cause: error });
  }
  const card = parseVerdictCardData(parsed);
  if (!card) throw new Error("Stored verdict card data is invalid");
  return card;
}

function feedEntry(id: string, card: VerdictCardData): PublicFeedEntry {
  return {
    id,
    aspect: card.aspect,
    subjectShortHash: card.subjectShortHash,
    cardImageUrl: `/card/${id}.png`
  };
}

function copyCard(data: VerdictCardData): VerdictCardData {
  return {
    ...data,
    flags: data.flags.map((flag) => ({ ...flag })),
    notChecked: [...data.notChecked]
  };
}

function validateId(id: string): void {
  if (!isPublicArtifactId(id)) {
    throw new TypeError("Public artifact id is invalid");
  }
}

function validateMaximum(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function removeItem(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}
