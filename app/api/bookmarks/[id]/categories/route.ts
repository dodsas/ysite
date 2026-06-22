import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";

async function parse(req: NextRequest, idStr: string) {
  const bookmarkId = Number(idStr);
  let body: { categoryId?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const categoryId = Number(body.categoryId);
  if (!Number.isInteger(bookmarkId) || !Number.isInteger(categoryId)) {
    return null;
  }
  return { bookmarkId, categoryId };
}

// Add a category to a bookmark.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parse(req, id);
  if (!parsed) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await ensureSchema();
  await getDb().execute({
    sql: "INSERT OR IGNORE INTO bookmark_categories (bookmark_id, category_id) VALUES (?, ?)",
    args: [parsed.bookmarkId, parsed.categoryId],
  });
  return NextResponse.json({ ok: true });
}

// Remove a category from a bookmark.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parse(req, id);
  if (!parsed) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await ensureSchema();
  await getDb().execute({
    sql: "DELETE FROM bookmark_categories WHERE bookmark_id = ? AND category_id = ?",
    args: [parsed.bookmarkId, parsed.categoryId],
  });
  return NextResponse.json({ ok: true });
}
