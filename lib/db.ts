import { createClient, type Client } from "@libsql/client/web";

export type BookmarkKind = "link" | "html";

export type Bookmark = {
  id: number;
  kind: BookmarkKind;
  url: string;
  title: string;
  description: string;
  favicon: string;
  categories: number[]; // category ids (many-to-many)
  created_at: number;
  // `content` (full HTML for kind='html') is intentionally omitted from list
  // responses — fetched on demand via /view/[id].
};

export type Category = {
  id: number;
  name: string;
  created_at: number;
};

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function readEnv(): { url: string; authToken: string } {
  // process.env works in `next dev` (loaded from .env) and is populated by
  // the OpenNext Cloudflare adapter from the worker env at runtime.
  const url = process.env.TURSO_URL;
  const authToken = process.env.TURSO_TOKEN;
  if (!url) throw new Error("TURSO_URL is not set");
  return { url, authToken: authToken ?? "" };
}

export function getDb(): Client {
  if (!client) {
    const { url, authToken } = readEnv();
    client = createClient({ url, authToken });
  }
  return client;
}

/** Lazily create the table once per worker instance. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getDb();
      await db.execute(
        `CREATE TABLE IF NOT EXISTS bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL DEFAULT 'link',
          url TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          favicon TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL
        )`,
      );
      await db.execute(
        `CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      );
      // Many-to-many: a bookmark can belong to several categories.
      await db.execute(
        `CREATE TABLE IF NOT EXISTS bookmark_categories (
          bookmark_id INTEGER NOT NULL,
          category_id INTEGER NOT NULL,
          PRIMARY KEY (bookmark_id, category_id)
        )`,
      );
      // Single-row data version. Bumped on every write; the client polls it
      // (one tiny read) and only reloads everything when it changed.
      await db.execute(
        `CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        )`,
      );
      await db.execute(
        "INSERT OR IGNORE INTO meta (key, value) VALUES ('version', 1)",
      );
      // Migrate older tables created before these columns existed.
      for (const col of [
        "kind TEXT NOT NULL DEFAULT 'link'",
        "content TEXT NOT NULL DEFAULT ''",
      ]) {
        try {
          await db.execute(`ALTER TABLE bookmarks ADD COLUMN ${col}`);
        } catch {
          /* column already exists — ignore */
        }
      }
      // Fold any legacy single-category assignments into the join table.
      try {
        await db.execute(
          `INSERT OR IGNORE INTO bookmark_categories (bookmark_id, category_id)
           SELECT id, category_id FROM bookmarks WHERE category_id IS NOT NULL`,
        );
      } catch {
        /* no legacy category_id column — fine */
      }
    })()
      .then(() => undefined)
      .catch((err) => {
        // reset so a later request can retry
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

/** Increment and return the data version. Call once per write. */
export async function bumpVersion(): Promise<number> {
  const rs = await getDb().execute(
    `INSERT INTO meta (key, value) VALUES ('version', 1)
     ON CONFLICT(key) DO UPDATE SET value = value + 1
     RETURNING value`,
  );
  return Number(rs.rows[0]?.value ?? 1);
}

/** Read the current data version (one-row read). */
export async function getVersion(): Promise<number> {
  const rs = await getDb().execute(
    "SELECT value FROM meta WHERE key = 'version'",
  );
  return Number(rs.rows[0]?.value ?? 0);
}
