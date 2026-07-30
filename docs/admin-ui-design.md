# 관리자 대시보드 & 웹 UI 구상

> **구상일**: 2026-07-30
> **상태**: 구상 (미구현)
> **기반**: 기존 18개 Admin API + 3개 시스템 API

---

## 1. 기술 스택 제안

| 계층 | 기술 | 선택 이유 |
|------|------|----------|
| 프레임워크 | **React 18 + TypeScript** | Hono와 동일한 TS 생태계 |
| 빌드 | **Vite** | 빠른 HMR, TS 기본 지원 |
| 스타일링 | **Tailwind CSS** | 빠른 프로토타이핑 |
| 데이터 | **React Query (TanStack)** | 캐싱/폴링/재시도 자동화 |
| 차트 | **Recharts** | 경량 React 차트 |
| 라우팅 | **React Router v6** | SPA 라우팅 |
| 인증 | JWT Bearer (기존 admin API 활용) | |

### 프로젝트 구조

```
admin-ui/
├── public/
├── src/
│   ├── components/        # 공통 UI 컴포넌트
│   │   ├── Layout.tsx     # 사이드바 + 헤더 레이아웃
│   │   ├── DataTable.tsx  # 페이지네이션 테이블
│   │   ├── MetricCard.tsx # 지표 카드
│   │   ├── SearchBar.tsx  # 검색/필터
│   │   └── Modal.tsx      # 확인/입력 모달
│   ├── pages/
│   │   ├── Dashboard.tsx       # 메인 대시보드
│   │   ├── Users.tsx           # 사용자 관리
│   │   ├── UserDetail.tsx      # 사용자 상세
│   │   ├── Grants.tsx          # 재화/파츠 지급
│   │   ├── Sanctions.tsx       # 제재 관리
│   │   ├── Security.tsx        # 보안 이벤트
│   │   ├── AuditLogs.tsx       # 감사 로그
│   │   ├── Operators.tsx       # 운영자 관리
│   │   └── Login.tsx           # 로그인
│   ├── api/
│   │   └── client.ts      # API 클라이언트 (JWT 자동 첨부)
│   ├── hooks/
│   │   └── useAdminApi.ts # React Query 훅
│   └── App.tsx
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

> ⚠️ 별도 Vite 프로젝트로 구성 (`idle-game-server/admin-ui/`). 서버와 동일 레포지토리에서 관리 가능.

---

## 2. 화면 구성

### 메인 대시보드 (`/`)

| 영역 | 내용 | API |
|------|------|-----|
| **실시간 지표** | 오늘 가입자 / 활성 유저 / 총 제재 / 총 지급액 | `GET /admin/users`, `GET /admin/grants` |
| **시스템 상태** | uptime, 메모리, 응답시간, 오류율 | `GET /health`, `GET /metrics` |
| **최근 가입** | 최근 10명 사용자 목록 | `GET /admin/users?limit=10` |
| **최근 제재** | 최근 10건 제재 목록 | `GET /admin/grants` |
| **처리량 그래프** | 시간별 요청 수 (Recharts Line) | `GET /metrics` (polling) |

```
┌────────────────────────────────────────────────────┐
│  🏠 대시보드                                       │
│────────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
│ │ 1,234 │ │  567 │ │   12 │ │$3.2K│              │
│ │ 가입자│ │활성  │ │ 제재 │ │ 지급 │              │
│ └──────┘ └──────┘ └──────┘ └──────┘              │
│────────────────────────────────────────────────────┤
│ 📊 요청 처리량 (24h)        │ 🟢 시스템 상태       │
│   400 ┤    ╭╮              │ uptime: 3d 12h       │
│   200 ┤  ╭╯╰╮   ╭─        │ mem: 128MB / 256MB   │
│     0 ┤──╯   ╰───╯         │ RPS: 350            │
│────────────────────────────────────────────────────┤
│ 👤 최근 가입               │ ⚠️ 최근 제재          │
│  nick1  2026-07-30         │ user1  suspended     │
│  nick2  2026-07-30         │ user2  banned        │
└────────────────────────────────────────────────────┘
```

### 사용자 관리 (`/users`)

| 기능 | API | UI 요소 |
|------|-----|---------|
| **목록** | `GET /admin/users` | DataTable (ID/닉네임/상태/가입일), 페이지네이션 |
| **검색** | `?search=` | SearchBar (닉네임/이메일) |
| **필터** | `?status=` | 드롭다운 (전체/active/suspended/banned) |
| **정렬** | `?sort=created_at&order=desc` | 컬럼 헤더 클릭 |

**사용자 상세** (`/users/:id`)

| 탭 | API | 내용 |
|----|-----|------|
| 📋 **프로필** | `GET /admin/users/:id` | 기본 정보 + 프로필 + 지갑 |
| 💰 **재화 원장** | `GET /admin/users/:id/wallet-ledger` | 입출금 이력 테이블 |
| 📦 **아이템** | `GET /admin/users/:id/item-ledger` | 파츠/설계도 획득 이력 |
| ⚔️ **전투** | `GET /admin/users/:id/battles` | 전투 세션 목록 (stage, kills, reward) |
| 🎁 **방치 보상** | `GET /admin/users/:id/idle-rewards` | claim 이력 |
| 🚫 **제재** | `GET /admin/users/:id/sanctions` | 제재 목록 + 생성/철회 버튼 |

```
┌─────────────────────────────────────────────────────┐
│ 👤 사용자 상세            [제재] [해제] [지급]      │
│─────────────────────────────────────────────────────┤
│ 이름: nick1           │ 전기: 1,234 EPS: 5          │
│ 이메일: a@b.com       │ 스크랩: 56   상태: active   │
│─────────────────────────────────────────────────────┤
│ [프로필] [재화원장] [아이템] [전투] [방치보상] [제재]│
│─────────────────────────────────────────────────────┤
│ 날짜         │ 통화  │ 금액  │ 잔액   │ 사유        │
│ 2026-07-30   │ elec  │ +100  │ 1,234  │ claim       │
│ 2026-07-29   │ scrap │ -10   │   200  │ upgrade     │
└─────────────────────────────────────────────────────┘
```

### 재화·파츠 지급 (`/grants`)

| 영역 | API | UI |
|------|-----|----|
| **지급 폼** | `POST /admin/users/:id/grants` | 사용자 선택 → 자원 유형(currency/item) → 수량 → 사유 |
| **지급 이력** | `GET /admin/grants` | DataTable (운영자/대상/유형/수량/시간) |

### 제재 관리 (`/sanctions`)

| 기능 | API | UI |
|------|-----|----|
| **제재 생성** | `POST /admin/users/:id/sanctions` | 사용자 선택 → 유형(suspension/battle/restriction) → 사유 → 만료일 |
| **제재 철회** | `PUT /.../sanctions/:id/revoke` | 각 제재 행의 [철회] 버튼 + 사유 입력 모달 |
| **제재 목록** | `GET /admin/users/:id/sanctions` | DataTable (유형/사유/시작/만료/상태) |

### 보안 이벤트 (`/security`)

| 기능 | API | UI |
|------|-----|----|
| **이벤트 목록** | `GET /admin/security-events` | DataTable (유형/심각도/코드/시간) |
| **검토** | `PUT /.../security-events/:id/review` | 각 행의 [검토] 버튼 + 해결 유형 선택 |

### 감사 로그 (`/audit-logs`)

| 기능 | API | UI |
|------|-----|----|
| **로그 목록** | `GET /admin/audit-logs` | DataTable (운영자/액션/대상/결과/시간) |
| **필터** | `?action=user_suspended` | 드롭다운 (액션별) |

### 운영자 관리 (`/operators`)

| 기능 | API | UI |
|------|-----|----|
| **목록** | `GET /admin/operators` | DataTable |
| **생성** | `POST /admin/operators` | 이메일/비밀번호/닉네임/역할 입력 폼 |
| **역할 변경** | `PUT /.../operators/:id/role` | 역할 드롭다운 + 저장 |

---

## 3. 레이아웃

```
┌──────────────────────────────────────────────────────┐
│  🔒 idle-game-server Admin                admin@... │
├──────────┬───────────────────────────────────────────┤
│          │                                           │
│ 🏠 대시  │         메인 콘텐츠 영역                    │
│ 👤 유저  │                                           │
│ 💰 지급  │                                           │
│ 🚫 제재  │                                           │
│ 🛡️ 보안  │                                           │
│ 📋 감사  │                                           │
│ ⚙️ 운영자│                                           │
│          │                                           │
│──────────│                                           │
│ 📊 메트릭│                                           │
└──────────┴───────────────────────────────────────────┘
```

- **왼쪽 사이드바**: 200px, 어두운 배경
- **상단 헤더**: 56px, 로그인 사용자 + 로그아웃 버튼
- **메인 콘텐츠**: 남은 영역, 패딩 24px

---

## 4. API 클라이언트 설계

```typescript
// api/client.ts
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('admin_token');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Unknown error');
  }
  return res.json();
}

