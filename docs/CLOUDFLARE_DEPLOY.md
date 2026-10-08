# Cloudflare + Supabase 전환

현재 Worker는 Hono 게임 API와 관리자 정적 자산을 함께 제공합니다. 기존 Node API 프록시 대신 PostgreSQL 저장소를 사용합니다. 운영 전환은 데이터 이전과 API 검증을 마친 뒤 수행합니다.

## 현재 상태 (2026-10-05)

- Supabase `hiactimawqbccldjtqxb` 복원 완료. `game_postgres` 스키마 마이그레이션 적용 완료.
- 업무 테이블 34개와 요청 제어 테이블 2개. game 스키마는 클라이언트 Data API 접근을 허용하지 않으며 RLS를 활성화했습니다.
- OpenClaw가 minipc의 실제 MySQL 데이터 백업·복원·변환을 수행했습니다.
- 원본 백업: `/home/user/backups/idle-game-migration/20261005T140221Z/`.
- 이전 대상: 원본 업무 데이터 157행. 원본 MySQL 마이그레이션 이력은 백업으로만 보존합니다.
- SQL 변환 리허설에서 34개 테이블 건수, 전기 잔액/원장 8096, bcrypt 해시 3개, UTC 시간 및 한글 보존을 확인했습니다.
- 계정·인증 데이터를 포함한 이전에 대한 사용자 승인 후 Supabase에 157행 적용 완료. 34개 테이블 건수, 잔액/원장 8096, 계정 bcrypt 3개, 역할/권한/매핑 6/16/28을 검증했습니다. 원본 서버는 계속 운영 중입니다.
- Cloudflare 로그인 갱신 후 게임 API와 관리자 페이지 배포 완료: https://idle-game-server.qlqlf2226.workers.dev (버전 5357be35-e838-4f3f-9145-3a7ba5ba799d).
- 관리자 직접 쿼리를 PostgreSQL로 전환했습니다. 실제 PostgreSQL 가입/로그인/동시 보상/관리자 지급/권한 회수 검증과 기존 테스트 216개가 통과했습니다. 원격 ready, 스테이지, 관리자 조회 API도 확인했습니다. Unity 주소 변경과 최종 데이터 동기화는 별도 운영 전환 단계입니다.

## 로컬 검증

```powershell
npm ci
npm ci --prefix admin
npm run type-check
npm run type-check:cloudflare
npm test
npm run test:postgres
npm run build:admin
npx wrangler deploy --dry-run --outdir .tools/worker-build
```

`test:postgres`는 .tools 아래에 독립 PostgreSQL 테스트 DB를 생성합니다. 스키마 재실행, RLS, 회원가입 데이터, 동시 중복 재화 지급과 트랜잭션 롤백을 실제 DB로 검증합니다. GitHub Actions의 PostgreSQL 작업도 이 스크립트를 실행합니다. Windows에서는 테스트 서버 종료에 대한 실행 권한이 필요할 수 있습니다. 기존 TODO 테스트는 이 스크립트가 검증하는 범위에 포함하지 않습니다.

## CI 경로

`.github/workflows/ci.yml`의 `postgres` 작업은 embedded PostgreSQL에서 스키마와 API 통합 확인을 실행합니다. `worker` 작업은 관리자 정적 자산을 빌드하고 `type-check:cloudflare`와 Wrangler dry-run으로 Worker 번들을 확인합니다. dry-run은 실제 Cloudflare 배포나 원격 DB 쓰기를 하지 않습니다.

게임·인증·운영 API의 정식 접두사는 `/api`입니다. Worker는 `/api/*`를 Hono로 보내고 그 외 경로는 관리자 정적 자산으로 처리합니다. 루트 `/health`, `/ready`, `/metrics`는 운영 상태 확인 경로입니다.

## 설정과 인증 전환

- DB_DRIVER=postgres. Hyperdrive 바인딩 또는 DATABASE_URL이 필요합니다.
- 데이터 이전 단계는 AUTH_PROVIDER=local로 기존 bcrypt 로그인 계약을 보존합니다. JWT_ACCESS_SECRET/JWT_REFRESH_SECRET을 서버 비밀 설정에 저장합니다.
- Supabase Auth는 계정 ID와 bcrypt 해시를 Auth Admin API로 이관·검증한 뒤 AUTH_PROVIDER=supabase로 활성화합니다. `db:import-auth`는 기본적으로 미리보기이며 실제 적용은 명시적 대상 주소와 --apply를 요구합니다.
- SUPABASE_URL 및 SUPABASE_PUBLISHABLE_KEY는 Auth 활성화에 필요합니다. SERVICE_ROLE_KEY는 계정 이관 전용 보호 환경에서만 사용하며 Unity/관리자 웹/저장소에 넣지 않습니다.
- Workers의 AI_RUNS_QUEUE는 idle-game-ai-runs 큐를 사용합니다. 매분 예약 작업이 대기 작업을 큐에 전달합니다.
- .dev.vars.example을 .dev.vars로 복사해 개발 비밀 설정을 채웁니다. 실제 값은 커밋하지 않습니다.
- 사용자 승인으로 game_runtime 전용 DB 계정을 생성해 Hyperdrive에 연결했습니다. game 스키마만 사용하며 DB 관리자 권한과 원장/감사 기록 수정·삭제 권한은 없습니다. Hyperdrive 캐시는 비활성화했고 SSL require로 암호화합니다. 실제 비밀 값은 .tools/runtime-secrets.json과 Cloudflare 비밀 설정에만 보관합니다.
- `db:migrate:postgres`는 새 로컬 PostgreSQL DB용 파일 마이그레이션 실행기입니다. MCP로 이미 초기 스키마를 적용한 원격 프로젝트에 같은 초기 SQL을 다시 실행하지 않습니다.

## 운영 전환 조건

데이터 이관 승인 후 보호된 변환 파일을 한 트랜잭션으로 실행하고 건수/잔액/원장/계정 관계를 검증합니다. 파일은 개인정보와 해시를 포함하므로 .tools 또는 서버 보호 백업 경로에서만 보관합니다.

원본은 현재 계속 쓰기가 가능하므로 이 스냅샷은 이전 리허설입니다. 실제 전환 시에는 쓰기를 잠시 정지하고 최신 백업/최종 동기화/로그인·재화·전투·운영 API 검증을 거쳐 주소를 바꿉니다. 원본 백업은 복구용으로 보존합니다. 기존 battle_sessions/mecha_stats에는 player_id에 userId를 담는 4개 행이 있으며, 임의로 바꾸지 않고 호환성을 확인합니다.

