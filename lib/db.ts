import { createClient, type Client } from "@libsql/client/web";

export type BookmarkKind = "link" | "html";

export type Bookmark = {
  id: number;
  user_id?: string;
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
  user_id?: string;
  name: string;
  position: number;
  created_at: number;
};

export type StoredUser = {
  id: string;
  name: string;
  nickname: string;
  email: string;
  profile_image: string;
  updated_at: number;
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
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          nickname TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          profile_image TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL
        )`,
      );
      await db.execute(
        `CREATE TABLE IF NOT EXISTS bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL DEFAULT '',
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
          user_id TEXT NOT NULL DEFAULT '',
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
      // Translation cache (KO<->EN search). hits drives LFU eviction at 10k.
      await db.execute(
        `CREATE TABLE IF NOT EXISTS translations (
          q TEXT PRIMARY KEY,
          translated TEXT NOT NULL DEFAULT '',
          hits INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
        )`,
      );
      await db.execute(
        "INSERT OR IGNORE INTO meta (key, value) VALUES ('tversion', 1)",
      );
      // Migrate older tables created before these columns existed.
      for (const col of [
        "user_id TEXT NOT NULL DEFAULT ''",
        "kind TEXT NOT NULL DEFAULT 'link'",
        "content TEXT NOT NULL DEFAULT ''",
      ]) {
        try {
          await db.execute(`ALTER TABLE bookmarks ADD COLUMN ${col}`);
        } catch {
          /* column already exists — ignore */
        }
      }
      // Category ordering (drag to reorder). NULL = unset → seed by id once.
      try {
        await db.execute("ALTER TABLE categories ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
      } catch {
        /* already exists */
      }
      try {
        await db.execute("ALTER TABLE categories ADD COLUMN position INTEGER");
      } catch {
        /* already exists */
      }
      await db.execute(
        "UPDATE categories SET position = id WHERE position IS NULL",
      );
      // Fold any legacy single-category assignments into the join table.
      try {
        await db.execute(
          `INSERT OR IGNORE INTO bookmark_categories (bookmark_id, category_id)
           SELECT id, category_id FROM bookmarks WHERE category_id IS NOT NULL`,
        );
      } catch {
        /* no legacy category_id column — fine */
      }
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created ON bookmarks (user_id, created_at DESC, id DESC)",
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_categories_user_position ON categories (user_id, position ASC, id ASC)",
      );
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

export function userVersionKey(userId: string): string {
  return `version:${userId}`;
}

export async function upsertUser(user: {
  id: string;
  name: string;
  nickname: string;
  email: string;
  profileImage: string;
}): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `INSERT INTO users (id, name, nickname, email, profile_image, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            nickname = excluded.nickname,
            email = excluded.email,
            profile_image = excluded.profile_image,
            updated_at = excluded.updated_at`,
    args: [
      user.id,
      user.name,
      user.nickname,
      user.email,
      user.profileImage,
      Date.now(),
    ],
  });
}

export async function claimLegacyDataForUser(userId: string): Promise<number> {
  await ensureSchema();
  const db = getDb();
  const [bookmarkCount, categoryCount] = await Promise.all([
    db.execute({
      sql: "SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = ?",
      args: [""],
    }),
    db.execute({
      sql: "SELECT COUNT(*) AS c FROM categories WHERE user_id = ?",
      args: [""],
    }),
  ]);
  const total =
    Number(bookmarkCount.rows[0]?.c ?? 0) + Number(categoryCount.rows[0]?.c ?? 0);
  if (total === 0) return 0;

  await db.batch(
    [
      {
        sql: "UPDATE bookmarks SET user_id = ? WHERE user_id = ?",
        args: [userId, ""],
      },
      {
        sql: "UPDATE categories SET user_id = ? WHERE user_id = ?",
        args: [userId, ""],
      },
    ],
    "write",
  );
  await bumpVersion(userVersionKey(userId));
  return total;
}

/** Increment and return a version counter. Call once per write. */
export async function bumpVersion(key = "version"): Promise<number> {
  const rs = await getDb().execute({
    sql: `INSERT INTO meta (key, value) VALUES (?, 1)
          ON CONFLICT(key) DO UPDATE SET value = value + 1
          RETURNING value`,
    args: [key],
  });
  return Number(rs.rows[0]?.value ?? 1);
}

/** Read a version counter (one-row read). */
export async function getVersion(key = "version"): Promise<number> {
  const rs = await getDb().execute({
    sql: "SELECT value FROM meta WHERE key = ?",
    args: [key],
  });
  return Number(rs.rows[0]?.value ?? 0);
}