export const adminApi = {
  // 대시보드
  getHealth:      () => request<any>('/health'),
  getMetrics:     () => request<any>('/metrics'),

  // 사용자
  listUsers:      (params: Record<string, string>) =>
    request<any>(`/admin/users?${new URLSearchParams(params)}`),
  getUserDetail:  (id: string) => request<any>(`/admin/users/${id}`),
  suspendUser:    (id: string, reason: string) =>
    request(`/admin/users/${id}/suspend`, { method: 'PUT', body: JSON.stringify({ reason }) }),
  unsuspendUser:  (id: string, reason: string) =>
    request(`/admin/users/${id}/unsuspend`, { method: 'PUT', body: JSON.stringify({ reason }) }),

  // 지급
  createGrant:    (id: string, data: any) =>
    request(`/admin/users/${id}/grants`, { method: 'POST', body: JSON.stringify(data) }),
  listGrants:     (params: Record<string, string>) =>
    request<any>(`/admin/grants?${new URLSearchParams(params)}`),

  // 제재
  createSanction: (id: string, data: any) =>
    request(`/admin/users/${id}/sanctions`, { method: 'POST', body: JSON.stringify(data) }),
  revokeSanction: (uid: string, sid: string, reason: string) =>
    request(`/admin/users/${uid}/sanctions/${sid}/revoke`, { method: 'PUT', body: JSON.stringify({ reason }) }),

  // 보안
  listSecurityEvents: (params: Record<string, string>) =>
    request<any>(`/admin/security-events?${new URLSearchParams(params)}`),
  reviewSecurityEvent: (id: string, resolution: string) =>
    request(`/admin/security-events/${id}/review`, { method: 'PUT', body: JSON.stringify({ resolution }) }),

  // 감사
  listAuditLogs:  (params: Record<string, string>) =>
    request<any>(`/admin/audit-logs?${new URLSearchParams(params)}`),

  // 운영자
  listOperators:  () => request<any>('/admin/operators'),
  createOperator: (data: any) =>
    request('/admin/operators', { method: 'POST', body: JSON.stringify(data) }),
  changeRole:     (id: string, role: string) =>
    request(`/admin/operators/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
};
```

---

## 5. 인증 흐름

```
로그인 페이지 (/login)
  ↓ email + password
POST /auth/login → accessToken + refreshToken
  ↓ localStorage 저장
모든 API 요청에 Authorization: Bearer <accessToken> 첨부
  ↓ 401 Unauthorized 시
POST /auth/refresh → 새 accessToken
  ↓ refreshToken 만료 시
로그인 페이지로 리다이렉트
```

- 운영자만 admin API 접근 가능 (`role ∈ {operator, admin}`)
- 권한별 버튼 활성화/비활성화 (admin만 고액 지급/운영자 생성)

---

## 6. 구현 예상 공수

| 단계 | 내용 | 예상 시간 |
|:---:|------|:---------:|
| 1 | 프로젝트 초기화 (Vite + React + Tailwind + Router) | 1h |
| 2 | API 클라이언트 + 인증 흐름 | 1h |
| 3 | 레이아웃 (사이드바 + 헤더) | 1h |
| 4 | 메인 대시보드 페이지 | 2h |
| 5 | 사용자 관리 (목록 + 상세) | 3h |
| 6 | 재화/파츠 지급 | 1h |
| 7 | 제재 관리 | 1h |
| 8 | 보안 이벤트 + 감사 로그 | 1h |
| 9 | 운영자 관리 | 1h |
| 10 | 반응형 + 오류 처리 + 로딩 | 2h |
| **합계** | | **14h** (약 2일) |

---

## 7. 관련 API 매핑

| 대시보드 메뉴 | Admin API | HTTP 메서드 |
|--------------|-----------|:-----------:|
| 🏠 대시보드 | `/health`, `/metrics` | GET |
| 👤 사용자 목록 | `/admin/users` | GET |
| 👤 사용자 상세 | `/admin/users/:id` | GET |
| 💰 재화 원장 | `/admin/users/:id/wallet-ledger` | GET |
| 📦 아이템 | `/admin/users/:id/item-ledger` | GET |
| ⚔️ 전투 | `/admin/users/:id/battles` | GET |
| 🎁 방치 보상 | `/admin/users/:id/idle-rewards` | GET |
| 🚫 제재 | `/admin/users/:id/suspend`, `/unsuspend`, `/sanctions` | PUT / GET / POST |
| 💰 지급 | `/admin/users/:id/grants`, `/admin/grants` | POST / GET |
| 🛡️ 보안 | `/admin/security-events` | GET / PUT |
| 📋 감사 | `/admin/audit-logs` | GET |
| ⚙️ 운영자 | `/admin/operators` | GET / POST / PUT |
