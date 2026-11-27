# 스테이지 ID 정규화 마이그레이션 런북

대상 파일: `supabase/migrations/20261127000001_normalize_stage_ids.sql`

## 변환 규칙

| 레거시 ID | 정규 ID |
|---|---|
| `stage_02_canyon` | `stage_02_factory` |
| `stage_03_furnace` | `stage_03_lab` |
| `stage_04_fortress` | `stage_04_core` |

`game` 스키마의 아래 테이블을 한 트랜잭션 안에서 정규화한다. 이미 정규화된 DB에서는 모든 문장이 0행에 매칭되어 아무 일도 하지 않는다(멱등).

| 테이블 | 처리 |
|---|---|
| `stages` | `entry_requirement` 내 레거시 ID를 먼저 치환(`clear_` 접두사 형태 포함). 정규 행이 없으면 `id`를 변경, 있으면 레거시 행 삭제 |
| `stage_bosses` | 정규 스테이지에 같은 `sequence` 또는 `boss_code`가 있으면 레거시 행 삭제, 나머지는 `stage_id` 변경 |
| `stage_rewards` | 정규 스테이지에 같은 `clear_type`이 있으면 레거시 행 삭제(정규 값 유지), 나머지는 `stage_id` 변경 |
| `battle_sessions` | `stage_id` 직접 변경 |
| `player_stage_progress` | `(player_id, stage_id)` 충돌 시 정규 행에 병합 후 레거시 행 삭제. `clear_count` 합산, `highest_boss_sequence` 최대, `best_clear_time_ms`/`first_cleared_at`/`unlocked_at` 최소(NULL 무시), `updated_at` 최대. 충돌 없으면 `stage_id` 변경 |
| `player_records` | `(player_id, stage_id)` 충돌 시 병합. `total_clears` 합산, `best_kill_count` 최대, `best_clear_time_sec`/`first_cleared_at` 최소(NULL 무시), `last_cleared_at`/`updated_at` 최대. 충돌 없으면 `stage_id` 변경 |

마이그레이션 파일은 `BEGIN`/`COMMIT`을 포함하지 않는다. `postgres-migrate.ts`가 전체를 하나의 트랜잭션으로 감싸고 SHA-256 체크섬을 `game.schema_migrations`에 기록하므로, **적용 후 이 파일을 수정하면 `Applied migration changed` 오류가 난다.**

## 호환성 주의

`src/data/stages.ts`의 `LEGACY_STAGE_BOSS_CODES` 및 `src/shared/battle-session.ts`의 레거시 호환 로직은 **이 마이그레이션이 운영 DB에 적용되고 검증된 이후의 별도 PR에서만** 제거한다. 앱 배포와 DB 마이그레이션 사이에 레거시 ID가 잠시 공존해도 무중단으로 동작하게 하기 위함이다.

## 실행 절차

사전(Pre): DB 백업(Supabase 대시보드 또는 `pg_dump`) 후, 아래 사후 검증 쿼리를 먼저 실행해 레거시 행 수를 기록한다.

적용:

```powershell
$env:DATABASE_URL = "<postgres connection string>"
npm run db:migrate:postgres   # 새 마이그레이션 적용 (이미 적용되었으면 건너뜀)
npm run db:battle-seed        # 정규 스테이지/보상 콘텐츠 upsert
```

마이그레이션 → 시드 순서를 지킨다. `db:battle-seed`는 정규 ID 기준으로 `stages`/`stage_rewards`를 upsert하므로, ID만 바뀐 행의 나머지 컬럼을 최신 콘텐츠로 맞춘다.

사후 검증(Post) — 모든 `n`이 0이어야 한다:

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
  WHERE stage_id IN ('stage_02_canyon','stage_03_furnace','stage_04_fortress');
```

추가 확인: `SELECT id, entry_requirement FROM game.stages ORDER BY sequence;` 결과가 `stage_01_ruins` → `stage_02_factory` → `stage_03_lab` → `stage_04_core` 체인이어야 한다.

## 롤백

데이터 병합(합산/삭제)은 되돌릴 수 없다. 적용 전 백업에서 복원한다.

## 테스트

`src/__tests__/stage-migration.test.ts`(embedded-postgres, 포트 `55439`)가 레거시/정규 혼재 데이터를 만들어 마이그레이션을 두 번 적용하고 병합 결과를 검증한다. `npm run test:postgres`(포트 `55437`)와 포트가 분리되어 있다.
