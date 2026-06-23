import { NextRequest, NextResponse } from "next/server";
import { claimLegacyDataForUser, upsertUser } from "@/lib/db";
import {
  AUTH_COOKIE,
  createSessionCookie,
  getNaverRedirectUri,
  NAVER_STATE_COOKIE,
  sessionMaxAge,
  type AuthUser,
} from "@/lib/auth";

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type NaverProfileResponse = {
  resultcode?: string;
  message?: string;
  response?: {
    id?: string;
    nickname?: string;
    email?: string;
    profile_image?: string;
    name?: string;
  };
};

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret =
    process.env.NAVER_CLIENT_SECRET ||
    process.env.NAVER_SECRET ||
    process.env.NAVER_TOKEN;
  if (!clientId) throw new Error("NAVER_CLIENT_ID is not set");
  if (!clientSecret) throw new Error("NAVER_TOKEN or NAVER_CLIENT_SECRET is not set");
  return { clientId, clientSecret };
}

function errorRedirect(origin: string, reason: string): NextResponse {
  const url = new URL("/", origin);
  url.searchParams.set("login", "error");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const expectedState = req.cookies.get(NAVER_STATE_COOKIE)?.value;

  if (error) return errorRedirect(origin, error);
  if (!code || !state || !expectedState || state !== expectedState) {
    return errorRedirect(origin, "invalid_state");
  }

  const { clientId, clientSecret } = credentials();
  const redirectUri = getNaverRedirectUri(origin);
  const tokenUrl = new URL("https://nid.naver.com/oauth2.0/token");
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("state", state);

  const tokenRes = await fetch(tokenUrl, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });
  const token = (await tokenRes.json()) as TokenResponse;
  if (!tokenRes.ok || !token.access_token) {
    return errorRedirect(origin, token.error || "token_failed");
  }

  const profileRes = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });
  const profile = (await profileRes.json()) as NaverProfileResponse;
  const p = profile.response;
  if (!profileRes.ok || profile.resultcode !== "00" || !p?.id) {
    return errorRedirect(origin, profile.message || "profile_failed");
  }

  const user: AuthUser = {
    id: p.id,
    name: p.name || "",
    nickname: p.nickname || p.name || "네이버 사용자",
    email: p.email || "",
    profileImage: p.profile_image || "",
  };

  await upsertUser(user);
  if ([user.name, user.nickname].some((v) => v.trim() === "남유선")) {
    await claimLegacyDataForUser(user.id);
  }

  const res = NextResponse.redirect(new URL("/", origin));
  res.cookies.delete(NAVER_STATE_COOKIE);
  res.cookies.set(AUTH_COOKIE, await createSessionCookie(user), {
    httpOnly: true,
    maxAge: sessionMaxAge(),
    path: "/",
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}
