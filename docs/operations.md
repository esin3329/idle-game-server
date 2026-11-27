# 운영 가이드

기준일: 2026-11-27. 런타임은 **Cloudflare Workers + Supabase PostgreSQL + Hyperdrive + Queues/Cron**입니다. 로컬 개발과 Vitest만 JSON 저장소를 사용합니다.

배포 전환 기록은 [CLOUDFLARE_DEPLOY.md](./CLOUDFLARE_DEPLOY.md), 스테이지 ID 정규화는 [STAGE_MIGRATION.md](./STAGE_MIGRATION.md), 과거 JSON 부하 수치는 [benchmark.md](./benchmark.md)를 봅니다.

## 1. 저장소 드라이버

`src/provider.ts`의 `usePostgres()`가 저장소를 고릅니다.

| `DB_DRIVER` | 동작 |
|---|---|
| `postgres` | Supabase PostgreSQL. `DATABASE_URL` 또는 Worker의 Hyperdrive 연결 문자열이 필요합니다. |
| `json` | 프로세스 로컬 JSON (`DATA_FILE`, 기본 `data.json`). 개발·단위 테스트 전용입니다. |
| 미설정 | `NODE_ENV=production`이거나 `DATABASE_URL`이 있으면 PostgreSQL, 그 외에는 JSON입니다. |
| `mysql` | 즉시 오류입니다. 드라이버가 없습니다. |

Worker 변수(`wrangler.jsonc`의 `vars`)는 `DB_DRIVER=postgres`, `AUTH_PROVIDER=local`, `NODE_ENV=production`, `LOG_LEVEL=info`입니다.

로컬 Worker 비밀은 [.dev.vars.example](../.dev.vars.example)을 `.dev.vars`로 복사합니다. Node 개발 서버(`npm run dev`)는 [.env.example](../.env.example)을 따릅니다. 두 파일의 실제 비밀은 커밋하지 않습니다.

## 2. 스키마 마이그레이션

SQL은 [supabase/migrations/](../supabase/migrations/)에 있습니다.

| 파일 | 역할 |
|---|---|
| `20261005083456_game_postgres.sql` | `game` 스키마 초기 테이블 |
| `20261005083457_crafting_idempotency.sql` | 제작 멱등성 |
| `20261005083458_battle_upgrade_option_constraints.sql` | 전투 강화 선택 제약 |
| `20261127000001_normalize_stage_ids.sql` | 스테이지 ID 정규화. 절차는 [STAGE_MIGRATION.md](./STAGE_MIGRATION.md) |

`npm run db:migrate:postgres`와 `npm run db:migrate`는 같은 실행기(`src/db/postgres-migrate-cli.ts`)입니다. `DATABASE_URL`이 없으면 시작하지 않습니다. 실행기는 `supabase/migrations/*.sql`을 이름순으로 읽고, 파일 원본 SHA-256을 `game.schema_migrations`와 비교합니다. 적용된 파일을 고치면 `Applied migration changed`로 중단합니다. 한 번의 실행은 단일 트랜잭션이며 `pg_advisory_xact_lock`으로 마이그레이터끼리만 직렬화합니다.

이미 MCP 등으로 초기 스키마를 넣은 원격 DB에는 같은 초기 SQL을 다시 실행하지 않습니다. `game.schema_migrations` 유무와 체크섬 확인은 [STAGE_MIGRATION.md](./STAGE_MIGRATION.md)의 사전 확인을 따릅니다. 줄바꿈은 LF입니다.

### 전투 콘텐츠 시드

```powershell
$env:DATABASE_URL = "<postgres connection string>"
npm run db:battle-seed
```

`src/db/battle-seed.ts`가 `src/data/stages.ts`의 스테이지와 고정 보상표(`partial` / `normal` / `first`)를 upsert합니다. 스테이지 ID를 바꾼 뒤에는 마이그레이션 런북의 시드 순서를 따릅니다.

### 운영자 시드

```powershell
$env:DATABASE_URL = "<postgres connection string>"
$env:OPERATOR_EMAIL = "operator@example.com"
$env:OPERATOR_PASSWORD = "<한 번만 쓰는 초기 비밀번호>"
npm run db:seed-operator
```

