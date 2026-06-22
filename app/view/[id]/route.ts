import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";

// Serves a stored standalone HTML page (kind='html') as a real document.
// Opening this URL in a tab renders the saved page as-is.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await ensureSchema();
  const rs = await getDb().execute({
    sql: "SELECT content FROM bookmarks WHERE id = ? AND kind = 'html'",
    args: [numId],
  });

  const content = rs.rows[0]?.content as string | undefined;
  if (!content) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Self-contained snapshot; let the browser cache it.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
