# Idle Game Server

![CI](https://github.com/esin3329/idle-game-server/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Hono + TypeScript 기반 방치형(idle) 게임 서버 API

## 기능

- ⚡ **전기 생산** — 오프라인 상태에서도 자동 생산 (최대 8시간 적립)
- 🔼 **업그레이드** — 전기를 소모하여 초당 생산량 증가
- ⚔️ **전투** — 랜덤 적과 전투, 승리 시 전기 보상
- 🏆 **랭킹** — totalWealth 기준 실시간 순위
- 🎁 **방치 보상** — 오프라인 시간에 비례한 보상 지급

## 기술 스택

| 구분 | 기술 |
|------|------|
| Runtime | Node.js 20+ |
| Framework | Hono |
| Language | TypeScript (strict) |
| Validation | Zod |
| Logging | Pino |
| Persistence | JSON file |
| Test | Vitest |
| CI | GitHub Actions |

## 프로젝트 구조

```
src/
├── index.ts              # 서버 진입점 (미들웨어, 라우트 마운트)
├── routes.ts             # API 라우트
├── store.ts              # 데이터 저장소 (JSON 파일 기반)
├── types.ts              # 타입 정의
├── shared/
│   ├── errors.ts         # 커스텀 에러 클래스
│   ├── validator.ts      # Zod 검증 + UUID 미들웨어
│   ├── auth.ts           # API 키 인증 미들웨어
│   └── logger.ts         # Pino 로거
└── __tests__/
    ├── store.test.ts     # 저장소 테스트
    └── routes.test.ts    # API 테스트
```

## 실행

```bash
npm install
npm run dev          # 개발 서버 (핫 리로드)
npm run build        # 빌드
npm start            # 프로덕션 실행
```

서버는 `http://localhost:3000` 에서 실행됩니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|------|------|
| `PORT` | `3000` | 서버 포트 |
| `NODE_ENV` | `development` | 실행 환경 |
| `LOG_LEVEL` | `info` | 로그 레벨 (trace/debug/info/warn/error) |
| `CORS_ORIGIN` | `http://localhost:5173` | 허용할 CORS 오리진 (쉼표 구분) |

## API 문서

### 헬스 체크

```bash
GET /health   → {"status":"ok"}
GET /ready    → {"status":"ready","uptime":3600}
```

### 플레이어

#### 생성
```bash
curl -X POST http://localhost:3000/api/players \
  -H "Content-Type: application/json" \
  -d '{"nickname":"플레이어명"}'
```
→ `201` — 닉네임 2~20자, 한글/영문/숫자/공백/_- 허용

#### 조회
```bash
GET /api/players/:id        → 200 | 404
GET /api/players             → 200 (전체 목록)
```

### 전기 생산

```bash
# 수집 (인증 필요)
curl -X POST /api/players/:id/claim \
  -H "Authorization: Bearer <apiKey>"
→ {"player":{...},"claimed":120,"elapsedSeconds":120,"maxCapped":false}

# 대기량 조회
GET /api/players/:id/claim
→ {"pending":120,"elapsedSeconds":120,"maxCapped":false}

# 방치 보상
GET /api/players/:id/idle-rewards
→ {"offlineTime":"0h 2m 0s","pendingReward":120,...}
```

### 업그레이드

```bash
GET  /api/players/:id/upgrade     # 비용 조회
POST /api/players/:id/upgrade     # 구매 (인증 필요)
```
→ 비용 = `electricityPerSecond × 50`, 구매 시 +1 증가

### 전투

```bash
POST /api/players/:id/battle -H "Authorization: Bearer <apiKey>"
→ {"won":true,"reward":45,"enemyName":"고블린","enemyPower":8,"playerPower":10}
```

### 랭킹

```bash
GET /api/rankings    # totalWealth 기준 내림차순
```

### 에러 응답 형식

모든 에러는 다음 형식으로 통일됩니다:
```json
{ "error": "메시지", "code": "ERROR_CODE" }
```

| Status | Code | 설명 |
|:---:|------|------|
| 400 | `BAD_REQUEST` | 잘못된 입력 |
| 400 | `INVALID_JSON` | JSON 파싱 실패 |
| 400 | `INSUFFICIENT_RESOURCE` | 전기 부족 |
| 401 | `UNAUTHORIZED` | 인증 필요 |
| 403 | `FORBIDDEN` | 권한 없음 |
| 404 | `NOT_FOUND` | 리소스 없음 |
| 404 | `ROUTE_NOT_FOUND` | 정의되지 않은 경로 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 |

## 게임 흐름

1. `POST /api/players` → 플레이어 생성, `apiKey` 발급
2. 시간 경과 후 `POST /api/players/:id/claim` → 전기 수집
3. `POST /api/players/:id/upgrade` → 생산량 증가
4. `POST /api/players/:id/battle` → 전투로 추가 전리품
5. `GET /api/rankings` → 순위 확인

## 테스트

```bash
npm test              # 유닛 테스트 (27개)
npm run test:watch    # watch 모드
npm run type-check    # 타입 검사
```
