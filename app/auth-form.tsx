"use client";

import { useState } from "react";

type View = "login" | "signup" | "reset";

const SECURITY_QUESTIONS = [
  "내가 졸업한 초등학교 이름은?",
  "어머니의 성함은?",
  "가장 좋아하는 책 제목은?",
  "첫 반려동물의 이름은?",
  "어릴 적 살던 동네 이름은?",
];

const ERROR_TEXT: Record<string, string> = {
  invalid_email: "이메일 형식이 올바르지 않아요.",
  weak_password: "비밀번호는 8자 이상이어야 해요.",
  missing_security: "보안 질문과 답을 입력해 주세요.",
  email_taken: "이미 가입된 이메일이에요.",
  invalid_credentials: "이메일 또는 비밀번호가 올바르지 않아요.",
  not_found: "해당 이메일로 가입된 계정을 찾을 수 없어요.",
  wrong_answer: "보안 질문의 답이 올바르지 않아요.",
  network: "요청에 실패했어요. 잠시 후 다시 시도해 주세요.",
};

function message(code?: string): string {
  return (code && ERROR_TEXT[code]) || ERROR_TEXT.network;
}

// Self-serve email auth UI (used when AUTH_MODE=email). On success the session
// cookie is set server-side, so a full reload lands on the server-rendered app.
export default function AuthForm() {
  const [view, setView] = useState<View>("login");

  // shared
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // signup
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState("");

  // reset
  const [resetQuestion, setResetQuestion] = useState("");
  const [resetAnswer, setResetAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");

  function go(next: View) {
    setError("");
    setView(next);
    setResetQuestion("");
  }

  async function post(url: string, payload: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data } as { ok: boolean; data: { error?: string; question?: string } };
  }

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post("/api/auth/login", { email, password });
      if (ok) window.location.reload();
      else setError(message(data.error));
    } catch {
      setError(message());
    } finally {
      setBusy(false);
    }
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post("/api/auth/signup", {
        email,
        password,
        securityQuestion,
        securityAnswer,
      });
      if (ok) window.location.reload();
      else setError(message(data.error));
    } catch {
      setError(message());
    } finally {
      setBusy(false);
    }
  }

  async function onFetchQuestion(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post("/api/auth/reset/question", { email });
      if (ok && data.question) setResetQuestion(data.question);
      else setError(message(data.error));
    } catch {
      setError(message());
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post("/api/auth/reset", {
        email,
        answer: resetAnswer,
        newPassword,
      });
      if (ok) window.location.reload();
      else setError(message(data.error));
    } catch {
      setError(message());
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap auth-wrap">
      <section className="auth-panel">
        <span className="hero-eyebrow">private bookmarks</span>
        <h1 className="hero-title">
          {view === "login" && (
            <>
              <span className="accent">로그인</span>하고 링크를 관리
            </>
          )}
          {view === "signup" && (
            <>
              이메일로 <span className="accent">회원가입</span>
            </>
          )}
          {view === "reset" && (
            <>
              비밀번호 <span className="accent">재설정</span>
            </>
          )}
        </h1>

        {error && <p className="auth-error">{error}</p>}

        {view === "login" && (
          <form className="auth-fields" onSubmit={onLogin}>
            <input
              className="auth-input"
              type="email"
              placeholder="이메일"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="auth-input"
              type="password"
              placeholder="비밀번호"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "로그인 중…" : "로그인"}
            </button>
            <div className="auth-links">
              <button type="button" onClick={() => go("signup")}>
                회원가입
              </button>
              <button type="button" onClick={() => go("reset")}>
                비밀번호 찾기
              </button>
            </div>
          </form>
        )}

        {view === "signup" && (
          <form className="auth-fields" onSubmit={onSignup}>
            <input
              className="auth-input"
              type="email"
              placeholder="이메일"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="auth-input"
              type="password"
              placeholder="비밀번호 (8자 이상)"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <select
              className="auth-input"
              value={securityQuestion}
              onChange={(e) => setSecurityQuestion(e.target.value)}
            >
              {SECURITY_QUESTIONS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <input
              className="auth-input"
              type="text"
              placeholder="보안 질문 답변"
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
              required
            />
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "가입 중…" : "회원가입"}
            </button>
            <div className="auth-links">
              <button type="button" onClick={() => go("login")}>
                로그인으로 돌아가기
              </button>
            </div>
          </form>
        )}

        {view === "reset" && (
          <form
            className="auth-fields"
            onSubmit={resetQuestion ? onReset : onFetchQuestion}
          >
            <input
              className="auth-input"
              type="email"
              placeholder="이메일"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={!!resetQuestion}
            />
            {!resetQuestion ? (
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "확인 중…" : "보안 질문 받기"}
              </button>
            ) : (
              <>
                <p className="auth-question">{resetQuestion}</p>
                <input
                  className="auth-input"
                  type="text"
                  placeholder="보안 질문 답변"
                  value={resetAnswer}
                  onChange={(e) => setResetAnswer(e.target.value)}
                  required
                />
                <input
                  className="auth-input"
                  type="password"
                  placeholder="새 비밀번호 (8자 이상)"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? "변경 중…" : "비밀번호 변경"}
                </button>
              </>
            )}
            <div className="auth-links">
              <button type="button" onClick={() => go("login")}>
                로그인으로 돌아가기
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
