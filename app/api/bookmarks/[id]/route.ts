import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await ensureSchema();
  await getDb().batch(
    [
      { sql: "DELETE FROM bookmark_categories WHERE bookmark_id = ?", args: [numId] },
      { sql: "DELETE FROM bookmarks WHERE id = ?", args: [numId] },
    ],
    "write",
  );
  return NextResponse.json({ deleted: numId });
}

// Rename a bookmark / saved page.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    sql: "UPDATE bookmarks SET title = ? WHERE id = ?",
    args: [body.title.trim(), numId],
  });
  return NextResponse.json({ id: numId, title: body.title.trim() });
}
