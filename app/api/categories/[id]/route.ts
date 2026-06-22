import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";

// Rename a category.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    sql: "UPDATE categories SET name = ? WHERE id = ?",
    args: [name, numId],
  });
  return NextResponse.json({ id: numId, name });
}

// Delete a category; its bookmarks fall back to uncategorized.
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
      {
        sql: "DELETE FROM bookmark_categories WHERE category_id = ?",
        args: [numId],
      },
      { sql: "DELETE FROM categories WHERE id = ?", args: [numId] },
    ],
    "write",
  );
  return NextResponse.json({ deleted: numId });
}
