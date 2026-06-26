import { NextRequest, NextResponse } from "next/server";
import { authMode, getNaverRedirectUri, NAVER_STATE_COOKIE } from "@/lib/auth";

function clientId(): string {
  const id = process.env.NAVER_CLIENT_ID;
  if (!id) throw new Error("NAVER_CLIENT_ID is not set");
  return id;
}

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(req: NextRequest) {
  if (authMode() !== "naver") {
    return NextResponse.json({ error: "naver_auth_disabled" }, { status: 404 });
  }
  const redirectUri = getNaverRedirectUri(req.nextUrl.origin);
  const state = randomState();
  const authUrl = new URL("https://nid.naver.com/oauth2.0/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId());
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(NAVER_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: "/",
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}
