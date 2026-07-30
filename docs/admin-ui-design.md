# 관리자 대시보드

> 구현일: 2026-07-30 | 상태: ✅ 구현 완료

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | React 18 + Vite 5 + TypeScript |
| 스타일링 | Tailwind CSS 3 |
| 라우팅 | react-router-dom v6 |
| 상태/데이터 | @tanstack/react-query |
| API 통신 | fetch + JWT + 토큰 자동 갱신 |
| 인증 | /auth/login → JWT access/refresh token |

---

## 화면 목록 (7개)

| # | 화면 | 경로 | 설명 |
|:---:|------|------|------|
| 1 | **로그인** | `/login` | 이메일+비밀번호 로그인, JWT 토큰 저장 |
| 2 | **대시보드** | `/dashboard` | 총 사용자, 최근 지급·감사 로그 요약 |
| 3 | **사용자 검색** | `/users` | 이메일/닉네임 검색, 상태 필터, 페이지네이션 |
| 4 | **사용자 상세** | `/users/:id` | 재화 원장·제재·아이템·전투 (4개 탭) |
| 5 | **계정 제재** | `/sanctions` | 사용자 선택 → 제재 추가/만료일 설정/철회 |
| 6 | **재화 지급** | `/grants` | 사용자 선택 → electricity/scrap 지급 + 내역 |
| 7 | **보안 이벤트** | `/security` | 보안 이벤트 목록 + 심각도 필터 + 검토 처리 |
| 8 | **감사 로그** | `/audit-logs` | 운영자 행위 감사 로그 + 액션 필터 |

---

## 프로젝트 구조

```
admin/
├── index.html
├── package.json
├── vite.config.ts              # dev proxy: /api → localhost:3000
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── README.md
└── src/
    ├── main.tsx                 # 진입점 (QueryClient, BrowserRouter, AuthProvider)
    ├── App.tsx                  # 라우트 정의 (ProtectedRoute)
    ├── index.css                # Tailwind 지시문
    ├── types.ts                 # TypeScript 타입 정의
    ├── api.ts                   # API 클라이언트 (JWT, 토큰 갱신, Idempotency-Key)
    ├── context/
    │   └── AuthContext.tsx       # 인증 상태 관리
    ├── components/
    │   └── Layout.tsx            # 사이드바 + 네비게이션 레이아웃
    └── pages/
        ├── Login.tsx             # 로그인 페이지
        ├── Dashboard.tsx         # 대시보드
        ├── Users.tsx             # 사용자 목록
        ├── UserDetail.tsx        # 사용자 상세 (탭: 재화/제재/아이템/전투)
        ├── Sanctions.tsx         # 제재 관리
        ├── Grants.tsx            # 재화 지급
        ├── SecurityEvents.tsx    # 보안 이벤트
        └── AuditLogs.tsx         # 감사 로그
```

---

## API 연동

모든 API 요청은 `src/api.ts`를 통해 이루어집니다:

- JWT access token을 `Authorization: Bearer` 헤더로 전송
- 401 발생 시 refresh token으로 자동 갱신 (1회 재시도)
- 모든 POST/PUT 요청에 `Idempotency-Key` 자동 생성
- `/api` prefix는 Vite dev proxy에서 `http://localhost:3000`으로 변환

---

## 레이아웃

```
┌─────────────────────────────────────────────┐
│  🎮 Admin · idle-game-server       로그아웃  │
├─────────┬───────────────────────────────────┤
│ 📊 대시 │                                   │
│ 🔍 사용 │                                   │
│ 🚫 제재 │         메인 콘텐츠 영역          │
│ 💰 지급 │                                   │
│ 🔒 보안 │                                   │
│ 📋 로그 │                                   │
│         │                                   │
├─────────┴───────────────────────────────────┤
│  ⏻ 로그아웃                                │
└─────────────────────────────────────────────┘
```

---

## 보안

1. **인증 필수**: 모든 페이지는 `ProtectedRoute`로 보호, 미인증 시 `/login`으로 리다이렉트
2. **토큰 갱신**: access token 만료 시 refresh token으로 자동 갱신, 실패 시 로그아웃
3. **Idempotency-Key**: 모든 변경 요청에 UUID 기반 키 자동 첨부 (중복 지급 방지)
4. **CORS**: Admin API는 localhost origin만 허용 (`admin.routes.ts`)

---

## 실행 방법

```bash
# 개발 모드
cd admin
npm install
npm run dev          # http://localhost:5174

# 프로덕션 빌드
npm run build        # admin/dist/ 출력
```

---

## 향후 개선 가능

- 다크 모드 지원
- 운영자 계정 관리 UI
- 실시간 알림 (WebSocket/SSE)
- 차트/그래프 (Recharts 등)
- 다국어 지원
- 인라인 에디팅 (닉네임 변경 등)
