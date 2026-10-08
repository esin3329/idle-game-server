# Idle Game Server

[![CI](https://github.com/esin3329/idle-game-server/actions/workflows/ci.yml/badge.svg)](https://github.com/esin3329/idle-game-server/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen)

Hono와 TypeScript로 만든 방치형 메카 게임 서버입니다. 인증, 재화, 스테이지, 전투 세션, 장비·연구·제작, 운영자 API를 구현하고 Node.js/MySQL 경로와 Cloudflare Workers/PostgreSQL 경로를 함께 관리합니다.

- 저장소: [GitHub](https://github.com/esin3329/idle-game-server)
- Unity 클라이언트: [unity/README.md](./unity/README.md)
- 주요 운영 및 배포 문서: [docs/](./docs/)

## 현재 상태

**2026-10-06 기준 저장소와 문서에 기록된 상태입니다.**

- PostgreSQL 저장소와 Cloudflare Worker 진입점을 구현했고, Cloudflare Worker 배포 및 원격 API 확인 기록이 있습니다.
- 기존 MySQL 경로도 유지하고 있습니다. 원본 서버는 계속 운영 중이며, Unity API 주소 변경과 최종 데이터 동기화가 남아 있어 전체 운영 전환이 끝났다고 표현하지 않습니다.
- Unity 클라이언트는 로그인 후 기본 기지 흐름과 스테이지·전투 세션 API를 연결했습니다. Editor에서 일부 흐름을 확인했지만 회원가입 전체 흐름, Android 기기 실행은 검증되지 않았습니다.
- Unity 실제 전투와 전투 보상 수령은 아직 구현되지 않았습니다. 서버의 전투 API는 별도로 동작하지만 클라이언트와의 완성된 전투 루프는 아닙니다.

자세한 전환 현황과 검증 범위는 [Cloudflare 배포 기록](./docs/CLOUDFLARE_DEPLOY.md)과 [Unity 클라이언트 문서](./unity/README.md)를 참고하세요.

## 주요 기능

- **인증** — JWT 액세스·리프레시 토큰, bcrypt 비밀번호 해시, 계정·세션 관리
- **방치형 경제** — 전기 생산·수령, 생산 업그레이드, 전기·스크랩 잔액과 재화 원장
- **전투 세션** — 스테이지 입장, 세션 상태, 진행 이벤트, 강화 선택, 종료 및 보상 API
- **메카 성장** — 파츠 인벤토리·장착·강화, 구성 프리셋, 연구 트리, 설계도와 제작
- **운영 도구** — 역할 기반 관리자 API와 React 관리자 페이지, 제재·재화 지급·보안 이벤트·감사 로그
- **운영 엔드포인트** — health/ready, metrics, 구조화 로그, Cloudflare Worker의 정적 관리자 페이지 제공

## Public API 경로

인증·플레이어·스테이지·전투·파츠·연구·제작·관리자 애플리케이션 경로는 `/api/...`를 사용합니다. 예: `/api/auth/login`, `/api/players/:id`, `/api/stages`, `/api/battles/start`, `/api/admin/users`. 루트 경로의 `/health`, `/ready`, `/metrics`는 운영 상태 확인용입니다. 레거시 애플리케이션 루트 경로(`/auth`, `/parts`, `/stages` 등)는 더 이상 API 별칭으로 제공하지 않습니다.

Unity는 경로에 `/api`를 포함해 요청합니다. 서버 주소는 origin으로 설정하며, 기존 설정처럼 끝에 `/api`가 있어도 클라이언트 URL 해석기가 중복 접두사를 제거합니다. Worker는 `/api/*` 요청을 Hono API로 전달하고 그 밖의 경로는 관리자 정적 자산에 사용합니다.

## 전투 검증 경계

전투 세션은 서버가 생성하고 관리합니다. 진행 요청의 경과 시간·처치 수·코어 에너지·보스 정보와 강화 선택을 검증하며, 종료 요청에서는 세션에 누적된 값과 결과 보고를 대조하고 서버가 보상을 계산합니다.

이 구현은 **서버 권위 전투 MVP**입니다. 현재 Unity 클라이언트는 실제 전투 시뮬레이션과 보상 수령까지 연결하지 않았고, 서버도 모든 전투 프레임을 재시뮬레이션하지 않습니다. 따라서 이를 완성된 치트 방지 전투 시뮬레이터로 설명하지 않습니다.

~~~text
Client
  ├─ POST /api/battles/start
  ├─ POST /api/battles/:sessionId/progress
  ├─ POST /api/battles/:sessionId/upgrades/select
  └─ POST /api/battles/:sessionId/finish
                 ↓
      session state validation
                 ↓
       reward calculation + storage
~~~

## 재화 정합성과 멱등성

재화 잔액과 변동 내역을 지갑 테이블과 재화 원장에 함께 기록합니다. PostgreSQL 지갑 경로는 DB 트랜잭션 안에서 재요청 키를 확인하고, 동일 키 요청을 잠근 뒤 잔액 변경과 원장 기록을 처리합니다. MySQL 지갑 경로도 트랜잭션과 원장의 유일 키를 사용합니다.

멱등성 동작은 저장소 구현에 따라 세부가 다를 수 있습니다. README에서는 이를 모든 API·모든 DB에 동일한 보장으로 일반화하지 않습니다. 재시도와 동시 요청에 관한 구현은 [PostgreSQL 지갑 저장소](./src/db/postgres-wallet.repository.ts)와 [MySQL 지갑 저장소](./src/db/mysql-wallet.repository.ts)에서 확인할 수 있습니다.

## 구성과 저장소 경로

| 경로 | 용도와 상태 |
|---|---|
| PostgreSQL | Cloudflare Worker 대상 저장소. <code>DB_DRIVER=postgres</code>와 <code>DATABASE_URL</code> 또는 Worker Hyperdrive 연결을 사용합니다. |
| MySQL 8 | 기존 Node.js/Docker 경로 및 현재 CI 통합 작업에서 사용합니다. PostgreSQL과 기능·운영 절차가 완전히 같다고 가정하지 않습니다. |
| JSON | 로컬 개발·테스트용 저장소입니다. 운영 데이터 저장소로 사용하지 않습니다. |

Worker는 Hono API와 <code>admin/dist</code> 정적 파일을 함께 제공합니다. PostgreSQL 스키마는 [src/db/postgres-schema.ts](./src/db/postgres-schema.ts), 초기 마이그레이션은 [supabase/migrations/](./supabase/migrations/)에 있습니다. MySQL 마이그레이션과 Docker 설정은 별도로 남아 있습니다.

## 로컬 실행

### Cloudflare Worker + PostgreSQL 개발

Node.js 20 이상이 필요합니다.

~~~bash
npm ci
npm ci --prefix admin
~~~

<code>.dev.vars.example</code>을 참고해 로컬 <code>.dev.vars</code>를 만들고 PostgreSQL 연결 주소와 개발용 JWT 비밀값을 설정합니다. 실제 비밀값은 저장소에 커밋하지 마세요.

~~~bash
npm run db:migrate:postgres
npm run dev:cloudflare
~~~

<code>db:migrate:postgres</code>는 <code>DATABASE_URL</code>이 가리키는 PostgreSQL 데이터베이스에 마이그레이션을 적용합니다. Cloudflare 원격 DB를 대상으로 실행할 때는 [배포 문서](./docs/CLOUDFLARE_DEPLOY.md)의 절차와 대상을 먼저 확인하세요.

### 기존 MySQL 경로

~~~bash
docker compose up -d mysql
npm run db:migrate
DB_DRIVER=mysql npm run dev
~~~

필요한 MySQL 및 JWT 환경 변수는 [.env.example](./.env.example)을 참고하세요. 백업·복구 스크립트와 현재 운영 가이드는 MySQL 중심입니다.

## 관리자 페이지

<code>admin/</code>은 React, Vite, Tailwind CSS로 만든 운영자 UI입니다. 사용자 검색·상세 조회, 제재, 재화 지급, 보안 이벤트 검토, 감사 로그 확인 기능을 제공합니다. 권한은 <code>user</code>, <code>operator</code>, <code>admin</code>으로 구분합니다.

Cloudflare 개발 실행 명령은 관리자 UI를 빌드한 뒤 Worker와 함께 제공합니다. 별도 UI 개발은 <code>admin/</code>의 안내와 [관리자 UI 설계 문서](./docs/admin-ui-design.md)를 참고하세요.

## 테스트와 CI

~~~bash
npm run type-check
npm run type-check:cloudflare
npm test
npm run build
npm run test:postgres
npm ci --prefix admin
npm run build:admin
npx wrangler deploy --dry-run --outdir .tools/worker-build
~~~

GitHub Actions는 Node.js 20·22에서 서버 타입 검사·Vitest·빌드·npm audit을 실행합니다. 별도 PostgreSQL 작업은 `npm run test:postgres`로 마이그레이션과 실제 PostgreSQL 통합 시나리오를 확인합니다. Worker 작업은 관리자 자산을 빌드하고 Cloudflare 타입 검사와 Wrangler dry-run 번들을 수행하며 실제 배포는 하지 않습니다. MySQL 작업은 별도 MySQL 8 서비스를 사용합니다. 저장소에는 아직 TODO 테스트가 있으므로 테스트 수나 DB 통합 범위를 완성된 커버리지로 해석하지 않습니다.

`npm audit`은 개발 의존성까지 검사합니다. `package.json`의 `overrides`는 아직 수정되지 않은 상위 의존성 범위(`drizzle-kit` → `esbuild`, `wrangler` → `miniflare` → `sharp`, `autocannon` → `hyperid` → `uuid`)를 보안 수정 버전으로 재정의합니다. 상위 패키지에서 수정 버전을 제공하면 override를 재검토하고 제거하세요.

## 문서

- [Cloudflare + PostgreSQL 배포 및 전환 기록](./docs/CLOUDFLARE_DEPLOY.md)
- [운영 가이드](./docs/operations.md) — 현재 MySQL 운영 절차 중심
- [Unity 클라이언트와 검증 상태](./unity/README.md)
- [관리자 UI 설계](./docs/admin-ui-design.md)
- [문제 대응 runbook](./docs/runbooks/)

## 기술 스택

| 영역 | 기술 |
|---|---|
| API | Node.js, Hono, TypeScript, Zod |
| 데이터베이스 | PostgreSQL, MySQL 8, Drizzle ORM |
| 인증·로그 | JWT, bcryptjs, Pino |
| 관리자 UI | React, Vite, Tailwind CSS |
| 실행·배포 | Docker Compose, Cloudflare Workers, Hyperdrive |
| 검증·CI | Vitest, GitHub Actions |