`src/db/seed-operator.ts`는 **초기 admin 시드 전용**입니다. 역할(`admin`, `operator`, `viewer`, `support`, `game_master`, `administrator`)과 권한 코드를 만들고, 지정 이메일을 `role=admin`, `status=active`로 upsert합니다. 같은 이메일의 기존 계정이 있으면 역할·상태·비밀번호 해시를 모두 덮어쓰므로 일반 `operator` 계정의 비밀번호 변경에 쓰면 안 됩니다. 환경변수를 생략하면 `admin@projectcoreforge.local` / `admin-change-me-immediately`가 쓰이므로 운영 DB에서는 둘 다 지정합니다.

### 운영자 비밀번호 변경

기존 운영자(`operator`, `admin`, `administrator`, `viewer`, `support`, `game_master`)의 비밀번호는 역할·상태를 보존하는 전용 명령으로 바꿉니다. 기본 이메일·비밀번호는 없으며 둘 다 필수입니다(비밀번호 8자 이상). `AUTH_PROVIDER=supabase`에서는 실행되지 않으므로 Supabase Auth에서 재설정합니다.

```powershell
$env:DATABASE_URL = "<postgres connection string>"
$env:OPERATOR_EMAIL = "operator@example.com"
$env:OPERATOR_NEW_PASSWORD = "<새 비밀번호>"
npm run db:reset-operator-password
```

`src/db/reset-operator-password.ts`는 대상 `users` 행의 `password_hash`와 `updated_at`만 갱신하고 `operator_audit_logs`에 `operator_password_reset`을 기록합니다(비밀번호·해시는 기록하지 않음). 로그인·갱신·로그아웃 API와 관리자 UI에는 비밀번호 변경 화면이 없습니다.

## 3. Worker 라우팅

[`wrangler.jsonc`](../wrangler.jsonc)의 `assets.directory`는 `./admin/dist`입니다. `not_found_handling`은 `single-page-application`입니다. `run_worker_first`와 `src/worker.ts`가 아래 경로만 Hono로 보냅니다. 그 외는 관리자 정적 자산입니다.

| 경로 | 동작 |
|---|---|
| `GET /health` | `{ status, uptime, environment }`. DB를 열지 않습니다. |
| `GET /health/live` | `{ status: "ok" }`. DB를 열지 않습니다. |
| `GET /api/health` | `{ status: "ok" }`. DB를 열지 않습니다. |
| `GET /ready` | 연결 후 `SELECT 1`. JSON이면 DB 없이 ready. 연결 실패 시 Worker가 `503` `{ code: "DATABASE_UNAVAILABLE" }`. 연결은 됐지만 쿼리가 실패하면 `{ status: "degraded", checks.database: "disconnected" }`와 `503`. `markNotReady()`(Node 종료) 중에는 `{ status: "not ready" }` `503`. |
| `GET /metrics` | `operatorAuth`. 아래 참고. |
| `/api/*` | 게임·인증·운영 API. |

`/ready`와 `/metrics`는 Hyperdrive 또는 `DATABASE_URL`이 있어야 앱 코드에 들어갑니다. `NODE_ENV=production`이면 `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`이 비어 있거나 `dev-secret-change-in-production`이면 그 요청은 기동 검증에서 실패합니다.

### `/metrics`

`src/app.ts`가 `operatorAuth` 뒤에 `getMetrics()` JSON을 반환합니다. 역할이 `operator`, `admin`, `administrator`가 아니면 `403`. 로컬 JWT(`AUTH_PROVIDER`가 `supabase`가 아닐 때)는 `Authorization: Bearer` 액세스 토큰입니다. Supabase Auth 모드도 같은 역할 검사를 합니다.

수집은 프로세스(Worker isolate) 메모리입니다. 재시작·다른 isolate에서는 0부터입니다. Prometheus 텍스트 형식은 아닙니다. 필드: `requests.total`, `errors.total`, `errors.rate`(4xx+5xx), `statusCodes`, `responseTime.histogram`(10/50/100/200/500/1000/3000/10000ms), `topPaths`(UUID 구간은 `/:id`, 상위 10개), `timestamp`.

## 4. 로그

