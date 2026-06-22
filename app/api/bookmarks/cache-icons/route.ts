import { NextResponse } from "next/server";
import { bumpVersion, ensureSchema, getDb } from "@/lib/db";
import { faviconFor, fetchFaviconDataUrl, mapLimit } from "@/lib/metadata";

// Backfill: inline every link bookmark's favicon as a data URI (stored once,
// reused) for instant, network-free rendering.
export async function POST() {
  await ensureSchema();
  const db = getDb();
  const rs = await db.execute(
    "SELECT id, url, favicon FROM bookmarks WHERE kind = 'link' AND url <> ''",
  );
  const rows = rs.rows as unknown as { id: number; url: string; favicon: string }[];
  // Only those not already inlined. Cap per call to stay under the Workers
  // subrequest limit (free plan = 50); the client re-calls until remaining=0.
  const pending = rows.filter((r) => !String(r.favicon ?? "").startsWith("data:"));
  const BATCH = 40;
  const todo = pending.slice(0, BATCH);

  const updates = (
    await mapLimit(todo, 8, async (r) => {
      const data = (await fetchFaviconDataUrl(r.url)) || faviconFor(r.url);
      return data ? { id: r.id, favicon: data } : null;
    })
  ).filter((u): u is { id: number; favicon: string } => u !== null);

  if (updates.length > 0) {
    await db.batch(
      updates.map((u) => ({
        sql: "UPDATE bookmarks SET favicon = ? WHERE id = ?",
        args: [u.favicon, u.id],
      })),
      "write",
    );
  }

  const version = await bumpVersion();
  return NextResponse.json({
    updated: updates.length,
    remaining: Math.max(0, pending.length - todo.length),
    version,
  });
}
