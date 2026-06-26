import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  authMode,
  createSessionCookie,
  sessionMaxAge,
  verifySecret,
  type AuthUser,
} from "@/lib/auth";
import { ensureSchema, getUserByEmail } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (authMode() !== "email") {
    return NextResponse.json({ error: "email_auth_disabled" }, { status: 404 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  await ensureSchema();
  const row = await getUserByEmail(email);
  // Same generic error whether the email is unknown or the password is wrong.
  if (!row || !(await verifySecret(password, row.password_hash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const user: AuthUser = {
    id: row.id,
    name: row.name || "",
    nickname: row.nickname || email.split("@")[0] || "사용자",
    email: row.email,
    profileImage: "",
  };
  const res = NextResponse.json({ user });
  res.cookies.set(AUTH_COOKIE, await createSessionCookie(user), {
    httpOnly: true,
    maxAge: sessionMaxAge(),
    path: "/",
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}
