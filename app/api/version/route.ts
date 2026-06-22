import { NextResponse } from "next/server";
import { ensureSchema, getVersion } from "@/lib/db";

// Lightweight: one-row read. The client polls this on load and only refetches
// everything when the version differs from its cached copy.
export async function GET() {
  await ensureSchema();
  const version = await getVersion();
  return NextResponse.json({ version });
}
