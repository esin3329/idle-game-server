# Graceful Shutdown 누락 분석

> 기준: 12-Factor App, Kubernetes best practice

---

## 📊 현재 상태

```typescript
// index.ts - 현재 종료 처리
serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
});
// ❌ serve() 반환값 무시 → 서버 종료 불가
// ❌ SIGTERM/SIGINT 핸들러 없음
// ❌ Ctrl+C → Hono 기본 강제 종료
```

---

## 🔴 Critical

### 1. 시그널 핸들러 없음

**현상**: `SIGTERM`, `SIGINT` 수신 시 즉시 강제 종료

```
docker stop → SIGTERM → 즉시 프로세스 kill
  → 진행 중이던 claim/battle 요청 데이터 유실
  → 클라이언트는 500 또는 connection reset
```

**필요**:
```typescript
const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`);
  isReady = false; // readiness probe → 503

  // 새 요청 거부 후 진행 중 요청 완료 대기
  await new Promise(r => setTimeout(r, 5000));

  await server.close();
  logger.info('Server closed');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

### 2. 서버 인스턴스 미참조

```typescript
// 현재
serve({ ... });
// → 반환된 Server 객체를 변수에 저장하지 않아 .close() 호출 불가

// 필요
const server = serve({ ... });
// → server.close()로 안전 종료 가능
```

---

### 3. 연결 드레이닝 없음

**현상**: 종료 시그널 직후 accept 중단 → 진행 중 요청도 중단

**필요**:
1. SIGTERM 수신
2. readiness → false (새 요청 거부 시작)
3. keep-alive 연결 닫기
4. 진행 중 요청 완료까지 대기 (최대 N초)
5. `server.close()` 호출
6. 프로세스 종료

---

## 🟡 High

### 4. 강제 종료 타임아웃 없음

**현상**: 진행 중 요청이 무한 대기 상태면 서버가 영원히 종료되지 않음

**필요**: 최대 대기 시간 후 강제 종료
```typescript
const FORCE_SHUTDOWN_TIMEOUT = 10_000; // 10초

setTimeout(() => {
  logger.error('Forced shutdown after timeout');
  process.exit(1);
}, FORCE_SHUTDOWN_TIMEOUT).unref(); // 정상 종료 시 타이머도 해제
```

---

### 5. 상태 저장 없음

**현상**: 현재 인메모리 Map이므로 종료 시 모든 데이터 유실 (DB 도입 전까지는 해당)

DB 도입 후: 종료 전 마지막 flush / WAL 체크포인트 필요

---

## 🟢 Medium

### 6. 종료 중 에러 처리

```typescript
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
  shutdown('unhandledRejection');
});
```

### 7. 종료 이벤트 로깅

현재: 종료 사실을 전혀 알 수 없음. 로그에 남지 않음.

---

## 🔵 Low

| # | 항목 | 설명 |
|:---:|------|------|
| 8 | **keep-alive timeout** | `server.keepAliveTimeout = 5000` → 종료 시 빠른 연결 해제 |
| 9 | **health check 연동** | `/ready`가 503을 반환하면 LB가 트래픽 우회 시작 |
| 10 | **Docker/docker-compose** | `stop_grace_period: 30s` 설정 |

---

## 📁 제안 전체 구현

```typescript
// src/index.ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import routes from './routes.js';

const app = new Hono();

app.get('/', (c) => c.text('Idle Game Server'));
app.get('/health', (c) => c.json({ status: 'ok' }));

let isReady = false;
app.get('/ready', (c) =>
  isReady ? c.json({ status: 'ready' }) : c.json({ status: 'shutting down' }, 503)
);

app.route('/', routes);

const server = serve({ fetch: app.fetch, port: 3000 }, (info) => {
  isReady = true;
  console.log(`Server running on http://localhost:${info.port}`);
});

const FORCE_TIMEOUT = 10_000;

const shutdown = async (signal: string) => {
  console.log(`${signal} received, draining connections...`);
  isReady = false;

  const forceExit = setTimeout(() => {
    console.error('Forced shutdown');
    process.exit(1);
  }, FORCE_TIMEOUT);

  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(forceExit);
    console.log('Server closed gracefully');
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## 🎯 빠른 액션 (5분)

| 순서 | 작업 |
|:---:|------|
| 1 | `const server = serve(...)` → 반환값 저장 |
| 2 | `SIGTERM`/`SIGINT` 핸들러 추가 |
| 3 | `/ready` 엔드포인트 + `isReady` 플래그 |
| 4 | 강제 종료 타임아웃 10초 |
