# 🛠️ 포트폴리오 개선 계획

> **분석일**: 2026-07-24  
> **대상**: idle-game-server (Hono + TypeScript 방치형 게임 서버)

---

## 📊 현재 상태 진단

### 강점

| # | 항목 | 설명 |
|:---:|------|------|
| 1 | 핵심 게임 루프 완성 | 생산→수집→업그레이드→전투→랭킹, 방치형 게임 기본 사이클 구현 |
| 2 | 10개 API 엔드포인트 | 모든 기능이 REST API로 노출됨 |
| 3 | 27개 유닛 테스트 | vitest 기반, store + routes 커버 |
| 4 | TypeScript strict mode | 타입 안전성 확보 |

### 약점 (12개 영역에서 26개 누락 발견)

| 영역 | 심각도 | 핵심 문제 |
|------|:---:|------|
| 에러 처리 | 🔴 | `onError` 없음 — throw 시 HTML 노출 |
| 입력값 검증 | 🔴 | UUID 형식 무검증, 닉네임 길이/문자셋 제한 없음 |
| 보안 | 🔴 | CORS·인증·Rate Limit 전무, 누구나 타인 계정 조작 가능 |
| DB | 🔴 | 인메모리 Map, 서버 재시작 시 전 데이터 소멸 |
| 로깅 | 🔴 | `console.log` 1줄 외 전무 |
| Graceful Shutdown | 🔴 | SIGTERM 무시, 진행 중 요청 강제 종료 |
| Health Check | 🔴 | `/health` 없음 |
| CI/CD | 🔴 | GitHub Actions 없음 |
| README | 🔴 | 뱃지·기능목록·구조·환경변수 문서 없음 |
| 테스트 | 🟡 | 엣지케이스 20개 누락 |
| API 문서 | 🟡 | OpenAPI 없음, 에러 응답 미문서 |
| ERD/아키텍처 | 🟡 | 다이어그램 없음 |

---

## 📋 개선 계획: 3단계 분류

---

### 🔴 1단계: 반드시 필요 (9개, 약 2.5시간)

> 이것들 없으면 포트폴리오로서 치명적

#### 1-1. 에러 처리 체계화 (15분)

```typescript
// 문제: throw → Hono 기본 HTML 에러 페이지
// 해결: app.onError + app.notFound + 커스텀 에러 클래스

class AppError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

// 전역 핸들러로 모든 예외를 JSON으로 통일
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status);
  }
  console.error(err);
  return c.json({ error: '서버 내부 오류', code: 'INTERNAL_ERROR' }, 500);
});

// 정의되지 않은 라우트도 JSON으로
app.notFound((c) => c.json({ error: '경로를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404));
```

#### 1-2. 입력값 검증 (30분)

```typescript
// 문제 1: :id 파라미터에 UUID 아닌 값도 통과 (path traversal 가능)
// 해결: UUID regex 미들웨어
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 문제 2: 닉네임 길이·문자 제한 없음 (<script> 태그 가능)
// 해결: Zod 스키마
const nicknameSchema = z.string().min(2).max(20).regex(/^[a-zA-Z0-9가-힣 _-]+$/);

// 문제 3: JSON 파싱 실패 시 try-catch 없음
// 해결: body 파싱 래핑 또는 onError에서 처리
```

#### 1-3. 보안 기본 설정 (20분)

```typescript
// CORS
import { cors } from 'hono/cors';
app.use('*', cors({ origin: ['http://localhost:5173'], allowMethods: ['GET', 'POST'] }));

// 보안 헤더
import { secureHeaders } from 'hono/secure-headers';
app.use('*', secureHeaders());

// Body 크기 제한
import { bodyLimit } from 'hono/body-limit';
app.use('*', bodyLimit({ maxSize: 50 * 1024 }));

// API 키 인증: 플레이어 생성 시 apiKey 발급, 요청 시 Authorization 헤더 검증
```

#### 1-4. DB 영속성 (40분) — 가장 큰 작업

```bash
npm i drizzle-orm better-sqlite3
npm i -D drizzle-kit @types/better-sqlite3
```

```typescript
// db/schema.ts
export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  nickname: text('nickname').notNull(),
  electricity: integer('electricity').notNull().default(0),
  electricityPerSecond: integer('electricity_per_second').notNull().default(1),
  lastClaimedAt: text('last_claimed_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// db/player.repository.ts — store.ts를 Repository로 교체
// drizzle.config.ts — 마이그레이션 설정
// package.json: "db:generate", "db:migrate" 스크립트 추가
```

#### 1-5. 로깅 (15분)

```bash
npm i pino
npm i -D pino-pretty
```

```typescript
// src/shared/logger.ts
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' } : undefined,
});

// 요청 로깅 미들웨어: method, path, status, duration
// 게임 이벤트: player_created, claim, upgrade, battle
```

#### 1-6. Graceful Shutdown (5분)

```typescript
// serve() 반환값 저장 → server.close() 가능하게
const server = serve({ fetch: app.fetch, port: 3000 }, ...);

// SIGTERM/SIGINT → 진행 중 요청 완료 후 종료
const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  isReady = false;
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

#### 1-7. Health Check (5분)

```typescript
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/ready', (c) => isReady
  ? c.json({ status: 'ready', db: 'connected' })
  : c.json({ status: 'not ready' }, 503));
```

#### 1-8. GitHub Actions CI (10분)

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npm run type-check
      - run: npm test
      - run: npm run build
      - run: npm audit --audit-level=high
```

#### 1-9. README 최소 완성 (15분)

