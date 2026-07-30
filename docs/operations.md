# 운영 문서 (Operations Guide)

> idle-game-server 운영에 필요한 절차와 설정을 설명합니다.

---

## 1. 아키텍처 개요

### 저장소 선택 (Provider 패턴)

`DB_DRIVER` 환경변수로 저장소를 선택합니다.

| DB_DRIVER | 저장소 | 용도 |
|-----------|--------|------|
| `json` | JSON 파일 | 개발/테스트, MySQL 불필요 |
| `mysql` (기본) | MySQL + Drizzle ORM | 프로덕션 |
| 미설정 | MySQL 시도 → 실패 시 JSON 폴백 | 개발 편의 |

### 데이터 파일 (JSON 모드)

| 파일 | 내용 | 백업 필요 |
|------|------|:---------:|
| `data.json` | 플레이어 | ✅ |
| `data-users.json` | 사용자 계정 | ✅ |
| `data-sessions.json` | Refresh 세션 | ✅ |
| `data-wallets.json` | 재화 지갑 | ✅ |
| `data-ledger.json` | 재화 원장 | ✅ |
| `data-parts.json` | 파츠 인벤토리 | ✅ |
| `data-configs.json` | 메카 구성 | ✅ |
| `data-research.json` | 연구 진행도 | ✅ |
| `data-blueprints.json` | 설계도 | ✅ |
| `data-crafts.json` | 제작 대기열 | ✅ |
| `data-item-ledger.json` | 아이템 원장 | ✅ |
| `data-battles.json` | 전투 세션 | ✅ |
| `data-battle-events.json` | 전투 이벤트 | ✅ |
| `data-battle-results.json` | 전투 결과 | ✅ |

> ⚠️ JSON 파일은 프로덕션에서 사용하지 마세요. MySQL을 사용하세요.

---

## 2. MySQL 운영

### 환경 변수

```bash
# .env 파일 예시
DB_HOST=mysql              # Docker Compose 내부: mysql
DB_PORT=3306
DB_USER=gameuser           # root 사용 금지
DB_PASSWORD=변경필수
DB_NAME=idle_game
MYSQL_ROOT_PASSWORD=변경필수
```

### 마이그레이션

```bash
# MySQL 실행 후 마이그레이션 적용
docker compose up -d mysql
npm run db:migrate

# 마이그레이션 파일 위치
src/db/migrations/
├── 0000_init.sql       # 계정/재화/인증
├── 0001_battle.sql     # 전투/스테이지
├── 0002_parts.sql      # 파츠 시스템
├── 0003_research.sql   # 연구 시스템
└── 0004_crafting.sql   # 설계도/제작
```

### 시드 데이터

```bash
# 개발용 시드 데이터 (더미 플레이어)
npm run db:seed

# 전투 스테이지 시드
npm run db:battle-seed

# 운영자 계정 생성
OPERATOR_EMAIL=admin@example.com OPERATOR_PASSWORD=secure123 npm run db:seed-operator

# JSON → MySQL 데이터 이관
npm run db:import-json
```

---

## 3. 백업 (Backup)

### MySQL 백업

`scripts/backup.sh` — `mysqldump` 기반 증분/전체 백업

```bash
# 기본 백업 (./backups/ 디렉토리)
./scripts/backup.sh

# 특정 디렉토리 지정
./scripts/backup.sh -o /data/backups

# Docker Compose 환경에서 외부 접속
DB_HOST=127.0.0.1 DB_PASSWORD=변경필수 ./scripts/backup.sh
```

**백업 특징:**
- `--single-transaction` (InnoDB, 쓰기 차단 없음)
- 30일 보관 (오래된 파일 자동 삭제)
- UTC timestamp 파일명 (`idle_game_2026-07-30_120000.sql.gz`)
- `.tmp` → `rename` 원자적 저장
- `chmod 600` (비밀값 보호)
- gzip 압축

### JSON 모드 백업

JSON 모드에서는 모든 data-*.json 파일을 주기적으로 백업합니다:

```bash
# JSON 데이터 파일 백업
tar czf backup-$(date +%Y%m%d).tar.gz data-*.json

# 복구
tar xzf backup-20260730.tar.gz
```

