# Idle Game Server

[![CI](https://github.com/esin3329/idle-game-server/actions/workflows/ci.yml/badge.svg)](https://github.com/esin3329/idle-game-server/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen)

Hono와 TypeScript로 만든 방치형 메카 게임 서버입니다. 인증, 재화, 스테이지, 전투 세션, 장비·연구·제작, 운영자 API를 구현하며 **Cloudflare Workers + Supabase(PostgreSQL)**(+ 로컬/테스트용 JSON 저장소) 구조로 동작합니다.

- 저장소: [GitHub](https://github.com/esin3329/idle-game-server)
- Unity 클라이언트: [unity/README.md](./unity/README.md)
- 주요 운영 및 배포 문서: [docs/](./docs/)

## 현재 상태

**2026-11-27 기준 저장소와 문서에 기록된 상태입니다.**

- 백엔드는 **Supabase(PostgreSQL) + JSON(개발/테스트)** 단일 구조로 정리되었습니다(기존 MySQL·Docker 경로 제거 완료).
- Cloudflare Worker(`https://idle-game-server.qlqlf2226.workers.dev`)가 Hyperdrive를 통해 Supabase PostgreSQL과 연결되고, Unity 클라이언트 기본 API 주소도 해당 Worker로 전환되었습니다.
- Unity 클라이언트는 로그인 후 기지·스테이지 목록·실제 탄막/서바이버 전투(`BattleRun.cs`, `ClientBattle.cs`)·5초 주기 `progress` 동기화 및 `finish` 보상 수령까지 연결했습니다. 기지에서 메타 화면 네 개(격납고 `ShowHangar`, 제작소 `ShowWorkshop`, 연구소 `ShowResearch`, 랭킹 `ShowRankings`)로 들어갈 수 있습니다. 서버가 반영하는 연구는 16개(전기 생산, 방치 보상, 생산 업그레이드 비용 할인, 전투 스탯, 전투 스크랩 보상)이고 그 외는 저장만 되는 프리뷰입니다. 장착 파츠와 연구 효과는 새 전투 세션의 `statSnapshot`·`loadoutSnapshot`·`researchSnapshot`에만 들어가며, 진행 중 세션은 바뀌지 않습니다. 인배틀 레벨업은 `upgrades/offer`·`upgrades/select` 3택이고, 구 서버가 offer에 `404`(`ROUTE_NOT_FOUND`)를 주면 모달 없이 전투를 계속합니다. 다만 회원가입 전체 흐름, Cloudflare 실서버 완주, Android 빌드 및 기기 실행, 최종 운영 전환 데이터 동기화는 아직 검증되지 않았습니다.

자세한 전환 현황과 검증 범위는 [Cloudflare 배포 기록](./docs/CLOUDFLARE_DEPLOY.md)과 [Unity 클라이언트 문서](./unity/README.md), [전투 클라이언트 구조](./unity/IdleGameClient/BATTLE.md)를 참고하세요.

## 주요 기능

- **인증** — JWT 액세스·리프레시 토큰(로테이션), bcrypt 비밀번호 해시, 선택적 `AUTH_PROVIDER=supabase` 지원
- **방치형 경제** — 전기 생산·수령, 생산 업그레이드, 전기·스크랩 잔액과 재화 원장
- **전투 세션** — 스테이지 입장, 세션 상태, 진행 이벤트, 강화 선택, 종료 및 보상 API
- **메카 성장** — 파츠 인벤토리·장착·강화, 구성 프리셋, 연구 트리, 설계도와 제작
- **운영 도구** — 역할 기반 관리자 API와 React 관리자 페이지, 제재·재화 지급·보안 이벤트·감사 로그·GameOps AI 분석
- **운영 엔드포인트** — `/health`, `/ready`, `/metrics`, 구조화 로그, Cloudflare Worker 정적 관리자 페이지 제공

## Public API 경로

인증·플레이어·스테이지·전투·파츠·연구·제작·관리자 애플리케이션 경로는 `/api/...`를 사용합니다. 예: `/api/auth/login`, `/api/players/:id`, `/api/stages`, `/api/battles/start`, `/api/admin/users`. 루트 경로의 `/health`, `/ready`, `/metrics`는 운영 상태 확인용입니다.

Unity는 경로에 `/api`를 포함해 요청하며, Worker는 `/api/*`·운영 엔드포인트를 Hono API로 전달하고 그 밖의 경로는 관리자 정적 자산(`admin/dist`)에 사용합니다.

## 전투 검증 경계

전투 세션은 서버가 생성하고 관리합니다. 세션을 만들 때 장착 파츠와 연구 효과를 `statSnapshot`, `loadoutSnapshot`, `researchSnapshot`에 복사합니다. 이미 진행 중인 세션의 스냅샷은 바꾸지 않습니다. 진행 요청의 경과 시간·처치 수·코어 에너지·보스 정보와 강화 선택을 검증하며, 종료 요청에서는 세션에 누적된 값과 결과 보고를 대조하고 서버가 보상을 계산합니다. 인배틀 레벨업은 최대 3개 선택지입니다. `POST /api/battles/:sessionId/upgrades/offer`로 제안하고 `POST /api/battles/:sessionId/upgrades/select`로 고릅니다. offer가 `404`이고 코드가 비어 있거나 `ROUTE_NOT_FOUND`이면 클라이언트는 강화 미지원으로 보고 모달 없이 전투를 계속합니다.

이 구현은 **서버 권위 전투 MVP**입니다. Unity 클라이언트는 자동 사격·대시·적/보스 탄막 시뮬레이션과 주기적 진행 이벤트·종료 보고를 전송하지만, 서버가 모든 전투 프레임을 재시뮬레이션하지는 않고 세션 누적 상태와 통계 상한을 검증합니다.

~~~text
Client
  ├─ POST /api/battles/start
  ├─ POST /api/battles/:sessionId/progress
  ├─ POST /api/battles/:sessionId/upgrades/offer
  ├─ POST /api/battles/:sessionId/upgrades/select
  └─ POST /api/battles/:sessionId/finish
                 ↓
      session state validation
                 ↓
       reward calculation + storage
~~~

## 재화 정합성과 멱등성

재화 잔액과 변동 내역을 지갑 테이블과 재화 원장에 함께 기록합니다. PostgreSQL 지갑 경로([src/db/postgres-wallet.repository.ts](./src/db/postgres-wallet.repository.ts))는 DB 트랜잭션 안에서 재요청 키를 확인하고, 동일 키 요청을 잠근 뒤 잔액 변경과 원장 기록을 처리합니다. 또한 [`src/shared/postgres-request.ts`](./src/shared/postgres-request.ts)가 비-GET 요청을 단일 트랜잭션 및 `pg_advisory_xact_lock`으로 직렬화합니다.

## 구성과 저장소 경로

| 경로 | 용도와 상태 |
|---|---|
| PostgreSQL (Supabase) | 운영·Worker 대상 저장소. `DB_DRIVER=postgres`와 Hyperdrive 또는 `DATABASE_URL`을 사용합니다. |
| JSON | 로컬 개발·Vitest 단위 테스트용 저장소입니다(`DB_DRIVER=json`). 운영 데이터 저장소로 사용하지 않습니다. |

PostgreSQL 스키마는 [src/db/postgres-schema.ts](./src/db/postgres-schema.ts), SQL 마이그레이션은 [supabase/migrations/](./supabase/migrations/)에 있습니다.

## 로컬 실행

Node.js 20 이상이 필요합니다.

~~~bash
npm ci
npm ci --prefix admin
~~~

`.dev.vars.example`을 참고해 로컬 `.dev.vars`를 만들고 PostgreSQL 연결 주소와 개발용 JWT 비밀값을 설정합니다.

~~~bash
npm run db:migrate
npm run dev:cloudflare
~~~

`db:migrate`는 `DATABASE_URL`이 가리키는 PostgreSQL 데이터베이스에 마이그레이션을 적용합니다. 로컬 Node 개발 서버만 실행할 때는 `.env.example`을 참고해 `npm run dev`를 사용할 수 있습니다.

## 관리자 페이지

`admin/`은 React, Vite, Tailwind CSS로 만든 운영자 UI입니다. 사용자 검색·상세 조회, 제재, 재화 지급, 보안 이벤트 검토, 감사 로그 확인, GameOps AI 분석 기능을 제공합니다.

Cloudflare 개발/배포 명령은 관리자 UI를 빌드한 뒤 Worker와 함께 제공합니다. 별도 UI 안내는 [관리자 UI 설계 문서](./docs/admin-ui-design.md)를 참고하세요.

## 테스트와 CI

~~~bash
npm run type-check
npm run type-check:cloudflare
npm test
npm run build
npm run test:postgres
npm ci --prefix admin
npm --prefix admin test
npm run build:admin
npx wrangler deploy --dry-run --outdir .tools/worker-build
~~~

`npm --prefix admin test`는 `admin` SPA 스모크 테스트(`admin/src/__tests__/admin-smoke.test.ts`)입니다. 실제 서버 없이 API 클라이언트 계약을 확인합니다.

GitHub Actions(`.github/workflows/ci.yml`)는 `unit`(Node 20·22 타입 검사·Vitest·빌드·npm audit), `postgres`(`npm run test:postgres`로 embedded PostgreSQL 스키마·RLS·API 통합 검증), `worker`(`npm --prefix admin test` 관리자 SPA 스모크 테스트·관리자 빌드·Cloudflare 타입 검사·Wrangler dry-run 번들) 3개 잡을 실행합니다.

## 문서

- [Cloudflare + Supabase 배포 및 전환 기록](./docs/CLOUDFLARE_DEPLOY.md)
- [운영 가이드](./docs/operations.md)
- [스테이지 ID 정규화](./docs/STAGE_MIGRATION.md)
- [Unity 클라이언트와 검증 상태](./unity/README.md)
- [관리자 UI 설계](./docs/admin-ui-design.md)
- [문제 대응 runbook](./docs/runbooks/)

## 기술 스택

| 영역 | 기술 |
|---|---|
| API | Node.js, Hono, TypeScript, Zod |
| 데이터베이스 | Supabase PostgreSQL, Drizzle ORM (`pg`) |
| 인증·로그 | JWT, bcryptjs, Pino, Supabase Auth(선택) |
| 관리자 UI | React, Vite, Tailwind CSS |
| 실행·배포 | Cloudflare Workers, Hyperdrive, Queues |
| 검증·CI | Vitest, embedded-postgres, GitHub Actions |
