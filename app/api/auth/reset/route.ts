import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  authMode,
  createSessionCookie,
  hashSecret,
  normalizeAnswer,
  sessionMaxAge,
  verifySecret,
  type AuthUser,
} from "@/lib/auth";
import { ensureSchema, getUserByEmail, updateUserPassword } from "@/lib/db";

const MIN_PASSWORD = 8;

// Step 2 of password reset: verify the security answer, set a new password,
// and sign the user in.
export async function POST(req: NextRequest) {
  if (authMode() !== "email") {
    return NextResponse.json({ error: "email_auth_disabled" }, { status: 404 });
  }

  let body: { email?: string; answer?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const answer = body.answer || "";
  const newPassword = body.newPassword || "";

  if (newPassword.length < MIN_PASSWORD) {
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  }

  await ensureSchema();
  const row = await getUserByEmail(email);
  if (!row || !(await verifySecret(normalizeAnswer(answer), row.security_answer_hash))) {
    return NextResponse.json({ error: "wrong_answer" }, { status: 401 });
  }

  await updateUserPassword(row.id, await hashSecret(newPassword));

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