### cron 자동화

```bash
# 매일 02:00 UTC에 백업
0 2 * * * cd /app && DB_PASSWORD=변경필수 ./scripts/backup.sh

# 로그 확인
tail -f logs/backup.log
```

---

## 4. 복구 (Recovery)

### 복구 절차

```bash
# 1. dry-run 검증
./scripts/recover.sh --dry-run latest

# 2. 검증용 DB로 복구
./scripts/recover.sh latest

# 3. 복구 전 체크리스트
#    □ 최신 백업 존재 확인
#    □ --dry-run 검증 완료
#    □ docker compose stop app (쓰기 차단)
#    □ 복구 대상 DB 백업
#    □ integrity-check.sh 실행
#    □ 복구 실행
#    □ integrity-check.sh 재실행
#    □ docker compose start app
#    □ /health/ready 확인
#    □ 핵심 API smoke test
```

### 무결성 검증

```bash
# 복구 전후 데이터 무결성 확인
./scripts/integrity-check.sh

# 복구 검증 (레코드 수 비교)
./scripts/validate-recovery.sh

# 수동 검증
mysql -e "SELECT COUNT(*) FROM players; SELECT COUNT(*) FROM currency_ledger;"
curl http://localhost:3000/health/ready
```

### 안전한 종료와 재시작

```bash
# Graceful shutdown (SIGTERM)
docker compose stop app   # 진행 중 요청 완료 후 종료 (10s timeout)

# 재시작
docker compose start app  # DB 연결 복구

# 전체 재시작
docker compose restart
```

---

## 5. 모니터링

### 헬스 체크

```bash
# 기본 상태
GET /health
→ { "status": "ok", "uptime": 3600, "memory": {...}, "nodeVersion": "v20", "environment": "production" }

# 라이브니스 (Liveness)
GET /health/live
→ { "status": "ok", "uptime": 3600 }

# 레디니스 (Readiness)
GET /ready
→ { "status": "ready", "uptime": 3600, "inFlightRequests": 0, "checks": { "database": "connected" } }

# Docker HEALTHCHECK (30초 간격)
docker inspect --format='{{json .State.Health}}' idle-game-server
```

### 메트릭

```bash
GET /metrics
→ {
    "requests": { "total": 1000 },
    "errors": { "total": 5, "rate": "0.50%" },
    "statusCodes": { "2xx": 990, "4xx": 5, "5xx": 0 },
    "responseTime": {
      "histogram": { "duration_le_10": 100, "duration_le_50": 500, ... },
      "buckets": [10, 50, 100, 200, 500, 1000, 3000, 10000]
    },
    "topPaths": { "/api/players": 200, "/parts": 150, ... },
    "timestamp": "2026-07-30T12:00:00Z"
  }
```

### Docker HEALTHCHECK 설정

Dockerfile에 내장된 HEALTHCHECK:
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1
```

---

## 6. 로깅

### 구조화 로그 (Pino)

모든 로그는 JSON 형식으로 stdout에 출력됩니다.

```json
{
  "level": 30,          // 30=info, 40=warn, 50=error
  "time": 1700000000000,
  "msg": "Server running on http://localhost:3000",
  "requestId": "abc-123",
  "method": "POST",
  "path": "/api/players/:id/claim",
  "status": 200,
  "durationMs": 15,
  "environment": "production"
}
```

### 로그 레벨

| 환경 | LOG_LEVEL | 출력 |
|------|-----------|------|
| production | `info` (기본) | info, warn, error, fatal |
| development | `info` | + pino-pretty 컬러 포맷 |
| debug | `debug` | + 디버그 메시지 |

### 로그 보안 (Redact)

민감 정보는 자동 마스킹:
- `req.headers.authorization`
- `password`, `passwordHash`
- `token`, `accessToken`, `refreshToken`
- `apiKey`, `secret`

### 감사 로그

운영자 행위는 별도 audit 로그로 기록:
```bash
# 운영자 로그인 감사
docker logs idle-game-server 2>&1 | grep '"category":"audit"'
```

---

## 7. 문제 해결

### 서버가 시작되지 않음

```bash
# 포트 충돌 확인
lsof -i :3000

