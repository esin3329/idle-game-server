# 에러 처리 누락 분석

> 기준: Hono 공식 패턴, 포트폴리오 수준

---

## 📊 현재 에러 처리 현황

```typescript
// 현재 코드베이스 전체 에러 처리 패턴
// 1. app.onError()    → ❌ 없음
// 2. app.notFound()   → ❌ 없음  
// 3. try-catch        → ❌ 단 한 번도 없음
// 4. Custom Error 클래스 → ❌ 없음
// 5. 에러 로깅          → ❌ 없음

// 유일한 "에러 처리":
if (!player)   return c.json({ error: '...' }, 404);  // 9회 반복
if (!updated)  return c.json({ error: '...' }, 500);  // 3회 반복
if (badInput)  return c.json({ error: '...' }, 400);  // 2회
```

---

## 🔴 Critical: 잡히지 않는 예외

### 1. JSON 파싱 예외 무방비

```typescript
// routes.ts:10
const body = await c.req.json<CreatePlayerRequest>();
// ❌ body가 "not json"이면 throw → Hono 기본 HTML 에러 페이지 노출
```

**PoC**:
```bash
curl -X POST /api/players -H "Content-Type: application/json" -d "broken"
# → <html>... 500 Internal Server Error ...</html>
```

**필요**: `try-catch` + JSON 400 응답 또는 전역 `onError` 미들웨어

---

### 2. 전역 예외 핸들러 부재

**문제**: 어떤 라우트에서도 `throw`가 발생하면 Hono 기본 핸들러가 HTML 응답을 반환.

```typescript
// 현재:
// throw new Error("boom") → 500 HTML 페이지

// 필요:
app.onError((err, c) => {
  console.error(err);
  return c.json({
    error: '서버 내부 오류가 발생했습니다.',
    code: 'INTERNAL_ERROR',
  }, 500);
});
```

---

### 3. 존재하지 않는 라우트 404 처리 없음

```typescript
// 현재: /api/nonexistent → Hono 기본 텍스트 응답
// 필요:
app.notFound((c) => {
  return c.json({ error: '요청하신 경로를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
});
```

---

## 🟡 High: 에러 응답 불일치

### 4. 응답 형식 제각각

| 엔드포인트 | 400 Body | 404 Body | 500 Body |
|------|------|------|------|
| `POST /api/players` | `{ error }` | - | - |
| `POST .../claim` | - | `{ error }` | `{ error }` |
| `POST .../upgrade` | `{ error, cost, current }` ⚠️ | `{ error }` | `{ error }` |
| `POST .../battle` | - | `{ error }` | `{ error }` |

> ⚠️ `POST .../upgrade` 400만 응답에 `cost`, `current` 필드가 추가됨 → **형식 불일치**

**필요**: 모든 에러 응답 통일
```typescript
interface ErrorResponse {
  error: string;
  code: string;     // ex: "PLAYER_NOT_FOUND"
  details?: unknown; // 추가 정보 (선택)
}
```

---

### 5. 에러 코드 부재

**현재**: 사람이 읽는 메시지만 있음.

```json
// 현재
{ "error": "플레이어를 찾을 수 없습니다." }
// → 클라이언트가 파싱해서 분기 처리 어려움

// 필요
{ "error": "플레이어를 찾을 수 없습니다.", "code": "PLAYER_NOT_FOUND" }
// → switch(code) 로 분기 가능
```

---

### 6. 커스텀 에러 클래스 없음

**현재**: 각 라우트에서 `c.json({ error: '...' }, status)` 하드코딩.

```typescript
// 현재 (9회 반복)
if (!player) return c.json({ error: '플레이어를 찾을 수 없습니다.' }, 404);

// 필요
class NotFoundError extends Error {
  code = 'NOT_FOUND';
  status = 404;
}
class InsufficientResourceError extends Error {
  code = 'INSUFFICIENT_RESOURCE';
  status = 400;
  constructor(resource: string, required: number, current: number) { ... }
}
```

---

## 🟢 Medium: 운영 측면

### 7. 에러 로깅 전무

- 어떤 에러가 발생했는지 기록되지 않음
- 디버깅 불가능
- 프로덕션 모니터링 불가

### 8. 스택 트레이스 노출 위험

- 전역 핸들러 없으면 `throw new Error(...)` 시 스택트레이스가 클라이언트에 노출됨
- `NODE_ENV=production` 분기 없음

### 9. 500 에러 메시지 과하게 추상적

```typescript
// 현재 (3회)
if (!updated) return c.json({ error: '업데이트에 실패했습니다.' }, 500);
// → "업데이트 실패"는 store 내부 버그일 가능성 높음 → 운영자는 디버깅 못 함
```

---

## 🔵 Low: HTTP 표준

| # | 누락 | 설명 |
|:---:|------|------|
| 10 | **405 Method Not Allowed** | `GET`만 있는 경로에 `POST` 요청 시 적절한 응답 없음 |
| 11 | **415 Unsupported Media Type** | `Content-Type: text/plain`으로 POST 시 |
| 12 | **429 Too Many Requests** | Rate Limit 없음 |
| 13 | **503 Service Unavailable** | 과부하/점검 모드 알림 채널 없음 |
| 14 | **Retry-After 헤더** | 429, 503 에서 언제 재시도 가능한지 |

---

## 📋 에러 코드 체계 (제안)

| Code | Status | 사용처 |
|------|:---:|------|
| `PLAYER_NOT_FOUND` | 404 | 존재하지 않는 플레이어 ID |
| `ROUTE_NOT_FOUND` | 404 | 정의되지 않은 경로 |
| `INVALID_INPUT` | 400 | 닉네임 검증 실패, 잘못된 UUID |
| `INVALID_JSON` | 400 | JSON 파싱 실패 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type 불일치 |
| `INSUFFICIENT_ELECTRICITY` | 400 | 업그레이드 전기 부족 |
| `INTERNAL_ERROR` | 500 | 예상치 못한 서버 오류 |
| `METHOD_NOT_ALLOWED` | 405 | 지원하지 않는 HTTP 메서드 |

---

## 🎯 빠른 액션 (30분)

| 순서 | 작업 | 영향 |
|:---:|------|:---:|
| 1 | **커스텀 에러 클래스 4종** (`AppError`, `NotFoundError`, `BadRequestError`, `InsufficientError`) | 재사용 기반 |
| 2 | **`app.onError` 전역 핸들러** | 잡히지 않은 모든 예외 → JSON |
| 3 | **`app.notFound` 핸들러** | 404 라우트 → JSON |
| 4 | **`POST /api/players` body try-catch** | JSON 파싱 예외 → 400 |
| 5 | **모든 에러 응답에 `code` 필드 추가** | 클라이언트 분기 가능 |
| 6 | **에러 로깅 (최소 console.error)** | 디버깅 가능 |
| 7 | **NODE_ENV 분기** (dev: stack, prod: sanitized) | 보안 |
