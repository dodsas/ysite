import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/auth/")) return NextResponse.next();

  const session = await getSession(req);
  if (session) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL("/", req.nextUrl.origin);
  url.searchParams.set("login", "required");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/api/:path*", "/view/:path*"],
};
