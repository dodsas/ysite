import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  authMode,
  createSessionCookie,
  hashSecret,
  normalizeAnswer,
  sessionMaxAge,
  type AuthUser,
} from "@/lib/auth";
import { createEmailUser, ensureSchema, getUserByEmail } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export async function POST(req: NextRequest) {
  if (authMode() !== "email") {
    return NextResponse.json({ error: "email_auth_disabled" }, { status: 404 });
  }

  let body: {
    email?: string;
    password?: string;
    securityQuestion?: string;
    securityAnswer?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const securityQuestion = (body.securityQuestion || "").trim();
  const securityAnswer = body.securityAnswer || "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  }
  if (!securityQuestion || !securityAnswer.trim()) {
    return NextResponse.json({ error: "missing_security" }, { status: 400 });
  }

  await ensureSchema();
  if (await getUserByEmail(email)) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const nickname = email.split("@")[0] || "사용자";
  await createEmailUser({
    id,
    email,
    nickname,
    passwordHash: await hashSecret(password),
    securityQuestion,
    securityAnswerHash: await hashSecret(normalizeAnswer(securityAnswer)),
  });

  const user: AuthUser = { id, name: "", nickname, email, profileImage: "" };
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
