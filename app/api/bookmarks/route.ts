import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, type Bookmark } from "@/lib/db";
import { faviconFor, fetchPageMeta, normalizeUrl } from "@/lib/metadata";

type IncomingBookmark = {
  kind?: "link" | "html";
  url?: string;
  title?: string;
  description?: string;
  content?: string;
  favicon?: string;
};

const isHttpUrl = (s: unknown): s is string =>
  typeof s === "string" && /^https?:\/\//i.test(s);

export async function GET() {
  await ensureSchema();
  const db = getDb();
  // `content` excluded on purpose — stored pages can be multi-MB.
  const [bRes, linkRes] = await Promise.all([
    db.execute(
      "SELECT id, kind, url, title, description, favicon, created_at FROM bookmarks ORDER BY created_at DESC, id DESC",
    ),
    db.execute("SELECT bookmark_id, category_id FROM bookmark_categories"),
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
        // prefer the icon the client already resolved via /api/title
        favicon: isHttpUrl(it.favicon) ? it.favicon : "",
        content: "",
        created_at: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ error: "no valid bookmark" }, { status: 400 });
  }

  // Single manual add with no client-resolved icon → fetch the site's real
  // icon server-side. Bulk imports stay fast and fall back to the service.
  if (rows.length === 1 && rows[0].kind === "link" && !rows[0].favicon) {
    try {
      rows[0].favicon = (await fetchPageMeta(rows[0].url)).favicon;
    } catch {
      /* fall through to faviconFor below */
    }
  }
  for (const r of rows) {
    if (r.kind === "link" && !r.favicon) r.favicon = faviconFor(r.url);
  }

  const db = getDb();
  const results = await db.batch(
    rows.map((r) => ({
      sql: "INSERT INTO bookmarks (kind, url, title, description, favicon, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [r.kind, r.url, r.title, r.description, r.favicon, r.content, r.created_at],
    })),
    "write",
  );

  // Link the new bookmarks to the active category, if any.
  if (defaultCat != null) {
    const ids = results
      .map((r) => r.lastInsertRowid)
      .filter((x): x is bigint => x != null)
      .map((x) => Number(x));
    if (ids.length > 0) {
      await db.batch(
        ids.map((bid) => ({
          sql: "INSERT OR IGNORE INTO bookmark_categories (bookmark_id, category_id) VALUES (?, ?)",
          args: [bid, defaultCat],
        })),
        "write",
      );
    }
  }

  return NextResponse.json({ inserted: rows.length }, { status: 201 });
}
