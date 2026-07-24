# 입력값 검증 누락 분석

> 기준: OWASP 입력 검증, 포트폴리오 수준

---

## 📊 전체 엔드포인트 × 검증 항목 매트릭스

| 엔드포인트 | Body | Param | Content-Type | 길이 | 형식 | 범위 | 중복 | 속도 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `POST /api/players` | ⚠️ | - | ❌ | ❌ | ⚠️ | - | ❌ | ❌ |
| `GET /api/players/:id` | - | ❌ | - | - | ❌ | - | - | ❌ |
| `GET /api/players` | - | - | - | - | - | - | - | ❌ |
| `POST .../claim` | - | ❌ | - | - | ❌ | - | - | ❌ |
| `GET .../claim` | - | ❌ | - | - | ❌ | - | - | - |
| `GET .../idle-rewards` | - | ❌ | - | - | ❌ | - | - | - |
| `GET .../upgrade` | - | ❌ | - | - | ❌ | - | - | - |
| `POST .../upgrade` | - | ❌ | - | - | ❌ | - | - | ❌ |
| `POST .../battle` | - | ❌ | - | - | ❌ | - | - | ❌ |
| `GET /api/rankings` | - | - | - | - | - | - | - | ❌ |

> ✅=검증됨, ⚠️=부분 검증, ❌=미검증, -=해당 없음

---

## 🔴 Critical 누락

### 1. Path Parameter UUID 형식 미검증 (9개 엔드포인트)

**문제**: 모든 `:id` 파라미터가 문자열 그대로 store에 전달됨. UUID가 아닌 값도 통과.

```typescript
// 현재
const id = c.req.param('id'); // "hello", "../../etc", "1 OR 1=1" 모두 통과
```

**영향**: 
- `GET /api/players/../secrets` → path traversal 가능성
- `GET /api/players/'; DROP TABLE--` → DB 도입 시 SQL injection
- 스토어에 불필요한 키 누적

**필요 조치**:
```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_REGEX.test(id)) {
  return c.json({ error: '잘못된 플레이어 ID 형식입니다.' }, 400);
}
```

---

### 2. 닉네임 검증 부족 (`POST /api/players`)

| 검증 항목 | 현재 | 누락 위험 |
|------|:---:|------|
| 빈 문자열 | ✅ | - |
| 타입 (string) | ✅ | - |
| 최대 길이 제한 | ❌ | 1MB 닉네임 → 메모리 고갈 |
| 최소 길이 | ❌ | 공백만 trim → 통과? (현재는 400) |
| 특수문자 필터 | ❌ | `<script>`, `\n`, emoji flood |
| 허용 문자셋 | ❌ | 제어 문자, RTL override 등 |
| 중복 닉네임 | ❌ | 동일 닉네임 무제한 생성 |
| 선행/후행 공백 | ⚠️ | trim만 하고 원본 검증은 안 함 |

**필요 조치**:
```typescript
const nicknameSchema = z.string()
  .min(2, '닉네임은 2자 이상이어야 합니다.')
  .max(20, '닉네임은 20자 이하여야 합니다.')
  .regex(/^[a-zA-Z0-9가-힣 _-]+$/, '허용되지 않는 문자가 포함되어 있습니다.')
  .transform(s => s.trim());
```

---

### 3. JSON Body 파싱 에러 미처리 (`POST /api/players`)

**문제**: `c.req.json()` 이 파싱에 실패하면 Hono 기본 에러로 HTML 응답이 나갈 수 있음.

```bash
curl -X POST /api/players -H "Content-Type: application/json" -d "not json"
# → 예측 불가 응답
```

**필요 조치**:
- try-catch로 감싸서 400 JSON 응답
- 또는 Hono `onError` 미들웨어로 전역 처리

---

### 4. Content-Type 검증 없음 (`POST /api/players`)

**문제**: `Content-Type: text/plain` 으로도 요청 수락. Hono `c.req.json()` 이 자동 파싱 시도하지만 명시적 검증이 없음.

---

## 🟡 High 누락

### 5. 추가 필드 무방비 허용 (`POST /api/players`)

**문제**: 요청 body에 정의되지 않은 필드가 들어와도 무시하고 통과.

