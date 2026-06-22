import { NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";
import { fetchPageMeta } from "@/lib/metadata";

// Re-resolve every link bookmark's favicon to the site's real declared icon.
export async function POST() {
  await ensureSchema();
  const db = getDb();
  const rs = await db.execute(
    "SELECT id, url FROM bookmarks WHERE kind = 'link' AND url <> ''",
  );
  const targets = rs.rows as unknown as { id: number; url: string }[];

  // Resolve icons with bounded concurrency so we don't open hundreds of
  // sockets at once.
  const CONCURRENCY = 6;
  const updates: { id: number; favicon: string }[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      try {
        const { favicon } = await fetchPageMeta(t.url);
        if (favicon) updates.push({ id: t.id, favicon });
      } catch {
        /* leave this one as-is */
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker),
  );

  if (updates.length > 0) {
    await db.batch(
      updates.map((u) => ({
        sql: "UPDATE bookmarks SET favicon = ? WHERE id = ?",
        args: [u.favicon, u.id],
      })),
      "write",
    );
  }

  return NextResponse.json({ updated: updates.length, total: targets.length });
}
