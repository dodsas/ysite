import { NextRequest, NextResponse } from "next/server";
import { bumpVersion, ensureSchema, getDb, getVersion } from "@/lib/db";

const MAX_ENTRIES = 10000;

// Full translation cache (most-hit first), loaded by the client on startup.
export async function GET() {
  await ensureSchema();
  const [version, rs] = await Promise.all([
    getVersion("tversion"),
    getDb().execute(
      `SELECT q, translated FROM translations ORDER BY hits DESC, updated_at DESC LIMIT ${MAX_ENTRIES}`,
    ),
  ]);
  return NextResponse.json({ version, entries: rs.rows });
}

type Entry = { q?: string; translated?: string; hits?: number };

// Batched upsert from the client: accumulate hits, keep newest translation,
// evict the least-hit rows beyond the cap. Bumps tversion.
export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: { entries?: Entry[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const now = Date.now();
  const rows = (body.entries ?? [])
    .map((e) => ({
      q: (e.q ?? "").trim().toLowerCase(),
      translated: (e.translated ?? "").trim(),
      hits: Number.isFinite(e.hits) ? Math.max(1, Math.floor(e.hits as number)) : 1,
    }))
    .filter((e) => e.q.length > 0)
    .slice(0, MAX_ENTRIES);

  if (rows.length === 0) {
    return NextResponse.json({ version: await getVersion("tversion") });
  }

  const db = getDb();
  await db.batch(
    rows.map((r) => ({
      sql: `INSERT INTO translations (q, translated, hits, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(q) DO UPDATE SET
              hits = hits + excluded.hits,
              translated = excluded.translated,
              updated_at = excluded.updated_at`,
      args: [r.q, r.translated, r.hits, now],
    })),
    "write",
  );

  // Evict least-hit rows beyond the cap (high-hit entries are retained).
  const cnt = Number(
    (await db.execute("SELECT COUNT(*) AS c FROM translations")).rows[0]?.c ?? 0,
  );
  if (cnt > MAX_ENTRIES) {
    await db.execute({
      sql: `DELETE FROM translations WHERE q IN (
              SELECT q FROM translations ORDER BY hits ASC, updated_at ASC LIMIT ?
            )`,
      args: [cnt - MAX_ENTRIES],
    });
  }

  const version = await bumpVersion("tversion");
  return NextResponse.json({ version });
}
