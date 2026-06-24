import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bumpVersion, ensureSchema, getDb, listCategories, userVersionKey } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const categories = await listCategories(session.user.id);
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

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
    sql: `INSERT INTO categories (user_id, name, position, created_at)
          VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories WHERE user_id = ?), ?)
          RETURNING id, name, position, created_at`,
    args: [userId, name, userId, now],
  });
  const version = await bumpVersion(userVersionKey(userId));
  return NextResponse.json({ category: rs.rows[0], version }, { status: 201 });
}
