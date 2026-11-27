# 관리자 UI

기준일: 2026-11-27. 구현은 `admin/`입니다. 의존성 버전은 [admin/package.json](../admin/package.json) 선언값입니다.

## 기술 스택

| 구분 | 선언 |
|---|---|
| UI | React `^18.3.1`, react-dom `^18.3.1` |
| 라우팅 | `react-router-dom` `7.18.4` (v7, caret 없음) |
| 빌드 | Vite `^5.3.4`, `@vitejs/plugin-react` `^4.3.1`, TypeScript `^5.5.3` |
| 스타일 | Tailwind CSS `^3.4.6`, PostCSS, autoprefixer |
| 서버 상태 | `@tanstack/react-query` `^5.51.0` |
| 테스트 | Vitest `^3.2.7` (`npm test` = `vitest run`) |

HTTP는 `fetch`입니다. 별도 axios 클라이언트는 없습니다.

## 화면 (8개)

라우트 정의: [admin/src/App.tsx](../admin/src/App.tsx). `/`는 `ProtectedRoute` + `Layout`이고 인덱스는 `/dashboard`로 보냅니다. 알 수 없는 경로는 `/`로 보냅니다.

| 화면 | 경로 | 구현 |
|---|---|---|
| 로그인 | `/login` | `pages/Login.tsx`. 이메일·비밀번호. 토큰은 메모리와 `localStorage`(`admin_access_token`, `admin_refresh_token`) |
| 대시보드 | `/dashboard` | `pages/Dashboard.tsx`. 사용자 수, 최근 지급·감사 로그 요약 |
| 사용자 검색 | `/users` | `pages/Users.tsx`. 이메일/닉네임 검색, 상태 필터, 페이지네이션 |
| 사용자 상세 | `/users/:id` | `pages/UserDetail.tsx`. 아래 탭과 GameOps |
| 계정 제재 | `/sanctions` | `pages/Sanctions.tsx` |
| 재화 지급 | `/grants` | `pages/Grants.tsx`. electricity/scrap 등 |
| 보안 이벤트 | `/security` | `pages/SecurityEvents.tsx`. 심각도 필터, 검토 처리 |
| 감사 로그 | `/audit-logs` | `pages/AuditLogs.tsx`. 액션 필터 |

사이드바(`components/Layout.tsx`)에는 대시보드, 사용자 검색, 계정 제재, 재화 지급, 보안 이벤트, 감사 로그가 있습니다. 로그인은 사이드바 밖입니다.

### 사용자 상세 탭

`UserDetail` 탭 상태는 `wallet` | `sanctions` | `items` | `battles`입니다.

- 재화 원장
- 제재 (정지/해제, 제재 생성·철회)
- 아이템 원장
- 전투 기록

같은 화면에 상세 헤더에서 정지·지급 폼도 있습니다.

### GameOpsAnalysis

[admin/src/components/GameOpsAnalysis.tsx](../admin/src/components/GameOpsAnalysis.tsx)는 별도 라우트가 아닙니다. `UserDetail`이 `userId`를 넘겨 사용자 상세 안에 렌더링합니다.

- 문의 유형: `missing_reward`(보상 누락), `duplicate_suspected`(중복 지급 의심), `battle_rejected`(전투 결과 거절)
- 모델 목록은 `listAiProviders()`에서 `enabled`인 제공자만 고릅니다. 초기 선택값은 `gemini`입니다.
- 질문 길이 5자 이상, 최대 1000자
- 분석 요청 후 쿼리 `aiRun`에 run id를 넣습니다. 상태가 `queued` 또는 `running`이면 1.5초마다 `getGameOpsRun`을 다시 호출합니다.
- 화면 문구: 서버 기록과 운영 문서로 초안을 만들며 재화나 계정은 변경하지 않습니다. 성공 시 판정(`confirmed` / `suspected` / `insufficient_evidence`)과 답변 초안 복사가 있습니다.
- 대응 절차 문서: [runbooks/missing-reward.md](./runbooks/missing-reward.md), [runbooks/duplicate-grant.md](./runbooks/duplicate-grant.md), [runbooks/battle-rejected.md](./runbooks/battle-rejected.md)