# 환경변수 확인
grep -v '^#' .env | grep -v '^$'

# MySQL 연결 확인
docker compose exec mysql mysqladmin ping -h localhost

# 로그 확인
docker compose logs app
```

### MySQL 연결 오류

```bash
# MySQL 컨테이너 상태 확인
docker compose ps mysql

# MySQL 로그 확인
docker compose logs mysql

# 연결 테스트
mysql -h 127.0.0.1 -u gameuser -p -e "SELECT 1"

# 타임아웃 확인 (provider 2초)
# → MySQL 미연결 시 자동 JSON 폴백
```

### 느린 응답

```bash
# 메트릭 확인
curl http://localhost:3000/metrics | jq '.responseTime'

# Top Paths 확인
curl http://localhost:3000/metrics | jq '.topPaths'

# in-flight 요청 확인
curl http://localhost:3000/ready | jq '.inFlightRequests'
```

### 데이터 불일치

```bash
# 무결성 검증
./scripts/integrity-check.sh

# players 테이블 vs wallet_balances 불일치 확인
mysql -e "
  SELECT p.id, p.electricity AS player_elec, w.electricity AS wallet_elec
  FROM players p JOIN wallet_balances w ON p.id = w.player_id
  WHERE p.electricity != w.electricity;
"
```

---

## 8. Docker Compose 운영

```bash
# 전체 시작
docker compose up -d

# 특정 서비스만
docker compose up -d mysql
docker compose up -d app

# 로그 확인
docker compose logs -f app
docker compose logs -f mysql

# 상태 확인
docker compose ps

# 중지 (데이터 유지)
docker compose stop

# 완전 제거 (데이터 삭제)
docker compose down -v
```

### Dockerfile 멀티스테이지 빌드

```dockerfile
# Build stage: ts → js
FROM node:20-alpine AS build
ARG PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json src/ ./src/
RUN npm run build

# Runtime stage: 최소 이미지
FROM node:20-alpine
ARG PORT=3000
ENV PORT=$PORT NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ ./dist/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1
CMD ["node", "dist/index.js"]
```

---

## 9. 운영 체크리스트

### 최초 배포

- [ ] `.env` 파일 생성 (DB_PASSWORD, JWT_SECRET 변경)
- [ ] `validateProductionSecrets()` 통과 확인
- [ ] `docker compose up -d mysql`
- [ ] `npm run db:migrate`
- [ ] `npm run db:seed-operator` (최초 운영자 생성)
- [ ] `docker compose up -d app`
- [ ] `GET /health` → 200
- [ ] `GET /ready` → ready
- [ ] `POST /auth/register` → 201
- [ ] `POST /auth/login` → 200

### 일일 점검

- [ ] `GET /health` 메모리 사용량 확인
- [ ] `GET /metrics` 오류율 확인 (< 1%)
- [ ] `docker compose ps` 컨테이너 상태 확인
- [ ] 디스크 사용량 확인 (`df -h`)

### 주간 점검

- [ ] 백업 확인 (`ls -la backups/`)
- [ ] `dry-run` 복구 검증
- [ ] 로그 확인 (`docker compose logs --tail=100 app`)
- [ ] 느린 쿼리 로그 확인

---


---

## 10. 성능 기준 (Benchmark)

자세한 성능 측정 결과는 **[benchmark.md](./benchmark.md)** 를 참고하세요.

| 엔드포인트 | RPS (10 conn) | P50 | 오류율 |
|-----------|:-----------:|:---:|:-----:|
| `GET /health` | ~400 | < 1ms | 0% |
| `GET /parts` | ~400 | 2~6ms | 0% |
| `GET /stages` | ~470 | 2~5ms | 0% |
| `POST /api/players` | ~300 | 5~15ms | 0% |
| `POST /auth/register` | ~240 | 50~120ms | 0% |

> Redis, Worker Thread, Cluster 모드는 현재 도입되지 않았습니다.
> 필요성이 측정된 경우에만 추후 도입 예정입니다.
