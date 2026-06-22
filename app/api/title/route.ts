import { NextRequest, NextResponse } from "next/server";
import { fetchPageMeta, normalizeUrl } from "@/lib/metadata";

// Fetches a URL server-side (avoids browser CORS) and returns its title/desc/favicon.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? "";
  const url = normalizeUrl(raw);
  if (!url) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  const meta = await fetchPageMeta(url);
  return NextResponse.json({ url, ...meta });
}
