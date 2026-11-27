# 스테이지 ID 정규화 마이그레이션 런북

대상 파일: `supabase/migrations/20261127000001_normalize_stage_ids.sql`

## 변환 규칙

| 레거시 ID | 정규 ID |
|---|---|
| `stage_02_canyon` | `stage_02_factory` |
| `stage_03_furnace` | `stage_03_lab` |
| `stage_04_fortress` | `stage_04_core` |

마이그레이션은 하나의 `DO $$ ... END $$;` 블록(+ 이후 인덱스 2개)으로 `game` 스키마를 정규화한다. 이미 정규화된 DB에서는 모든 문장이 0행에 매칭되어 아무 일도 하지 않는다(멱등).

실행 순서:

1. **userId 키 행 정리** — `player_stage_progress`/`player_records`에 `player_id = users.id`로 저장된 행을 `player_profiles` 기준 `player_id`로 옮기고, 같은 `(player_id, stage_id)`가 있으면 아래 병합 규칙으로 합친 뒤 userId 행을 삭제한다. 프로필이 없거나 `user_id`가 여러 프로필에 걸린 행은 건드리지 않는다. `battle_sessions.player_id`는 CLOUDFLARE_DEPLOY.md의 호환성 확인 대상이므로 변경하지 않는다.
2. **스테이지별 치환** — 아래 표.
3. **중복 제거** — `stage_bosses (stage_id, sequence, boss_code)`, `stage_rewards (stage_id, clear_type)` 중복은 `created_at`이 가장 이른 행, 같으면 `id`가 가장 작은 행만 남긴다.
4. **정규 스테이지 메타데이터 동기화** — `stage_02_factory`/`stage_03_lab`/`stage_04_core`의 `name`, `description`, `sequence`, `entry_requirement`, `duration_seconds`, `recommended_power`, `enemy_set`, `boss_timings`, `max_kills`, `max_core_energy`, `core_per_level`, `core_per_kill`, `scrap_per_kill`, `content_version`을 `src/data/stages.ts`와 동일한 값으로 upsert한다(기존 행의 `unlocked`/`enabled`는 유지). 따라서 `db:battle-seed` 실행 전에도 `boss_timings` 개수와 정규 보스 수가 일치한다. `game.stages`가 비어 있는 새 DB에서는 건너뛴다. **`stages.ts`의 해당 값이 바뀌면 이 SQL(이미 적용된 후에는 수정 불가)이 아니라 새 마이그레이션 또는 `db:battle-seed`로 반영한다.**
5. 유니크 인덱스 `uq_sr_stage_clear_type`, `uq_sb_stage_sequence_boss`를 `IF NOT EXISTS`로 생성(중복 제거 이후).

| 테이블 | 처리 |
|---|---|
| `stages` | `entry_requirement` 내 레거시 ID를 먼저 치환(`clear_` 접두사 형태 포함). 정규 행이 없으면 `id`를 변경, 있으면 레거시 행 삭제 |
| `battle_sessions` | 레거시 ID의 `active`/`completing` 세션은 먼저 `status='abandoned'`, `result_code='STAGE_MIGRATION_RESET'`, `end_time`/`completed_at`(없으면 현재 시각), `updated_at`로 종료한 뒤 `stage_id` 변경. 완료/포기된 세션은 내용 그대로 `stage_id`만 변경 (진행 중 540초/보스 3체 세션이 정규 360초/보스 2체 검증에 걸리는 것을 방지) |
| `stage_bosses` | 정규 스테이지에 같은 `sequence` 또는 `boss_code`가 있으면 레거시 행 삭제, 나머지는 `stage_id` 변경 |
| `stage_rewards` | 정규 스테이지에 같은 `clear_type`이 있으면 레거시 행 삭제(정규 값 유지), 나머지는 `stage_id` 변경 |
| `player_stage_progress` | `(player_id, stage_id)` 충돌 시 정규 행에 병합 후 레거시 행 삭제. `clear_count` 합산, `highest_boss_sequence` 최대, `best_clear_time_ms`/`first_cleared_at`/`unlocked_at` 최소(NULL 무시), `updated_at` 최대. 충돌 없으면 `stage_id` 변경 |
| `player_records` | 충돌 시 병합. `total_clears` 합산, `best_kill_count` 최대, `best_clear_time_sec`/`first_cleared_at` 최소(NULL 무시), `last_cleared_at`/`updated_at` 최대. 충돌 없으면 `stage_id` 변경 |

마이그레이션 파일은 `BEGIN`/`COMMIT`을 포함하지 않는다. `postgres-migrate.ts`가 전체를 하나의 트랜잭션으로 감싸고 파일 **원본 바이트**의 SHA-256을 `game.schema_migrations`에 기록한다. 따라서:

- 적용 후 파일을 수정하면 `Applied migration changed` 오류가 난다.
- 줄바꿈은 **LF**여야 한다. Windows에서 `core.autocrlf=true`로 체크아웃해 CRLF가 되면 체크섬이 달라진다(`git config core.autocrlf false` 또는 `.gitattributes`로 확인 후 적용).

## 호환성 주의

`src/data/stages.ts`의 `LEGACY_STAGE_BOSS_CODES` 및 `src/shared/battle-session.ts`의 레거시 호환 로직은 **이 마이그레이션이 운영 DB에 적용되고 검증된 이후의 별도 PR에서만** 제거한다.

## 운영 적용 절차

### 0. 주의: 원격 Supabase에 `db:migrate:postgres`를 그대로 실행하지 않는다

