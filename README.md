# Idle Game Server

[![CI](https://github.com/<user>/idle-game-server/actions/workflows/ci.yml/badge.svg)](https://github.com/<user>/idle-game-server/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Hono + TypeScript 기반 방치형(idle) 게임 서버입니다. 시간이 지남에 따라 자동으로 자원(전기)이 쌓이고, 모은 자원으로 업그레이드와 전투를 진행할 수 있습니다.

## 기능

- ⚡ **방치형 자원 생산** — 오프라인 상태에서도 전기가 자동 생산 (최대 8시간)
- ⬆️ **업그레이드 시스템** — 전기를 소모하여 초당 생산량 증가
- ⚔️ **전투 시스템** — 랜덤 적과 전투하여 추가 전리품 획득
- 🏆 **랭킹 시스템** — 총 자산 기준 실시간 순위 경쟁
- 🛡️ **입력값 검증** — Zod 기반 스키마 검증
- 📝 **구조적 로깅** — Pino 로거로 모든 요청/게임 이벤트 기록
- 🔄 **Graceful Shutdown** — 안전한 서버 종료
- ✅ **Health Check** — `/health`, `/ready` 엔드포인트

## 기술 스택

| 구분 | 기술 |
|------|------|
| **Runtime** | Node.js 20+ |
| **Framework** | Hono 4 |
| **Language** | TypeScript 5 |
| **Validation** | Zod |
| **Logging** | Pino |
| **Test** | Vitest |
| **CI** | GitHub Actions |

## 프로젝트 구조

```
idle-game-server/
├── .github/
│   └── workflows/
│       └── ci.yml              # CI 파이프라인
├── src/
│   ├── __tests__/
│   │   ├── routes.test.ts      # API 통합 테스트
│   │   └── store.test.ts       # 저장소 단위 테스트
│   ├── shared/
│   │   ├── errors.ts           # 커스텀 에러 클래스
│   │   └── validator.ts        # Zod 검증 미들웨어
│   ├── index.ts                # 서버 엔트리포인트
│   ├── logger.ts               # Pino 로거 설정
│   ├── routes.ts               # API 라우트 정의
│   ├── store.ts                # 인메모리 데이터 저장소
│   └── types.ts                # TypeScript 타입 정의
├── package.json
├── tsconfig.json
└── README.md
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|:---:|------|
| `PORT` | `3000` | 서버 포트 |
| `LOG_LEVEL` | `info` | 로그 레벨 (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | — | `production` 설정 시 에러 메시지 간소화 |

## 실행

```bash
npm install
npm run dev        # 개발 서버 (핫 리로드)
npm run build      # 빌드
npm start          # 프로덕션 실행
npm test           # 테스트
```

서버는 `http://localhost:3000` 에서 실행됩니다.

---

## API 문서

### 플레이어

#### 플레이어 생성
```
POST /api/players
```
**Body:**
```json
{ "nickname": "플레이어명" }
```
**Response:** `201 Created`
```json
{
  "id": "uuid",
  "nickname": "플레이어명",
  "electricity": 0,
  "electricityPerSecond": 1,
  "lastClaimedAt": "2026-01-01T00:00:00.000Z",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

#### 플레이어 목록 조회
```
GET /api/players
```
**Response:** `200 OK` - 플레이어 배열

#### 플레이어 단일 조회
```
GET /api/players/:id
```
**Response:** `200 OK` | `404 Not Found`

---

### 전기 생산

#### 전기 수집 (Claim)
마지막 수집 이후 경과 시간에 비례하여 전기를 획득합니다. 최대 8시간까지 적립됩니다.
```
POST /api/players/:id/claim
```
**Response:** `200 OK`
```json
{
  "player": { ... },
  "claimed": 120,
  "elapsedSeconds": 120,
  "maxCapped": false
}
```

#### 수집 대기량 조회
전기를 수집하지 않고 예상 획득량만 확인합니다.
```
GET /api/players/:id/claim
```
**Response:**
```json
{
  "pending": 120,
  "elapsedSeconds": 120,
  "maxCapped": false,
  "electricityPerSecond": 1
}
```

#### 방치 보상 조회
오프라인 시간과 예상 보상을 읽기 쉬운 형태로 확인합니다.
```
GET /api/players/:id/idle-rewards
```
**Response:**
```json
{
  "offlineTime": "0h 2m 0s",
  "pendingReward": 120,
  "electricityPerSecond": 1,
  "maxCapped": false,
  "maxIdleHours": 8
}
```

---

### 업그레이드

#### 업그레이드 정보 조회
```
GET /api/players/:id/upgrade
```
**Response:**
```json
{
  "currentElectricityPerSecond": 1,
  "nextElectricityPerSecond": 2,
  "cost": 50,
  "canAfford": false
}
```

#### 업그레이드 구매
전기를 소모하여 초당 생산량을 1 증가시킵니다. 비용 = `electricityPerSecond × 50`
```
POST /api/players/:id/upgrade
```
**Response:** `200 OK`
```json
{
  "player": { ... },
  "cost": 50,
  "newElectricityPerSecond": 2
}
```
**오류:** `400 Bad Request` - 전기 부족 시

---

### 전투

#### 전투 실행
플레이어 전투력(`electricityPerSecond × 10`) 기준으로 랜덤 적과 전투합니다.
승리 시 전기 보상을 획득합니다.
```
POST /api/players/:id/battle
```
**Response:** `200 OK`
```json
{
  "player": { ... },
  "won": true,
  "reward": 45,
  "enemyName": "고블린",
  "enemyPower": 8,
  "playerPower": 10
}
```

---

### 랭킹

#### 전체 랭킹 조회
`totalWealth`(보유 전기 + 미수집 생산량) 기준 내림차순 정렬.
```
GET /api/rankings
```
**Response:**
```json
[
  {
    "id": "uuid",
    "nickname": "1등",
    "electricity": 5000,
    "electricityPerSecond": 10,
    "totalWealth": 5200
  }
]
```

---

## 게임 흐름

1. `POST /api/players` 로 플레이어 생성
2. 시간이 지나면 `POST /api/players/:id/claim` 으로 전기 수집
3. 모은 전기로 `POST /api/players/:id/upgrade` 하여 생산량 증가
4. `POST /api/players/:id/battle` 로 추가 전리품 획득
5. `GET /api/rankings` 으로 순위 경쟁
