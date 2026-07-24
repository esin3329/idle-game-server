# 있으면 좋은 개선 항목 (Nice-to-Have)

> Must-Have 9개 이후에 시간이 남으면 진행

---

## 1. 테스트 보강

| 현재 27개 → 47개로 | 30분 |
|------|:---:|

- 404 케이스 4개 추가
- 닉네임 검증 테스트 (길이, 특수문자)
- claim max cap 테스트
- GET /api/players/:id 200 성공 케이스

---

## 2. OpenAPI 인터랙티브 문서

| Scalar UI로 `/docs` 제공 | 20분 |
|------|:---:|

```bash
npm i @hono/zod-openapi @scalar/hono-api-reference
```
```
GET /docs → 브라우저에서 바로 API 호출 가능한 문서
```

---

## 3. Rate Limiting

| claim/battle/upgrade 스팸 방지 | 10분 |
|------|:---:|

```typescript
// claim: 1회/초, battle: 1회/3초, upgrade: 1회/초
import { rateLimiter } from 'hono-rate-limiter';
```

---

## 4. ESLint + Prettier

| 코드 품질 일관성 | 10분 |
|------|:---:|

```bash
npm i -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

---

## 5. Docker

| 컨테이너화로 배포 준비 | 10분 |
|------|:---:|

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

---

## 6. ERD 및 아키텍처 문서

| Mermaid 다이어그램 추가 | 15분 |
|------|:---:|

- Player ERD
- 시스템 아키텍처 다이어그램
- Claim 시퀀스 다이어그램

---

## 7. 배틀 시스템 버그 수정

| 분산 계산 오류 수정 | 5분 |
|------|:---:|

```typescript
// 현재: ±0.2% (의도와 다름)
// 수정: ±20% (0.8~1.2 배율)
const variance = 0.8 + Math.random() * 0.4;
```

---

## 8. 통합 테스트

| 실제 HTTP 서버 구동 테스트 | 15분 |
|------|:---:|

```typescript
// 서버 띄우고 실제 fetch로 테스트
const res = await fetch('http://localhost:3000/api/players', { method: 'POST', ... });
```

---

## 9. 시드 데이터

| 개발용 더미 플레이어 생성 | 10분 |
|------|:---:|

```bash
npm run db:seed  # → 100명의 랜덤 플레이어 생성
```

---

## 10. 페이지네이션

| 랭킹/플레이어 목록 무한 스크롤 지원 | 15분 |
|------|:---:|

```
GET /api/rankings?page=1&limit=20
GET /api/players?page=1&limit=50
```

---

## 11. `.env.example` + License

| 환경변수 문서화 + MIT 라이선스 | 5분 |
|------|:---:|

---

## 12. Dependabot

| 의존성 자동 업데이트 | 5분 |
|------|:---:|

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
```

---

## 📊 요약

| # | 항목 | 시간 |
|:---:|------|:---:|
| 1 | 테스트 보강 | 30m |
| 2 | OpenAPI 문서 | 20m |
| 3 | Rate Limiting | 10m |
| 4 | ESLint + Prettier | 10m |
| 5 | Docker | 10m |
| 6 | ERD/아키텍처 | 15m |
| 7 | 배틀 버그 수정 | 5m |
| 8 | 통합 테스트 | 15m |
| 9 | 시드 데이터 | 10m |
| 10 | 페이지네이션 | 15m |
| 11 | .env.example + License | 5m |
| 12 | Dependabot | 5m |
| **합계** | | **약 2시간 30분** |