Pino (`src/shared/logger.ts`). 레벨은 `LOG_LEVEL`(기본 `info`). 프로덕션은 JSON stdout이고, 그 외에는 `pino-pretty`입니다. Worker `observability.logs.enabled`는 true입니다.

Redaction 경로: `req.headers.authorization`, `req.headers.cookie`, `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `*.password`, `*.token`, `*.secret`.

자식 로거: `auditLog`(category `audit`), `battleLog`, `adminLog`, `authLog`. 보안 이벤트 저장 정책은 JWT·Authorization·password·전체 body를 넣지 않고, 허용 상세는 `code`와 `sessionId`입니다. 기록 실패는 사용자 요청을 실패시키지 않습니다. 재화·보상 이벤트는 트랜잭션 안에서 처리됩니다.

## 5. Hyperdrive, 큐, Cron

- Hyperdrive 바인딩 이름: `HYPERDRIVE`. `src/worker.ts`는 `env.HYPERDRIVE.connectionString`을 쓰고, 없으면 `DATABASE_URL`을 씁니다. 둘 다 없으면 해당 요청은 `503 DATABASE_UNAVAILABLE`입니다.
- 큐 바인딩 `AI_RUNS_QUEUE`, 큐 이름 `idle-game-ai-runs`. Consumer `max_batch_size` 1, `max_retries` 0. 본문이 UUID `runId`가 아니면 ack만 합니다. 맞으면 `processAiRun` 후 ack합니다.
- Cron `* * * * *`(매분). 만료된 AI run 정리, 대기 run을 큐에 넣고, `game.request_idempotency`·`game.request_rate_limits`의 만료 행을 삭제합니다.

## 6. 인증 모드

`AUTH_PROVIDER=local`(기본, Worker vars와 동일): 게임 서버 JWT. 액세스·리프레시 비밀은 `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. 리프레시 기본 만료는 21일(`JWT_REFRESH_EXPIRES_IN`으로 재정의 가능).

`AUTH_PROVIDER=supabase`: `src/shared/supabase-auth.ts`가 Supabase Auth(`/auth/v1`)를 호출합니다. `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`(또는 `SUPABASE_ANON_KEY`)가 필요합니다. 없으면 `503 AUTH_NOT_CONFIGURED`.

계정 이관은 `npm run db:import-auth -- users.json`이 기본 미리보기입니다. 실제 적용은 `--apply --target <SUPABASE_URL과 동일한 HTTPS>`와 `SUPABASE_SERVICE_ROLE_KEY`가 필요합니다. 서비스 롤 키는 이관 환경에만 두고 Unity·관리자 정적 파일·저장소에 넣지 않습니다. 이관·검증이 끝난 뒤에만 `AUTH_PROVIDER=supabase`로 바꿉니다. 절차 배경은 [CLOUDFLARE_DEPLOY.md](./CLOUDFLARE_DEPLOY.md)입니다.

## 7. 백업과 복구

운영 데이터는 Supabase PostgreSQL `game` 스키마입니다.

1. **플랫폼 백업.** Supabase 대시보드의 Database Backups를 확인합니다. Point-in-Time Recovery는 프로젝트 플랜에서 켜진 경우에만 있습니다. 보존 기간과 복구 대상(새 프로젝트인지, 기존 프로젝트 되돌리기인지)은 대시보드 안내를 따릅니다. 마이그레이션 실행기(`npm run db:migrate:postgres`)로 관리하는 DB에서만 `game.schema_migrations`의 이름·체크섬 일치를 요구합니다. MCP로 초기화한 경로 B 운영 DB는 별도 backfill 전까지 이력 부재를 오류로 간주하지 않으며, 원본과 복구본의 기준선 상태(테이블 수·핵심 데이터)가 동일한지 확인합니다. 그 다음 Hyperdrive 대상만 바꿉니다. 경로 구분은 [STAGE_MIGRATION.md](./STAGE_MIGRATION.md)를 따릅니다.
2. **논리 덤프.** 진행 중 전투·지급이 있으면 쓰기 트래픽을 멈춘 뒤 덤프합니다.

```powershell
pg_dump --schema=game --no-owner --format=custom --file=game.dump $env:DATABASE_URL
```

복구는 비어 있는 데이터베이스에 합니다. 운영 중인 스키마 위에 `pg_restore`를 덮어쓰지 않습니다.