```json
{ "nickname": "test", "electricity": 9999999, "isAdmin": true }
// → 정상 생성됨, 추가 필드는 무시됨
```

**필요 조치**: Zod `strip()` 또는 `strict()` 로 추가 필드 거부.

### 6. 수치형 오버플로우 검증 없음

**현재 상태**: `electricity`, `electricityPerSecond` 에 상한 없음.

| 시나리오 | 위험 |
|------|------|
| 1년 방치 후 claim | `Number.MAX_SAFE_INTEGER` 초과 가능 |
| 업그레이드 무한 반복 | `electricityPerSecond` 무제한 증가 |
| 전투 보상 누적 | `electricity` 오버플로우 |

**필요 조치**:
```typescript
const MAX_SAFE_ELECTRICITY = Number.MAX_SAFE_INTEGER;
const MAX_ELECTRICITY_PER_SECOND = 1000;
```

### 7. ID 검증 로직 9번 중복

**현재**: 모든 라우트 핸들러에서 `if (!player)` 패턴 수동 반복.

```typescript
// 9군데 동일 패턴
const id = c.req.param('id');
const player = getPlayer(id);
if (!player) { return c.json({ error: '...' }, 404); }
```

**필요 조치**: Hono middleware로 추출
```typescript
const playerGuard = async (c: Context, next: Next) => {
  const id = c.req.param('id');
  if (!UUID_REGEX.test(id)) return c.json({ error: '잘못된 ID' }, 400);
  const player = getPlayer(id);
  if (!player) return c.json({ error: '플레이어 없음' }, 404);
  c.set('player', player);
  await next();
};
```

---

## 🟢 Medium 누락

### 8. 요청 Body 크기 제한 없음

`POST /api/players` 에서 대용량 body 전송 시 메모리 고갈 가능.

### 9. HTTP Method Override 미방어

`X-HTTP-Method-Override` 헤더로 GET→POST 변조 가능성.

### 10. Negative 값 공격

`electricity` 에 음수를 직접 주입할 순 없지만, 업그레이드 비용 계산 결과가 음수가 될 수 있는지 검증 안 함.

### 11. `lastClaimedAt` 미래 시간

DB 직렬화 시 `lastClaimedAt` 에 미래 시간을 넣으면 음수 elapsedSeconds 발생 가능 (코드에서는 `Math.max(0, ...)` 로 방어됨 → OK)

---

## 🔵 Low / 포트폴리오 가산점

| # | 항목 | 설명 |
|:---:|------|------|
| 12 | **Zod 도입** | 현재 모든 검증이 if문 수동 → 라이브러리로 선언적 검증 |
| 13 | **검증 미들웨어 패턴** | `validate('json', schema)` → 재사용 가능 |
| 14 | **에러 메시지 i18n** | 검증 에러 한글/영문 지원 |
| 15 | **입력값 로깅** | 검증 실패 시 요청 IP + body 로깅 |
| 16 | **Rate Limiting** | claim/battle/upgrade 연속 요청 제한 |
| 17 | **Sanitization** | HTML 엔티티 이스케이프 (닉네임 출력 시) |

---

## 📈 종합

| 구분 | 현재 | 문제점 |
|------|:---:|------|
| 검증 항목 수 | 1/17 | 닉네임 비어있음만 검사 |
| Path param 검증 | 0/9 | UUID 형식 미검증 |
| Body 검증 | 부분 | 길이/문자셋/중복/XSS 방치 |
| 자동화 수준 | 수동 | if문 9개 중복 |

---

## 🎯 빠른 액션 (30분)

| 순서 | 작업 | 효과 |
|:---:|------|:---:|
| 1 | **Zod 설치 + playerGuard 미들웨어** | UUID 검증 + 404 처리 일괄화, 9개 라우트 간소화 |
| 2 | **닉네임 Zod 스키마** | 길이 2~20, 한글/영문/숫자만, XSS 방지 |
| 3 | **Body 파싱 try-catch** | 잘못된 JSON → 400 |
| 4 | **Content-Type 검증** | `application/json` 강제 |
| 5 | **수치 상한 추가** | `MAX_ELECTRICITY_PER_SECOND = 1000` |
