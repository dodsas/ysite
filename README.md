# ysite — 즐겨찾기 모음

흩어진 링크를 한 곳에 모아보는 개인용 북마크 사이트.

- **URL 입력** → 서버가 페이지 제목을 자동으로 가져와 채워줍니다.
- **북마크 HTML 드래그앤드롭** → 브라우저에서 내보낸 북마크 파일을 끌어다 놓으면 한 번에 가져옵니다.
- 검색, 삭제, 파비콘 표시.

## 스택

- **Next.js (App Router)** + React 19 + TypeScript
- **Turso (libSQL)** — `@libsql/client/web` (workerd 호환)
- **Cloudflare Workers** 배포 — `@opennextjs/cloudflare`

## 로컬 개발

```bash
npm install
npm run dev          # http://localhost:3000
```

환경변수는 `.env`에서 읽습니다 (이미 설정됨):

```
TURSO_URL=libsql://...
TURSO_TOKEN=...
```

> ⚠️ `.env`에는 DB 토큰이 들어있습니다. `.gitignore`에 포함돼 있으니 **커밋하지 마세요.**

DB 테이블(`bookmarks`)은 첫 요청 시 자동 생성됩니다(`CREATE TABLE IF NOT EXISTS`).

## Cloudflare Workers 배포

### 1) CLI로 직접 배포

```bash
# 워커 런타임에서 미리보기 (workerd)
npm run preview

# 배포
npm run deploy
```

워커에서 쓸 시크릿 등록:

```bash
npx wrangler secret put TURSO_URL
npx wrangler secret put TURSO_TOKEN
```

로컬 `preview`용으로는 `.dev.vars` 파일에 같은 값을 넣으면 됩니다(gitignore 됨).

### 2) Git 연동 (Workers Builds) — 권장

1. Cloudflare 대시보드 → Workers & Pages → **Create → Workers → Connect to Git**
2. `dodsas/ysite` 저장소 연결, 프로덕션 브랜치 `main`
3. 빌드 명령: `npx opennextjs-cloudflare build` / 배포 명령: `npx opennextjs-cloudflare deploy`
   (또는 프리셋이 자동 감지)
4. **Variables & Secrets**에 `TURSO_URL`, `TURSO_TOKEN` 등록
5. `main`에 push하면 약 90초 내 자동 빌드·배포, PR마다 프리뷰 URL 생성

## 기술 메모

- `@libsql/client/web` 사용이 **필수**입니다. 기본 `@libsql/client`는 네이티브
  바인딩이라 Cloudflare Workers(workerd)에서 동작하지 않습니다.
- `wrangler.jsonc`: `nodejs_compat` 플래그 + `compatibility_date` 2024-09-23 이상.
- 제목 자동 추출은 서버사이드(`/api/title`)에서 수행 — 브라우저 CORS 회피.

## 구조

```
app/
  page.tsx                # UI (composer, drag&drop, grid)
  layout.tsx, globals.css
  api/
    bookmarks/route.ts        # GET 목록 / POST 추가·일괄 가져오기
    bookmarks/[id]/route.ts   # DELETE
    title/route.ts            # URL → 제목/설명/파비콘
lib/
  db.ts                   # Turso 클라이언트 + 스키마
  metadata.ts             # URL 정규화 + 메타데이터 추출
  parseBookmarks.ts       # 북마크 HTML 파서 (브라우저)
```
