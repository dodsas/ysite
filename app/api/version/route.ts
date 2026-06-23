import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureSchema, getVersion, userVersionKey } from "@/lib/db";

// Lightweight: one-row read. The client polls this on load and only refetches
// everything when the version differs from its cached copy.
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureSchema();
  const version = await getVersion(userVersionKey(session.user.id));
  return NextResponse.json({ version });
}