```markdown
뱃지: CI | License | Node 버전
기능 목록: ⚡전기생산 🔼업그레이드 ⚔️전투 🏆랭킹 🎁방치보상
프로젝트 구조: src/ 트리
환경변수: PORT | NODE_ENV | LOG_LEVEL | DATABASE_URL 테이블
실행 방법: npm install → npm run dev
```

---

### 🟡 2단계: 있으면 좋음 (12개, 약 1.5시간)

> 있으면 포트폴리오 퀄리티가 크게 올라감

| # | 항목 | 시간 | 내용 |
|:---:|------|:---:|------|
| 2-1 | Rate Limiting | 10m | claim 1/s, battle 1/3s, upgrade 1/s |
| 2-2 | OpenAPI 문서 | 20m | `@hono/zod-openapi` + Scalar UI → `GET /docs` |
| 2-3 | 프로젝트 구조 개선 | 30m | routes→service→repository 계층 분리 |
| 2-4 | 게임 상수 분리 | 10m | 매직넘버(8,50,10,30) → `game-balance.ts` |
| 2-5 | 중복 로직 제거 | 10m | 생산량 계산 → `game-math.ts` 유틸 함수 |
| 2-6 | 테스트 보강 | 30m | 404케이스, cap, 닉네임 엣지케이스 +20개 |
| 2-7 | ESLint + Prettier | 10m | 코드 스타일 일관성 |
| 2-8 | Docker | 10m | Dockerfile + docker-compose.yml |
| 2-9 | ERD/아키텍처 문서 | 15m | Mermaid 다이어그램 (Player ERD, 시스템 구성도) |
| 2-10 | 배틀 버그 수정 | 5m | 분산 계산 ±0.2% → ±20% |
| 2-11 | 닉네임 중복 체크 | 5m | DB unique constraint |
| 2-12 | 시드 데이터 | 10m | `npm run db:seed` → 더미 100명 |

---

### ⚪ 3단계: 나중에 (15개, 약 2시간)

> 동작에는 지장 없고, 여유 있을 때

| # | 항목 | 시간 |
|:---:|------|:---:|
| 3-1 | 수치 상한 (MAX_EPS) | 5m |
| 3-2 | 통합 테스트 (HTTP 레벨) | 15m |
| 3-3 | 페이지네이션 (랭킹, 플레이어 목록) | 15m |
| 3-4 | `.env.example` | 5m |
| 3-5 | MIT License 파일 | 1m |
| 3-6 | Dependabot 설정 | 5m |
| 3-7 | 배포 가이드 문서 | 10m |
| 3-8 | 확장 ERD (BattleHistory 등) | 10m |
| 3-9 | 테스트 커버리지 리포트 | 5m |
| 3-10 | 405/415/429 응답 | 10m |
| 3-11 | i18n 에러 메시지 | 15m |
| 3-12 | 감사 로그 | 10m |
| 3-13 | 자동 릴리스 (GitHub Release) | 10m |
| 3-14 | 로그 로테이션 | 5m |
| 3-15 | Node 20/22 Matrix CI | 5m |

---

## 🎯 권장 실행 순서

```
1-1 에러 처리 ────── 15m
1-2 입력값 검증 ──── 30m
1-3 보안 ────────── 20m
1-4 DB 영속성 ───── 40m  ← 가장 큰 변화
1-5 로깅 ────────── 15m
1-6 Graceful Shutdown 5m
1-7 Health Check ─── 5m
1-8 GitHub Actions ─ 10m
1-9 README ──────── 15m
───────────────────────── 1단계 완료 (2h 35m)

2-1 Rate Limiting ── 10m
2-2 OpenAPI 문서 ── 20m
2-3 구조 개선 ───── 30m
2-4 게임 상수 분리 ─ 10m
2-5 중복 로직 제거 ─ 10m
   ...순차 진행...
───────────────────────── 2단계 완료 (약 1h 30m 추가)
```

---

## 📁 제안 최종 구조

```
idle-game-server/
├── .github/workflows/ci.yml
├── src/
│   ├── index.ts              # 서버 진입점 (middleware + 라우트 마운트)
│   ├── config.ts              # 환경변수 + 게임 밸런스 상수
│   ├── db/
│   │   ├── schema.ts          # Drizzle 스키마
│   │   ├── index.ts           # DB 연결
│   │   ├── migrate.ts         # 마이그레이션 실행
│   │   ├── seed.ts            # 시드 데이터
│   │   └── repositories/
│   │       └── player.repo.ts
│   ├── modules/
│   │   ├── players/
│   │   │   ├── player.routes.ts
│   │   │   └── player.service.ts
│   │   ├── battle/
│   │   └── ranking/
│   ├── shared/
│   │   ├── errors.ts          # 커스텀 에러 클래스
│   │   ├── logger.ts          # Pino 로거
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── error-handler.ts
│   │   │   └── validator.ts
│   │   └── utils/
│   │       └── game-math.ts   # 생산량 계산
│   └── __tests__/
├── drizzle.config.ts
├── Dockerfile
├── README.md
└── docs/
    ├── MUST_HAVE.md
    ├── NICE_TO_HAVE.md
    ├── BACKLOG.md
    └── gap-analysis/
        └── ... (12개 상세 분석)
```

---

## 📈 기대 효과

| 지표 | 현재 | 목표 |
|------|:---:|:---:|
| 데이터 영속성 | ❌ 휘발성 | ✅ SQLite |
| 에러 응답 형식 | 불일치 | ✅ JSON 통일 + code 필드 |
| 보안 | 0개 조치 | ✅ CORS + 인증 + 헤더 + Rate Limit |
| CI/CD | 없음 | ✅ PR 자동 검증 |
| 운영 가능성 | 불가 | ✅ 로깅 + 헬스체크 + 셧다운 |
| 문서화 | README만 | ✅ OpenAPI + ERD + 구조도 |