```powershell
pg_restore --no-owner --dbname=$env:RESTORE_DATABASE_URL game.dump
```

복구본에서 `/ready`, 로그인, 잔액·원장 표본, 스테이지 ID를 확인한 뒤 Hyperdrive 연결을 그 데이터베이스로 바꿉니다. 덤프 파일에는 계정 해시와 개인정보가 있으므로 저장소에 커밋하지 않습니다.

스테이지 ID 마이그레이션 전의 필수 백업 순서는 [STAGE_MIGRATION.md](./STAGE_MIGRATION.md)를 따릅니다.

## 8. 배포와 롤백

```powershell
npm ci
npm ci --prefix admin
npm run deploy:cloudflare
```

`deploy:cloudflare`는 `npm run build:admin`(`admin/dist`) 후 `wrangler deploy`입니다. 배포 없이 번들만 보려면 CI와 같이 `npx wrangler deploy --dry-run --outdir .tools/worker-build`입니다. dry-run은 원격 DB에 쓰지 않습니다.

비밀(JWT, Supabase 키, AI 키)은 Wrangler secret으로 두고 `vars`에 넣지 않습니다.

```powershell
npx wrangler deployments list
npx wrangler rollback
```

`wrangler rollback`은 직전 Worker 버전으로 되돌립니다. 특정 버전은 `deployments list`의 버전 ID를 인자로 줍니다. 롤백은 Worker 코드와 정적 자산만 되돌립니다. 이미 적용된 SQL은 되돌리지 않으므로 스키마 변경 배포는 백업 이후에 합니다.

로컬 통합 실행은 `npm run dev:cloudflare`(`build:admin` + `wrangler dev`)입니다.

## 9. CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)는 `master` push와 pull request에서 세 잡을 돌립니다.

| 잡 | 내용 |
|---|---|
| `unit` | Node 20·22. `npm ci`, `tsc --noEmit`, `npm test`, `npm run build`, `npm audit --audit-level=high` |
| `postgres` | Node 22, 15분. `npm run test:postgres` (embedded PostgreSQL 스키마·RLS·API) |
| `worker` | Node 22, 15분. `npm ci --prefix admin`, `npm --prefix admin test`, `npm run build:admin`, `npm run type-check:cloudflare`, `wrangler deploy --dry-run` |

## 10. 점검 체크리스트

### 매일

- `GET /health`, `GET /health/live`가 `200`인지, `GET /ready`가 `ready`인지 확인합니다.
- Worker 로그에서 `DATABASE_UNAVAILABLE`, `Production secrets not configured`, AI provider 오류가 반복되지 않는지 봅니다.
- 큐 `idle-game-ai-runs` 적체와 Cron 실패를 봅니다.
- 관리자 감사 로그에서 전날 재화 지급·제재가 티켓과 맞는지 봅니다. 문의 유형별 절차: [보상 누락](./runbooks/missing-reward.md), [중복 지급 의심](./runbooks/duplicate-grant.md), [전투 결과 거절](./runbooks/battle-rejected.md).

### 매주

- Supabase 백업(및 PITR이 켜져 있으면 최근 복구 지점)이 갱신됐는지 확인합니다.
- `npx wrangler deployments list`로 의도하지 않은 버전이 최신인지 확인합니다.
- 마이그레이션 실행기(`npm run db:migrate:postgres`)로 관리하는 DB에서만 `game.schema_migrations`의 이름·체크섬 일치를 요구합니다. MCP로 초기화한 경로 B 운영 DB는 별도 backfill 전까지 이력 부재를 오류로 간주하지 않으며, 원본과 복구본의 기준선 상태(테이블 수·핵심 데이터)가 동일한지 확인합니다. 실행기를 쓰는 DB의 불일치는 [STAGE_MIGRATION.md](./STAGE_MIGRATION.md) 절차로만 해소합니다.
- CI `unit` / `postgres` / `worker`가 기본 브랜치에서 녹색인지 확인합니다.

JSON 저장소 기준의 2026-07-30 autocannon 수치는 용량 계획의 현재 PostgreSQL 수치가 아닙니다. [benchmark.md](./benchmark.md)는 그 측정 기록입니다.
