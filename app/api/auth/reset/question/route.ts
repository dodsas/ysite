import { NextRequest, NextResponse } from "next/server";
import { authMode } from "@/lib/auth";
import { ensureSchema, getUserByEmail } from "@/lib/db";

// Step 1 of password reset: return the account's security question.
export async function POST(req: NextRequest) {
  if (authMode() !== "email") {
    return NextResponse.json({ error: "email_auth_disabled" }, { status: 404 });
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  await ensureSchema();
  const row = await getUserByEmail(email);
  if (!row || !row.security_question) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ question: row.security_question });
}