## 디렉터리

```
admin/
├── package.json
├── vite.config.ts          # 개발 서버 5174, /api 프록시
├── index.html
├── src/
│   ├── main.tsx            # QueryClient, BrowserRouter, AuthProvider
│   ├── App.tsx
│   ├── api.ts              # BASE_URL=/api, JWT, Idempotency-Key
│   ├── types.ts
│   ├── context/AuthContext.tsx
│   ├── components/Layout.tsx
│   ├── components/GameOpsAnalysis.tsx
│   ├── pages/              # Login, Dashboard, Users, UserDetail, Sanctions, Grants, SecurityEvents, AuditLogs
│   └── __tests__/admin-smoke.test.ts
└── dist/                   # vite build 출력. Worker 정적 자산
```

## API 클라이언트

`admin/src/api.ts`의 `BASE_URL`은 `/api`입니다.

- 로그인 외 요청에 `Authorization: Bearer`
- GET이 아닌 요청에 `Idempotency-Key` (`{method}-{uuid}`)
- `401`이면 refresh 후 한 번 재시도. 실패하면 토큰을 지웁니다.

### 개발 서버와 운영 서빙

개발:

```bash
cd admin
npm ci
npm run dev
```

[admin/vite.config.ts](../admin/vite.config.ts)는 포트 **5174**에서 `/api`를 `http://localhost:3000`으로 프록시하면서 **경로의 `/api` 접두사를 제거**합니다. 현재 Hono 앱(`src/app.ts`)은 게임·운영 라우트를 `/api` 아래에만 마운트하므로, 이 프록시 재작성은 그 마운트와 어긋납니다. 접두사를 유지한 채 프록시하려면 Vite 설정을 바꿔야 하며, 그 변경은 이 문서 범위 밖입니다.

운영: [wrangler.jsonc](../wrangler.jsonc) `assets.directory`가 `./admin/dist`이고 SPA fallback입니다. 브라우저는 Worker와 같은 출처에서 `/api/...`를 호출합니다. Worker는 `/api/*`를 Hono로 보내고 나머지 경로를 `admin/dist`로 보냅니다. 정적 파일용 별도 오리진은 없습니다.

```bash
npm run build:admin          # 저장소 루트. admin 빌드
npm run dev:cloudflare       # 빌드 후 wrangler dev
npm run deploy:cloudflare    # 빌드 후 wrangler deploy
```

`src/admin.routes.ts`의 운영 API CORS `origin`은 `http://localhost:3000`과 `http://127.0.0.1:3000`만 허용합니다. 앱 전역 CORS 기본값은 `http://localhost:5173`(`CORS_ORIGIN`으로 재정의)입니다. Worker에 붙은 관리자 SPA는 같은 출처 요청이라 이 CORS 목록을 타지 않습니다.

## 인증 경계

`ProtectedRoute`는 `useAuth().isAuthenticated`가 아니면 `/login`으로 보냅니다. 서버는 `/api/admin/*`에 `operatorAuth`를 적용합니다. UI 가드는 서버 권한 검사를 대신하지 않습니다.

## 테스트

[admin/src/__tests__/admin-smoke.test.ts](../admin/src/__tests__/admin-smoke.test.ts)는 `api.ts` 계약만 봅니다. `fetch`와 `localStorage`를 스텁합니다. 실제 서버·브라우저 렌더는 하지 않습니다.

다루는 범위:

- 토큰 저장·복원·삭제 (`setTokens`, `loadTokens`, `clearTokens`)
- `Authorization`, `Idempotency-Key`
- `401` → refresh → 재시도
- 사용자 목록·제재·지급·정지 경로와 메서드·본문
- 서버 오류의 `ApiError` 전파

실행 (저장소 루트, CI `worker` 잡과 동일):

```bash
npm ci --prefix admin
npm --prefix admin test
```

`admin` 디렉터리에서는 `npm test`입니다.
