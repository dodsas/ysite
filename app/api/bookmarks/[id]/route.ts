import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bumpVersion, ensureSchema, getDb, userVersionKey } from "@/lib/db";

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
              WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE id = ? AND user_id = ?)`,
        args: [numId, userId],
      },
      { sql: "DELETE FROM bookmarks WHERE id = ? AND user_id = ?", args: [numId, userId] },
    ],
    "write",
  );
  const version = await bumpVersion(userVersionKey(userId));
  return NextResponse.json({ deleted: numId, version });
}

// Rename a bookmark / saved page.
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
  let body: { title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.title !== "string") {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  await ensureSchema();
  await getDb().execute({
    sql: "UPDATE bookmarks SET title = ? WHERE id = ? AND user_id = ?",
    args: [body.title.trim(), numId, userId],
  });
  const version = await bumpVersion(userVersionKey(userId));
  return NextResponse.json({ id: numId, title: body.title.trim(), version });
}
