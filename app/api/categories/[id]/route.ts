import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bumpVersion, ensureSchema, getDb, userVersionKey } from "@/lib/db";

// Rename a category.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
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
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE categories SET name = ? WHERE id = ? AND user_id = ?",
    args: [name, numId, userId],
  });
  const version = await bumpVersion(userVersionKey(userId));
  return NextResponse.json({ id: numId, name, version });
}

// Delete a category; its bookmarks fall back to uncategorized.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await ensureSchema();
  await getDb().batch(
    [
      {
        sql: `DELETE FROM bookmark_categories
              WHERE category_id IN (SELECT id FROM categories WHERE id = ? AND user_id = ?)`,
        args: [numId, userId],
      },
      { sql: "DELETE FROM categories WHERE id = ? AND user_id = ?", args: [numId, userId] },
    ],
    "write",
  );
  const version = await bumpVersion(userVersionKey(userId));
  return NextResponse.json({ deleted: numId, version });
}
