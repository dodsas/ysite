import { NextRequest, NextResponse } from "next/server";
import { bumpVersion, ensureSchema, getDb, type Category } from "@/lib/db";

export async function GET() {
  await ensureSchema();
  const rs = await getDb().execute(
    "SELECT id, name, position, created_at FROM categories ORDER BY position ASC, id ASC",
  );
  return NextResponse.json({ categories: rs.rows as unknown as Category[] });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const now = Date.now();
  // append to the end of the current order
  const rs = await getDb().execute({
    sql: `INSERT INTO categories (name, position, created_at)
          VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories), ?)
          RETURNING id, name, position, created_at`,
    args: [name, now],
  });
  const version = await bumpVersion();
  return NextResponse.json({ category: rs.rows[0], version }, { status: 201 });
}
