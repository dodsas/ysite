import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  createSessionCookie,
  getSession,
  sessionMaxAge,
  shouldRefreshSession,
} from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/auth/")) return NextResponse.next();

  const session = await getSession(req);
  if (session) {
    const res = NextResponse.next();
    // Sliding renewal: keep an active user signed in for another full month.
    if (shouldRefreshSession(session)) {
      res.cookies.set(AUTH_COOKIE, await createSessionCookie(session.user), {
        httpOnly: true,
        maxAge: sessionMaxAge(),
        path: "/",
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
      });
    }
    return res;
  }

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
