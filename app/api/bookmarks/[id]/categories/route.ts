import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bumpVersion, ensureSchema, getDb, userVersionKey } from "@/lib/db";

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
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const parsed = await parse(req, id);
  if (!parsed) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await ensureSchema();
  await getDb().execute({
    sql: `INSERT OR IGNORE INTO bookmark_categories (bookmark_id, category_id)
          SELECT b.id, c.id
          FROM bookmarks b, categories c
          WHERE b.id = ? AND b.user_id = ? AND c.id = ? AND c.user_id = ?`,
    args: [parsed.bookmarkId, userId, parsed.categoryId, userId],
  });
  const version = await bumpVersion(userVersionKey(userId));
  return NextResponse.json({ ok: true, version });
}

// Remove a category from a bookmark.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const parsed = await parse(req, id);
  if (!parsed) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await ensureSchema();
  await getDb().execute({
    sql: `DELETE FROM bookmark_categories
          WHERE bookmark_id = ?
            AND category_id = ?
            AND EXISTS (SELECT 1 FROM bookmarks WHERE id = ? AND user_id = ?)
            AND EXISTS (SELECT 1 FROM categories WHERE id = ? AND user_id = ?)`,
    args: [
      parsed.bookmarkId,
      parsed.categoryId,
      parsed.bookmarkId,
      userId,
      parsed.categoryId,
      userId,
    ],
  });
  const version = await bumpVersion(userVersionKey(userId));
  return NextResponse.json({ ok: true, version });
}
