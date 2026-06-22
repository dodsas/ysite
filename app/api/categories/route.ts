import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb, type Category } from "@/lib/db";

export async function GET() {
  await ensureSchema();
  const rs = await getDb().execute(
    "SELECT id, name, created_at FROM categories ORDER BY created_at ASC, id ASC",
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
  const rs = await getDb().execute({
    sql: "INSERT INTO categories (name, created_at) VALUES (?, ?) RETURNING id, name, created_at",
    args: [name, now],
  });
  return NextResponse.json({ category: rs.rows[0] }, { status: 201 });
}
