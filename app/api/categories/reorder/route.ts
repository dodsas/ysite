import { NextRequest, NextResponse } from "next/server";
import { bumpVersion, ensureSchema, getDb } from "@/lib/db";

// Persist a new category order: positions follow the given id sequence.
export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: { order?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const order = Array.isArray(body.order)
    ? body.order.map(Number).filter(Number.isInteger)
    : [];
  if (order.length === 0) {
    return NextResponse.json({ error: "order required" }, { status: 400 });
  }

  await getDb().batch(
    order.map((id, i) => ({
      sql: "UPDATE categories SET position = ? WHERE id = ?",
      args: [i + 1, id],
    })),
    "write",
  );
  const version = await bumpVersion();
  return NextResponse.json({ version });
}
