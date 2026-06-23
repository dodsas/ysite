import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  bumpVersion,
  ensureSchema,
  getDb,
  userVersionKey,
  type Bookmark,
} from "@/lib/db";
import {
  faviconFor,
  fetchFaviconDataUrl,
  mapLimit,
  normalizeUrl,
} from "@/lib/metadata";

type IncomingBookmark = {
  kind?: "link" | "html";
  url?: string;
  title?: string;
  description?: string;
  content?: string;
};

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  await ensureSchema();
  const db = getDb();
  // `content` excluded on purpose — stored pages can be multi-MB.
  const [bRes, linkRes] = await Promise.all([
    db.execute({
      sql: `SELECT id, kind, url, title, description, favicon, created_at
            FROM bookmarks
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT bc.bookmark_id, bc.category_id
            FROM bookmark_categories bc
            JOIN bookmarks b ON b.id = bc.bookmark_id
            JOIN categories c ON c.id = bc.category_id
            WHERE b.user_id = ? AND c.user_id = ?`,
      args: [userId, userId],
    }),
  ]);

  const cats = new Map<number, number[]>();
  for (const row of linkRes.rows as unknown as {
    bookmark_id: number;
    category_id: number;
  }[]) {
    const list = cats.get(row.bookmark_id) ?? [];
    list.push(row.category_id);
    cats.set(row.bookmark_id, list);
  }

  const bookmarks = (bRes.rows as unknown as Omit<Bookmark, "categories">[]).map(
    (b) => ({ ...b, categories: cats.get(b.id) ?? [] }),
  );
  return NextResponse.json({ bookmarks });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  await ensureSchema();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Accept either a single bookmark or { bookmarks: [...] } for bulk import.
  const items: IncomingBookmark[] = Array.isArray((body as { bookmarks?: unknown })?.bookmarks)
    ? ((body as { bookmarks: IncomingBookmark[] }).bookmarks)
    : [body as IncomingBookmark];

  // A category applied to all newly added items (e.g. the active filter).
  const defaultCat =
    typeof (body as { categoryId?: unknown }).categoryId === "number"
      ? (body as { categoryId: number }).categoryId
      : null;
  const db = getDb();

  if (defaultCat != null) {
    const cat = await db.execute({
      sql: "SELECT id FROM categories WHERE id = ? AND user_id = ?",
      args: [defaultCat, userId],
    });
    if (!cat.rows[0]) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
  }

  const now = Date.now();
  const rows = items
    .map((it) => {
      const content = (it.content ?? "").trim();
      // A saved standalone page: no URL, just stored HTML.
      if (it.kind === "html" || (content && !it.url)) {
        if (!content) return null;
        return {
          kind: "html" as const,
          url: "",
          title: (it.title ?? "").trim() || "제목 없는 페이지",
          description: (it.description ?? "").trim(),
          favicon: "",
          content,
          created_at: now,
        };
      }
      const url = normalizeUrl(it.url ?? "");
      if (!url) return null;
      return {
        kind: "link" as const,
        url,
        title: (it.title ?? "").trim(),
        description: (it.description ?? "").trim(),
        favicon: "", // filled with an inlined data URI below
        content: "",
        created_at: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ error: "no valid bookmark" }, { status: 400 });
  }

  // Inline each link's favicon once (data URI) so the client renders it with
  // no network request. Only for small adds — large imports would blow the
  // Workers subrequest cap, so those get the live URL and rely on /cache-icons.
  const linkCount = rows.filter((r) => r.kind === "link").length;
  if (linkCount <= 8) {
    await mapLimit(rows, 8, async (r) => {
      if (r.kind === "link") {
        r.favicon = (await fetchFaviconDataUrl(r.url)) || faviconFor(r.url);
      }
    });
  } else {
    for (const r of rows) if (r.kind === "link") r.favicon = faviconFor(r.url);
  }

  const results = await db.batch(
    rows.map((r) => ({
      sql: "INSERT INTO bookmarks (user_id, kind, url, title, description, favicon, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [userId, r.kind, r.url, r.title, r.description, r.favicon, r.content, r.created_at],
    })),
    "write",
  );

  const ids = results.map((r) => Number(r.lastInsertRowid));

  // Link the new bookmarks to the active category, if any.
  if (defaultCat != null && ids.length > 0) {
    await db.batch(
      ids.map((bid) => ({
        sql: "INSERT OR IGNORE INTO bookmark_categories (bookmark_id, category_id) VALUES (?, ?)",
        args: [bid, defaultCat],
      })),
      "write",
    );
  }

  const version = await bumpVersion(userVersionKey(userId));

  // Return the created rows so the client can prepend without a full reload.
  const created: Bookmark[] = rows.map((r, i) => ({
    id: ids[i],
    kind: r.kind,
    url: r.url,
    title: r.title,
    description: r.description,
    favicon: r.favicon,
    categories: defaultCat != null ? [defaultCat] : [],
    created_at: r.created_at,
  }));

  return NextResponse.json(
    { inserted: rows.length, version, bookmarks: created },
    { status: 201 },
  );
}
