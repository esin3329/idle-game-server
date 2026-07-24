# 로깅 누락 분석

> 기준: 12-Factor App, 구조화 로깅 (Pino), 포트폴리오 수준

---

## 📊 현재 로깅 상태

```typescript
// 프로젝트 전체에서 유일한 로그 출력
console.log(`Server is running on http://localhost:${info.port}`); // index.ts:17

// 그 외 모든 이벤트: 침묵
// - 요청 없음
// - 에러 없음
// - 게임 이벤트 없음
// - 성능 지표 없음
```

| 항목 | 현재 |
|------|:---:|
| 요청 로깅 | ❌ |
| 에러 로깅 | ❌ |
| 게임 이벤트 로깅 | ❌ |
| 성능 메트릭 | ❌ |
| 구조화 로깅 (JSON) | ❌ |
| 로그 레벨 | ❌ |
| 로그 출력 대상 설정 | ❌ |
| 로깅 라이브러리 | ❌ (console.log만) |

---

## 🔴 Critical

### 1. 요청 로깅 전무

**현상**: 누가 어떤 엔드포인트를 호출했는지 전혀 알 수 없음

```
# 현재 서버는 완전한 블랙박스
누가 언제 API를 호출했는가? → 알 수 없음
어떤 요청이 실패했는가? → 알 수 없음
응답 시간은 얼마인가? → 알 수 없음
```

**필요**: Hono 미들웨어로 모든 요청 자동 로깅
```
[2026-07-24T14:30:00.000Z] INFO  POST /api/players 201 12ms
[2026-07-24T14:30:01.000Z] INFO  GET /api/rankings 200 3ms
[2026-07-24T14:30:02.000Z] WARN  POST /api/players/:id/battle 400 1ms - insufficient power
```

---

### 2. 에러 로깅 없음

**현상**: `updatePlayer` 실패, JSON 파싱 예외 등 모든 에러가 조용히 삼켜짐

```typescript
// routes.ts - 실제로는 실패했지만 아무도 모름
if (!updated) {
  return c.json({ error: '업데이트에 실패했습니다.' }, 500);
  // ← console.error(...) 없음. 운영자는 이 에러를 절대 알 수 없음
}
```

**필요**: 모든 500 응답 + 잡히지 않은 예외에 대해 로그 기록
```typescript
if (!updated) {
  console.error(`[CLAIM_FAILED] player=${id}`, { player, error: 'update returned undefined' });
  return c.json({ error: '업데이트에 실패했습니다.' }, 500);
}
```

---

### 3. console.log만 사용 (구조화 로깅 부재)

**문제**: `console.log`는 단순 문자열. 로그 수집/검색/필터링 불가

```typescript
// 현재
console.log('something happened');  // 검색 불가, 파싱 불가

// 필요 (구조화)
logger.info({ event: 'player_created', playerId: id, nickname });
// → JSON Lines, 로그 집계 시스템(ELK, Datadog)에서 필터링 가능
```

---

## 🟡 High

### 4. 게임 핵심 이벤트 추적 불가

**포트폴리오 필수**: 게임 경제 분석, 유저 행동 추적을 위한 이벤트 로그

| 이벤트 | 현재 | 로그에 남겨야 하는 정보 |
|------|:---:|------|
| 플레이어 생성 | ❌ | `playerId, nickname, timestamp` |
| 전기 수집(claim) | ❌ | `playerId, claimed, elapsed, newBalance` |
| 업그레이드 구매 | ❌ | `playerId, from, to, cost, newBalance` |
| 전투 실행 | ❌ | `playerId, won, reward, enemyName, enemyPower` |
| 랭킹 조회 | ❌ | `playerCount` |

---

### 5. 로그 레벨 구분 없음

```typescript
// console.log만으로는 구분 불가
console.log('서버 시작');     // INFO 여야 함
console.log('잘못된 요청');   // WARN 이어야 함  
console.log('DB 연결 실패');  // ERROR 여야 함
```

**필요**:
```typescript
logger.info('서버 시작');
logger.warn({ event: 'invalid_request', ... });
logger.error({ event: 'db_error', err });
logger.debug({ event: 'claim_calculation', ... }); // 개발용
```

---

### 6. 민감 정보 필터링 없음

**위험**: 실수로 `player` 객체 전체를 로깅하면 개인정보 노출 가능성

```typescript
// 위험
console.log('player created:', player); // 모든 필드 노출

// 안전
logger.info({ playerId, nickname }); // 필요한 것만
```

---

## 🟢 Medium

### 7. 프로덕션 vs 개발 로깅 분기 없음

```typescript
// 필요
if (process.env.NODE_ENV === 'development') {
  logger.level = 'debug';  // 상세 로그
} else {
  logger.level = 'info';   // 중요 로그만
}
```

### 8. 로그 출력 대상 설정 불가

- `stdout`만 존재 (기본 console.log)
- 파일 로그, 원격 로그 전송 불가
- `NODE_ENV=production` 에서 JSON 출력, development에서 pretty print 분기 없음

### 9. 요청 ID 추적 없음

```typescript
// 필요: 요청마다 고유 ID 부여 → 로그에서 하나의 요청 흐름 추적
// [req-abc123] POST /api/players/:id/claim
// [req-abc123] player found: uuid
// [req-abc123] claim completed: +120 electricity
```

### 10. 성능 로깅 없음

- 느린 쿼리 감지 불가
- 응답 시간 분포 추적 불가
- 메모리 누수 감지 불가

---

## 🔵 Low

| # | 항목 | 설명 |
|:---:|------|------|
| 11 | **로그 로테이션** | 파일 로그 사용 시 디스크 꽉 차는 것 방지 |
| 12 | **헬스체크 로깅** | `/health` 호출은 로그에서 제외 (노이즈) |
| 13 | **감사 로그** | 중요 작업(플레이어 삭제 등)은 별도 audit 로그 |
| 14 | **로그 레벨 동적 변경** | 재시작 없이 `SIGUSR1` 등으로 debug 모드 전환 |
| 15 | **로그 메트릭 대시보드** | Grafana / Prometheus 연동 |

---

## 📁 제안 구현 구조

```typescript
// src/shared/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined, // production: raw JSON
  redact: ['req.headers.authorization'],
});

// src/shared/middleware/request-logger.ts
import { logger } from '../logger.js';

app.use(async (c, next) => {
  const start = Date.now();
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);

  await next();

  logger.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    elapsedMs: Date.now() - start,
  });
});

// src/modules/players/player.routes.ts
import { logger } from '../../shared/logger.js';

routes.post('/api/players/:id/claim', (c) => {
  // ...
  logger.info({
    event: 'claim',
    playerId: id,
    claimed: produced,
    elapsed: elapsedSeconds,
    requestId: c.get('requestId'),
  });
  // ...
});
```

---

## 🎯 빠른 액션 (15분)

| 순서 | 작업 |
|:---:|------|
| 1 | **pino 설치** (`npm i pino`, `npm i -D pino-pretty`) |
| 2 | **`src/shared/logger.ts` 작성** (레벨, 포맷, redact 설정) |
| 3 | **요청 로깅 미들웨어** → method, path, status, duration |
| 4 | **requestId 미들웨어** → 요청별 추적 ID |
| 5 | **모든 500 에러 지점에 `logger.error` 추가** (routes.ts 3곳) |
| 6 | **게임 이벤트 로그 추가** (claim, upgrade, battle) |
| 7 | **NODE_ENV 분기** (dev: pretty, prod: JSON) |