`docs/CLOUDFLARE_DEPLOY.md`의 설명대로 `db:migrate:postgres`는 새 로컬 PostgreSQL용 실행기다. MCP로 초기 스키마를 이미 적용한 원격 프로젝트에는 `game.schema_migrations` 기준선이 없을 수 있고, 이 경우 실행기가 초기 SQL(`20261005083456_*`)부터 다시 실행해 이미 존재하는 객체에서 실패한다.

먼저 원격에서 기준선을 확인한다:

```sql
SELECT * FROM game.schema_migrations ORDER BY name;
```

- `20261005083456`, `…57`, `…58`이 모두 있으면 `npm run db:migrate:postgres`로 새 파일만 적용된다.
- 테이블이 없거나 일부만 있으면 실행기를 쓰지 말고, 새 마이그레이션 SQL만 Supabase SQL Editor/MCP에서 **단일 트랜잭션**(`BEGIN; <파일 내용>; INSERT INTO game.schema_migrations(name, checksum) ...; COMMIT;`)으로 실행한다. 체크섬은 로컬에서 `Get-FileHash -Algorithm SHA256 supabase/migrations/20261127000001_normalize_stage_ids.sql`로 구한다(소문자 hex로 기록).

### 1. 점검(쓰기 정지) 시간 확보 — 필수

마이그레이션의 `pg_advisory_xact_lock`은 마이그레이터끼리만 직렬화하며 애플리케이션 요청과 공유되지 않는다. Worker가 계속 쓰면 병합 도중 `player_stage_progress`/`battle_sessions`에 레거시 ID가 다시 쓰이거나 진행 중 세션이 종료 처리되는 경합이 생긴다.

1. Worker의 쓰기 트래픽(전투 시작/종료, 진행도 갱신)을 정지한다(점검 모드 배포 또는 라우트 차단).
2. 진행 중 요청이 빠지도록 잠시 대기한다.
3. DB 백업(Supabase 대시보드 또는 `pg_dump`)을 만든다.
4. 아래 마이그레이션/시드를 실행한다.
5. 사후 검증 통과 후 쓰기를 재개한다.

### 2. 적용

```powershell
$env:DATABASE_URL = "<postgres connection string>"
npm run db:migrate:postgres   # 새 마이그레이션 적용 (이미 적용되었으면 건너뜀)
npm run db:battle-seed        # 정규 콘텐츠 upsert
```

`db:battle-seed`는 정규 ID 기준으로 `stages`(전 컬럼)와 `stage_rewards`(`scrap_min`/`scrap_max`/`blueprint_drop_rate`)를 **upsert**한다. 이미 있는 `(stage_id, clear_type)` 보상은 건너뛰지 않고 값을 갱신한다. 마이그레이션 → 시드 순서를 지킨다.

### 3. 사후 검증 — 모든 `n`이 0이어야 한다

```sql
SELECT 'stages' AS tbl, count(*) AS n FROM game.stages
  WHERE id IN ('stage_02_canyon','stage_03_furnace','stage_04_fortress')
     OR entry_requirement ~ '(canyon|furnace|fortress)'
UNION ALL SELECT 'stage_bosses', count(*) FROM game.stage_bosses
  WHERE stage_id IN ('stage_02_canyon','stage_03_furnace','stage_04_fortress')
UNION ALL SELECT 'stage_rewards', count(*) FROM game.stage_rewards
  WHERE stage_id IN ('stage_02_canyon','stage_03_furnace','stage_04_fortress')
UNION ALL SELECT 'battle_sessions', count(*) FROM game.battle_sessions
  WHERE stage_id IN ('stage_02_canyon','stage_03_furnace','stage_04_fortress')
UNION ALL SELECT 'player_stage_progress', count(*) FROM game.player_stage_progress
  WHERE stage_id IN ('stage_02_canyon','stage_03_furnace','stage_04_fortress')
UNION ALL SELECT 'player_records', count(*) FROM game.player_records
  WHERE stage_id IN ('stage_02_canyon','stage_03_furnace','stage_04_fortress')
UNION ALL SELECT 'userid_keyed_progress', count(*) FROM game.player_stage_progress p
  JOIN game.player_profiles f ON f.user_id = p.player_id AND f.user_id <> f.player_id
UNION ALL SELECT 'userid_keyed_records', count(*) FROM game.player_records r
  JOIN game.player_profiles f ON f.user_id = r.player_id AND f.user_id <> f.player_id;
```

추가 확인:

```sql
SELECT id, entry_requirement, duration_seconds, boss_timings FROM game.stages ORDER BY sequence;
SELECT status, result_code, count(*) FROM game.battle_sessions WHERE result_code = 'STAGE_MIGRATION_RESET' GROUP BY 1, 2;
```

`stages`가 `stage_01_ruins` → `stage_02_factory` → `stage_03_lab` → `stage_04_core` 체인이고 `boss_timings` 길이가 각 스테이지 보스 수(1/2/2/3)와 같아야 한다.

## 롤백

데이터 병합(합산/삭제)과 세션 종료는 되돌릴 수 없다. 적용 전 백업에서 복원한다.

## 테스트

`src/__tests__/stage-migration.test.ts`(embedded-postgres, 실행 시마다 OS가 할당한 빈 포트)가 레거시/정규/userId 혼재 데이터로 마이그레이션을 두 번 적용하고 세션 종료, 메타데이터 동기화, 병합, 중복 제거, 인덱스를 검증한다. `npm run test:postgres`(포트 `55437`)와 포트가 겹치지 않는다.
