# 네이버 로그인 연동 절차

Next.js App Router API 라우트에서 네이버 OAuth 로그인을 연동하는 절차다.
프로젝트가 달라도 host, port, callback path만 바꾸면 같은 흐름으로 적용할 수 있다.

## 1. 네이버 개발자센터 설정

프로젝트별로 아래 값만 바꿔 사용한다.

```text
LOCAL_HOST=localhost
LOCAL_PORT=3003
LOCAL_ORIGIN=http://${LOCAL_HOST}:${LOCAL_PORT}
PUBLIC_ORIGIN=https://your-worker-or-domain.example.com
NAVER_CALLBACK_PATH=/api/auth/naver/callback
```

1. 네이버 개발자센터에서 애플리케이션을 생성한다.
2. 사용 API에 `네이버 로그인`을 추가한다.
3. 로그인 API 권한에서 식별에 필요한 프로필 항목을 허용한다.
   - 회원이름
   - 별명
   - 이메일
   - 프로필 사진
4. Callback URL을 등록한다.

로컬 테스트:

```text
${LOCAL_ORIGIN}${NAVER_CALLBACK_PATH}
```

Cloudflare 배포:

```text
${PUBLIC_ORIGIN}${NAVER_CALLBACK_PATH}
```

Render 배포:

```text
${RENDER_PUBLIC_ORIGIN}${NAVER_CALLBACK_PATH}
```

네이버 앱 설정의 Callback URL과 `NAVER_REDIRECT_URI`는 정확히 일치해야 한다.

## 2. 환경변수

로컬 개발 환경에서는 `.env` 또는 사용하는 런타임의 환경변수 파일에 아래 값을 둔다.

```dotenv
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
NAVER_REDIRECT_URI=${LOCAL_ORIGIN}${NAVER_CALLBACK_PATH}
```

배포 환경에서는 `NAVER_REDIRECT_URI`를 Cloudflare URL로 둔다.

```dotenv
NAVER_REDIRECT_URI=${PUBLIC_ORIGIN}${NAVER_CALLBACK_PATH}
```

Render 배포 환경에서는 Render 서비스 URL 또는 연결한 커스텀 도메인을 origin으로 둔다.

```dotenv
RENDER_PUBLIC_ORIGIN=https://your-render-service.onrender.com
NAVER_REDIRECT_URI=${RENDER_PUBLIC_ORIGIN}${NAVER_CALLBACK_PATH}
```

`NAVER_CLIENT_SECRET`은 네이버 개발자센터에서 발급받은 Client Secret이다.

세션 쿠키를 직접 서명하는 구현이라면 운영에서는 OAuth Client Secret과 별도로 `NAVER_SESSION_SECRET`을 두는 편이 좋다.

## 3. Cloudflare secret 등록

Worker 런타임에는 `.env`가 자동으로 올라가지 않으므로 secret으로 등록해야 한다.

```bash
npx wrangler secret put NAVER_CLIENT_ID
npx wrangler secret put NAVER_CLIENT_SECRET
npx wrangler secret put NAVER_REDIRECT_URI
```

등록 여부는 이름만 확인한다.

```bash
npx wrangler secret list
```

## 4. Render 환경변수 등록

Render에서는 서비스의 Environment 설정에 아래 값을 등록한다.

```text
NAVER_CLIENT_ID
NAVER_CLIENT_SECRET
NAVER_REDIRECT_URI
```

Render 기본 도메인을 쓰는 경우:

```text
NAVER_REDIRECT_URI=https://your-render-service.onrender.com/api/auth/naver/callback
```

커스텀 도메인을 연결한 경우:

```text
NAVER_REDIRECT_URI=https://your-domain.example.com/api/auth/naver/callback
```

네이버 개발자센터의 Callback URL에도 같은 값을 추가한다. Render의 Preview Deploy URL을 따로 테스트하려면 해당 preview origin도 네이버 Callback URL에 별도로 등록해야 한다.

권장 Render 설정:

```text
Build Command: npm run build
Start Command: npm run start
```

`npm run start`는 먼저 `npm run build`가 끝난 환경에서 실행되어야 한다.

## 5. 라우트 흐름

1. 사용자가 `/api/auth/naver`로 이동한다.
2. 서버가 랜덤 `state`를 만들고 HTTP-only state 쿠키에 저장한다.
3. 네이버 인증 URL로 307 redirect한다.
4. 네이버가 `/api/auth/naver/callback`으로 `code`, `state`를 전달한다.
5. 서버가 쿠키의 `state`와 콜백의 `state`를 비교한다.
6. 네이버 토큰 API에서 access token을 받는다.
7. `https://openapi.naver.com/v1/nid/me`에서 사용자 프로필을 가져온다.
8. 서비스에서 필요한 사용자 식별값을 세션 또는 자체 사용자 저장소에 반영한다.
9. 서비스 세션 쿠키를 발급하거나 기존 인증 세션에 연결한다.

네이버 프로필 응답의 `response.id`는 네이버 회원을 식별하는 안정적인 값이다.
서비스별 사용자 키가 필요하면 이 값을 기준으로 매핑한다.

## 6. 로컬 확인

로컬에서 `LOCAL_PORT`로 지정한 포트로 실행한다.

```bash
npm run dev -- -p ${LOCAL_PORT}
```

기본 확인:

```bash
curl -i ${LOCAL_ORIGIN}/api/auth/naver
```

정상 상태:

```text
/api/auth/naver  307 네이버 authorize URL
```

로그인 시작이 `500`이면 `NAVER_CLIENT_ID`가 없는 경우가 많다.
콜백이 `invalid_state`이면 브라우저 쿠키, redirect URI, 포트가 서로 맞는지 확인한다.
