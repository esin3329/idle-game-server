# 보안 기본 설정 누락 분석

> 기준: OWASP Top 10, 포트폴리오 최소 보안 수준

---

## 📊 현재 보안 상태

```
현재 적용된 보안 조치: 0개
```

| 항목 | 상태 | 위험도 |
|------|:---:|:---:|
| CORS 설정 | ❌ | 🔴 |
| 보안 헤더 (Helmet) | ❌ | 🔴 |
| 인증/인가 | ❌ | 🔴 |
| Rate Limiting | ❌ | 🔴 |
| XSS 방어 | ❌ | 🟡 |
| 요청 크기 제한 | ❌ | 🟡 |
| CSRF 방어 | ❌ | 🟡 |
| 의존성 취약점 감사 | ⚠️ | 🟢 |
| HTTPS 강제 | ❌ | 🟢 |
| `.env.example` | ❌ | 🟢 |

> ⚠️ `npm audit` 통과는 했으나 CI 파이프라인에 미연동

---

## 🔴 Critical

### 1. CORS 전무

**현상**: 어떤 오리진에서도 API 호출 가능. 악의적인 사이트에서 사용자 모르게 요청 가능.

```bash
# 현재: 모든 오리진에서 호출 허용 (또는 브라우저가 CORS 에러)
curl -H "Origin: https://evil.com" http://localhost:3000/api/players
# → 정상 응답
```

**필요**:
```typescript
import { cors } from 'hono/cors';

app.use('*', cors({
  origin: ['http://localhost:5173'], // 프론트엔드 주소만 허용
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));
```

---

### 2. 보안 헤더 없음

**현상**: 모든 HTTP 보안 헤더 누락

```bash
curl -I http://localhost:3000/api/players
# 누락된 헤더들:
# X-Content-Type-Options: nosniff       ← MIME 타입 스니핑 방지
# X-Frame-Options: DENY                  ← 클릭재킹 방지
# X-XSS-Protection: 0                    ← (구식이지만 명시적 비활성화)
# Content-Security-Policy: ...           ← XSS 방어의 핵심
# Strict-Transport-Security: ...         ← HTTPS 강제
# Referrer-Policy: strict-origin         ← 리퍼러 정보 누출 방지
# Permissions-Policy: ...                ← 브라우저 기능 제한
```

**필요**: Hono secure-headers 미들웨어
```typescript
import { secureHeaders } from 'hono/secure-headers';

app.use('*', secureHeaders());
// 기본값으로 위 헤더 모두 적용
```

---

### 3. 인증 전무 → 모든 플레이어 무방비

**현상**: 누구나 UUID만 알면 타인의 플레이어를 조작 가능

```
POST /api/players/other-player-uuid/claim   → 타인의 전기 수집 가능
POST /api/players/other-player-uuid/upgrade  → 타인의 전기 소모 가능
POST /api/players/other-player-uuid/battle   → 타인의 계정으로 전투 가능
```

**필요**: 최소한의 API 키 인증
```typescript
// 플레이어 생성 시 API 키 발급
const apiKey = crypto.randomUUID();
player.apiKey = apiKey;

// 요청 시 검증
const authHeader = c.req.header('Authorization');
if (!authHeader || authHeader !== `Bearer ${player.apiKey}`) {
  return c.json({ error: '인증이 필요합니다.' }, 401);
}
```

---

### 4. Rate Limiting 없음

**현상**: 무제한 요청 가능 → 자원 고갈, 게임 경제 파괴

```
while true; do
  curl -X POST /api/players/id/claim
  curl -X POST /api/players/id/battle
done
# → 무한 전기 생산 가능
```

**필요**:
```typescript
// claim: 1회/초
// battle: 1회/3초
// upgrade: 1회/초
// 그 외: 초당 100회
```

---

## 🟡 High

### 5. XSS 취약점 (닉네임)

**현상**: 닉네임에 HTML/JS 삽입 가능

