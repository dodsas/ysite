import type { NextRequest } from "next/server";

export type AuthUser = {
  id: string;
  name: string;
  nickname: string;
  email: string;
  profileImage: string;
};

export type AuthSession = {
  user: AuthUser;
  exp: number;
};

export const AUTH_COOKIE = "ysite_auth";
export const NAVER_STATE_COOKIE = "ysite_naver_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export function getNaverRedirectUri(origin: string): string {
  return (
    process.env.NAVER_REDIRECT_URI ||
    new URL("/api/auth/naver/callback", origin).toString()
  );
}

function getSecret(): string {
  const secret =
    process.env.NAVER_SESSION_SECRET ||
    process.env.NAVER_CLIENT_SECRET ||
    process.env.NAVER_SECRET ||
    process.env.NAVER_TOKEN;
  if (!secret) throw new Error("NAVER_TOKEN or NAVER_CLIENT_SECRET is not set");
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function sessionMaxAge(): number {
  return SESSION_TTL_SECONDS;
}

export async function createSessionCookie(user: AuthUser): Promise<string> {
  const session: AuthSession = {
    user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function readSessionCookie(value?: string): Promise<AuthSession | null> {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const session = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload)),
    ) as AuthSession;
    if (!session.user?.id || session.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    session.user.name = session.user.name || "";
    session.user.nickname = session.user.nickname || session.user.name || "네이버 사용자";
    session.user.email = session.user.email || "";
    session.user.profileImage = session.user.profileImage || "";
    return session;
  } catch {
    return null;
  }
}

export async function getSession(req: NextRequest): Promise<AuthSession | null> {
  return readSessionCookie(req.cookies.get(AUTH_COOKIE)?.value);
}
