# Health Check 누락 분석

> 기준: Kubernetes health probe, 포트폴리오 수준

---

## 📊 현재 상태

```
GET /health        → ❌ 없음 (404)
GET /healthz       → ❌ 없음 (404)
GET /ready         → ❌ 없음 (404)
GET /ping          → ❌ 없음 (404)
```

---

## 🔴 Critical

### 1. Liveness Probe 없음

**정의**: 서버 프로세스 자체가 살아있는지 확인하는 가장 기본적인 체크

**현상**: 로드밸런서/컨테이너 오케스트레이터가 서버 생사 확인 불가

```
필요: GET /health → 200 { status: "ok" }
```

### 2. Readiness Probe 없음

**정의**: 서버가 트래픽을 받을 준비가 되었는지 확인

**현상**: DB 연결이 안 된 상태에서도 요청 수락 → 500 연발

```
필요: GET /ready → 200 { status: "ready", db: "connected" }
                  → 503 { status: "not ready", db: "disconnected" }
```

---

## 🟡 High

### 3. 상세 헬스 정보 없음

| 정보 | 현재 | 필요 |
|------|:---:|:---:|
| 서버 상태 | ❌ | `ok` / `degraded` / `down` |
| 업타임 | ❌ | 서버 시작 후 경과 시간 |
| 버전 | ❌ | `package.json` 버전 |
| DB 연결 상태 | ❌ | `connected` / `disconnected` |
| 메모리 사용량 | ❌ | `process.memoryUsage()` |

**필요 응답 예시**:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "database": "connected",
    "memory": { "heapUsed": 45, "heapTotal": 120, "unit": "MB" }
  }
}
```

---

### 4. Graceful Shutdown 연동 부재

**현상**: `Ctrl+C` 시 즉시 종료 → 진행 중인 요청 유실

**필요**:
```typescript
// SIGTERM 감지 → readiness false → 진행 중 요청 완료 대기 → 종료
process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  ready = false; // readiness probe가 503 반환 시작
  await sleep(5000); // 진행 중 요청 완료 대기
  server.close();
  process.exit(0);
});
```

---

## 🟢 Medium

### 5. DB 마이그레이션 상태 노출 없음

SQLite 도입 시: 현재 적용된 마이그레이션 버전, pending 마이그레이션 수

```json
{
  "database": {
    "status": "connected",
    "migrations": { "applied": 3, "pending": 0 }
  }
}
```

### 6. 종속 서비스 헬스 체크 없음

Redis, 외부 API 등 추가 시 각각 체크 필요. 현재는 없음.

---

## 🔵 Low

| # | 항목 | 설명 |
|:---:|------|------|
| 7 | **/health 로그 제외** | 헬스체크 요청은 로그에서 필터링 (노이즈 방지) |
| 8 | **캐시 방지 헤더** | `Cache-Control: no-cache` → LB가 응답 캐시하지 않도록 |
| 9 | **경량 응답** | 불필요한 연산 없이 즉시 응답 (K8s probe는 1초 타임아웃) |

---

## 🎯 빠른 액션 (5분)

```typescript
// src/routes.ts 또는 app.ts에 바로 추가

// Liveness (경량)
app.get('/health', (c) => c.json({ status: 'ok' }));

// Readiness (DB 체크 포함)
app.get('/ready', (c) => {
  const dbOk = checkDatabase(); // DB 연결 확인
  if (!dbOk) return c.json({ status: 'not ready', db: 'disconnected' }, 503);
  return c.json({ status: 'ready', db: 'connected' });
});

// 상세 정보 (디버그용)
app.get('/status', (c) => c.json({
  status: 'ok',
  version: process.env.npm_package_version || '0.0.0',
  uptime: Math.floor(process.uptime()),
  memory: {
    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    unit: 'MB',
  },
}));
```