```bash
curl -X POST /api/players \
  -H "Content-Type: application/json" \
  -d '{"nickname":"<script>alert(1)</script>"}'
# → 201 Created, 악성 닉네임 저장 성공
```

**필요**: 
- 서버: 입력 시 허용 문자셋 제한 (한글/영문/숫자만)
- 프론트엔드: 출력 시 HTML 이스케이프
- `Content-Security-Policy` 헤더로 defense-in-depth

---

### 6. 요청 Body 크기 제한 없음

**현상**: 대용량 body 전송으로 메모리 고갈 가능

```bash
dd if=/dev/zero bs=1M count=100 | curl -X POST /api/players -d @-
# → 100MB body → 메모리 부족으로 서버 다운 가능성
```

**필요**:
```typescript
// Hono body limit 미들웨어
app.use('*', bodyLimit({ maxSize: 50 * 1024 })); // 50KB
```

---

### 7. CSRF 방어 없음

**현상**: 모든 POST 엔드포인트가 CSRF 토큰 없이 동작

- `POST /api/players/:id/claim`
- `POST /api/players/:id/upgrade`
- `POST /api/players/:id/battle`

**필요**: SameSite 쿠키 + CSRF 토큰, 또는 `Authorization` 헤더 강제(API 키)

---

## 🟢 Medium

### 8. 의존성 취약점 지속 감사 없음

```bash
npm audit  # 수동 실행만 가능, CI 미연동
```

**필요**: GitHub Actions에서 PR마다 `npm audit --audit-level=high` 실행

### 9. `.env.example` 없음

환경변수가 무엇이 필요한지 문서화되지 않음.

```bash
# .env.example (필요)
PORT=3000
NODE_ENV=development
DATABASE_URL=file:./data.db
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
```

### 10. HTTPS 미적용

- 로컬 개발이지만 포트폴리오로서 프로덕션 배포 시 필요
- `NODE_ENV=production` 에서 HTTPS 리다이렉트

---

## 🔵 Low

| # | 항목 | 설명 |
|:---:|------|------|
| 11 | **에러 메시지 정보 노출** | 500 에러에 스택 트레이스 포함 가능성 |
| 12 | **HTTP 메서드 제한** | 필요한 GET/POST만 허용했는지 명시적 설정 없음 |
| 13 | **타이밍 어택** | UUID 비교 시 문자열 직접 비교 (타이밍 공격 가능) |
| 14 | **npm publish 방지** | `"private": true` package.json에 없음 |
| 15 | **Secrets in code** | 하드코딩된 비밀키는 없음 (다행) |

---

## 📁 제안 미들웨어 스택 (우선순위 순)

```typescript
// src/app.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';

const app = new Hono();

// 1. 보안 헤더 (가장 먼저)
app.use('*', secureHeaders());

// 2. CORS
app.use('*', cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
  allowMethods: ['GET', 'POST'],
}));

// 3. Body 크기 제한
app.use('*', bodyLimit({ maxSize: 50 * 1024 }));

// 4. Rate Limiting (hono-rate-limiter)

// 5. 요청 로깅

// 6. 인증 미들웨어 (player API 전용)

// 7. 라우트
```

---

## 🎯 빠른 액션 (20분)

| 순서 | 작업 | 효과 |
|:---:|------|:---:|
| 1 | **secure-headers 미들웨어** | XSS, 클릭재킹, MIME 스니핑 방어 |
| 2 | **CORS 미들웨어** | 허용된 오리진만 접근 |
| 3 | **bodyLimit 미들웨어** | 대용량 요청 차단 |
| 4 | **API 키 발급 + 인증 미들웨어** | 타인 계정 조작 방지 |
| 5 | **`.env.example` 작성** | 환경변수 문서화 |
| 6 | **`"private": true`** | 실수로 npm publish 방지 |
| 7 | **npm audit CI 스크립트** | `"audit": "npm audit --audit-level=high"` |
| 8 | **닉네임 문자셋 제한** | XSS 근본 차단 |
