# 반드시 필요한 개선 항목 (Must-Have)

> 12개 분석, 26개 항목 중 포트폴리오 최소 기준 충족에 필수적인 것만

---

## C1. 에러 처리 체계화

| 이유 | 없으면 서버가 터질 때 HTML 에러 페이지가 그대로 노출됨 |
|------|------|

```typescript
// 1) app.onError - 모든 uncaught 예외 → JSON
// 2) app.notFound - 정의되지 않은 라우트 → JSON 404
// 3) POST /api/players body try-catch (JSON 파싱 실패 방어)
```

---

## C2. 입력값 검증

| 이유 | 현재 UUID 검증 없음 → `../secrets` 같은 path traversal 가능 |
|------|------|

```typescript
// 1) UUID regex 검증 on 모든 :id param
// 2) 닉네임 길이 2~20 + 문자셋 제한
```

---

## C3. 보안 기본

| 이유 | 아무나 모든 플레이어 조작 가능. CORS 없으면 악성 사이트에서 API 호출 가능 |
|------|------|

```typescript
// 1) CORS 미들웨어
// 2) secure-headers 미들웨어
// 3) API 키 인증 (플레이어 생성 시 키 발급 → 요청 시 검증)
```

---

## C4. DB 영속성

| 이유 | 서버 재시작 = 모든 데이터 소멸 → 게임 서버로서 의미 없음 |
|------|------|

```bash
# SQLite + Drizzle ORM
npm i drizzle-orm better-sqlite3
npm i -D drizzle-kit @types/better-sqlite3
```

---

## C5. 로깅

| 이유 | 에러 추적, 요청 디버깅 불가 → 운영 불가능 |
|------|------|

```typescript
// 1) Pino 로거
// 2) 요청 로깅 미들웨어 (method, path, status, duration)
```

---

## C6. Graceful Shutdown

| 이유 | Ctrl+C → 진행 중 요청 강제 종료 → 데이터 유실 |
|------|------|

```typescript
const server = serve({...}); // 인스턴스 저장 필수
process.on('SIGTERM', shutdown);
```

---

## C7. Health Check

| 이유 | 배포 환경에서 서버 생사 확인 불가 |
|------|------|

```typescript
app.get('/health', (c) => c.json({ status: 'ok' }));
```

---

## C8. GitHub Actions CI

| 이유 | PR 검증 없음 → 깨진 코드가 메인에 머지될 수 있음 |
|------|------|

```yaml
# .github/workflows/ci.yml
# type-check → test → build → audit
```

---

## C9. README 최소 완성

| 이유 | 이게 없으면 포트폴리오로서 첫인상 0점 |
|------|------|

```markdown
- 뱃지 (CI, license, node)
- 기능 목록
- 프로젝트 구조
- 환경변수 테이블
```

---

## 📊 요약

| 순서 | 항목 | 시간 | 누적 |
|:---:|------|:---:|:---:|
| C1 | 에러 처리 | 15m | 15m |
| C2 | 입력값 검증 | 30m | 45m |
| C3 | 보안 | 20m | 1h 5m |
| C4 | DB 영속성 | 40m | 1h 45m |
| C5 | 로깅 | 15m | 2h |
| C6 | Graceful Shutdown | 5m | 2h 5m |
| C7 | Health Check | 5m | 2h 10m |
| C8 | CI | 10m | 2h 20m |
| C9 | README | 15m | 2h 35m |

> **총 9개 항목, 약 2시간 35분**

---

## ❌ 의도적 제외 (있으면 좋지만 없어도 치명적이지 않음)

| 제외 항목 | 이유 |
|------|------|
| 테스트 보강 20개 | 현재 27개로 기본 커버리지 충분 |
| OpenAPI Scalar | README API 문서로 대체 가능 |
| ERD/아키텍처 문서 | Nice-to-have |
| Rate Limiting | API 키 인증으로 1차 방어 |
| ESLint/Prettier | tsconfig strict로 기본 타입 검증 |
| Docker | 배포는 포트폴리오 범위 밖 |
| 페이지네이션 | 플레이어 수 적어서 당장 문제 안 됨 |
