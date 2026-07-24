# 포트폴리오 개선 계획

> 현재 프로젝트 분석일: 2026-07-24

---

## 📊 현재 상태 평가

| 영역 | 점수 | 설명 |
|------|:---:|------|
| 핵심 기능 | ⭐⭐⭐ | 방치형 게임 기본 루프 구현 완료 |
| 코드 구조 | ⭐⭐ | 단일 파일 라우트, 중복 로직 다수 |
| 테스트 | ⭐⭐⭐ | 27개 유닛 테스트, 커버리지 양호 |
| 문서화 | ⭐⭐ | README는 있으나 OpenAPI 없음 |
| 프로덕션 준비 | ⭐ | DB 없음, 인증 없음, 로깅 없음 |
| DevOps | ⭐ | CI/CD, Docker 미구성 |

---

## 🔴 Critical (포트폴리오 필수)

### 1. 데이터베이스 도입
- **문제**: 인메모리 Map 사용 → 서버 재시작 시 모든 데이터 소멸
- **방안**:
  - SQLite + Drizzle ORM (경량, 포트폴리오용 최적)
  - 마이그레이션 스크립트 추가
  - `store.ts` → Repository 패턴으로 추상화

### 2. 프로젝트 구조 재설계
- **현재**: 평면 구조 (routes.ts 225줄 단일 파일)
- **개선**:
  ```
  src/
  ├── index.ts              # 서버 진입점
  ├── app.ts                # Hono 앱 설정 (미들웨어, 라우트 마운트)
  ├── config.ts             # 환경변수 설정
  ├── db/
  │   ├── schema.ts         # Drizzle 스키마
  │   └── migrate.ts        # 마이그레이션
  ├── modules/
  │   ├── players/
  │   │   ├── player.routes.ts
  │   │   ├── player.service.ts
  │   │   ├── player.repository.ts
  │   │   └── player.test.ts
  │   ├── battle/
  │   │   ├── battle.routes.ts
  │   │   ├── battle.service.ts
  │   │   └── battle.test.ts
  │   └── ranking/
  │       ├── ranking.routes.ts
  │       ├── ranking.service.ts
  │       └── ranking.test.ts
  └── shared/
      ├── errors.ts         # 커스텀 에러 클래스
      ├── middleware/
      │   ├── error-handler.ts
      │   ├── validator.ts
      │   └── rate-limit.ts
      └── utils/
          └── game-math.ts  # 생산량 계산 등 공통 로직
  ```

### 3. 게임 상수 분리 & 밸런싱
- **문제**: 매직넘버 산재 (`8`, `50`, `10`, `30`)
- **방안**:
  ```typescript
  // src/config/game-balance.ts
  export const GAME_BALANCE = {
    baseElectricityPerSecond: 1,
    maxIdleHours: 8,
    upgradeCostMultiplier: 50,
    battlePowerMultiplier: 10,
    battleBaseRewardMultiplier: 30,
    battleEnemyVariance: 0.2,
  };
  ```

### 4. 에러 처리 체계화
- **문제**: 각 라우트에서 개별 에러 처리, 일관성 없음
- **방안**:
  - 커스텀 에러 클래스 (`NotFoundError`, `BadRequestError`, `InsufficientResourceError`)
  - Hono `onError` 미들웨어로 전역 에러 핸들링
  - 일관된 에러 응답 형식: `{ error: string, code: string, statusCode: number }`

---

## 🟡 High (있으면 큰 차별점)

### 5. 입력 검증 강화
- **문제**: 수동 if문 검증만 존재
- **방안**: Zod 스키마 검증 도입
  ```typescript
  const createPlayerSchema = z.object({
    nickname: z.string().min(1).max(20).trim(),
  });
  ```

### 6. OpenAPI 문서화
- **문제**: Swagger/OpenAPI 없음
- **방안**:
  - `@hono/zod-openapi` + Scalar UI
  - `GET /docs` 에서 인터랙티브 API 문서 제공

### 7. CI/CD 파이프라인
- **방안**: GitHub Actions
  - PR 시: lint → type-check → test → build
  - main merge 시: test → build → (optional) deploy

### 8. Docker 지원
- **방안**:
  - `Dockerfile` (멀티스테이지 빌드)
  - `docker-compose.yml` (개발 환경)
  - `.dockerignore`

---

## 🟢 Medium (품질 향상)

### 9. 중복 로직 제거
- **문제**: 생산량 계산 로직이 claim, idle-rewards, rankings에서 3회 중복
- **방안**: `game-math.ts` 유틸 함수로 추출
  ```typescript
  export function calculateProduction(
    lastClaimedAt: string,
    electricityPerSecond: number,
    maxIdleSeconds: number,
  ): { elapsed: number; produced: number; maxCapped: boolean }
  ```

### 10. 인증/권한 (간단한 API 키)
- **문제**: 누구나 모든 플레이어 조작 가능
- **방안**: 플레이어 생성 시 반환된 API 키로 본인 계정만 접근
  - `Authorization: Bearer <player-api-key>` 헤더 검증

### 11. 배틀 시스템 개선
- **문제**: 랜덤 분산 계산이 의도와 다름 (±20%가 아닌 ±0.2%)
- **방안**: 
  ```typescript
  // Current (buggy):
  // Math.floor(Math.random() * 40 - 20) → -20 to 19
  // playerPower * variance / 100 → divides by 100 again
  
  // Fixed:
  const variance = 1 + (Math.random() * 0.4 - 0.2); // 0.8 ~ 1.2
  const enemyPower = Math.max(1, Math.floor(playerPower * variance));
  ```

### 12. ESLint + Prettier 설정
- 코드 스타일 일관성, 포트폴리오 기본 소양

### 13. 헬스체크 & 메트릭
- `GET /health` → DB 연결 상태 포함
- `GET /metrics` → 플레이어 수, 요청 수 등

---

## 🔵 Low (있으면 좋은 것)

### 14. 페이지네이션
- `GET /api/rankings?page=1&limit=50`
- `GET /api/players?page=1&limit=20`

### 15. 로깅 시스템
- Pino 또는 structured logger
- 요청/응답 로깅 미들웨어

### 16. Rate Limiting
- 전투/claim 스팸 방지
- `@hono/rate-limiter`

### 17. 추가 게임 기능
- 아이템/장비 시스템
- 업적(Achievement) 시스템
- 일일 퀘스트
- 이벤트/시즌제

---

## 📝 작업 우선순위 제안

| 순서 | 작업 | 예상 소요 | 영향도 |
|:---:|------|:---:|:---:|
| 1 | 프로젝트 구조 재설계 | 30min | 🔴 전체 기반 |
| 2 | 게임 상수 분리 & 매직넘버 제거 | 10min | 🔴 유지보수 |
| 3 | 중복 로직 → game-math 유틸 추출 | 10min | 🟡 가독성 |
| 4 | 커스텀 에러 + 전역 핸들러 | 15min | 🔴 안정성 |
| 5 | Zod 입력 검증 | 15min | 🟡 신뢰성 |
| 6 | SQLite + Drizzle 도입 | 30min | 🔴 영속성 |
| 7 | 배틀 시스템 버그 수정 | 5min | 🟡 정합성 |
| 8 | ESLint + Prettier | 10min | 🟢 품질 |
| 9 | OpenAPI + Scalar 문서화 | 15min | 🟡 포트폴리오 |
| 10 | 인증 (API 키) | 15min | 🟢 보안 |
| 11 | CI/CD (GitHub Actions) | 15min | 🟡 DevOps |
| 12 | Docker | 10min | 🟡 배포 |
| 13 | 헬스체크 + 메트릭 | 10min | 🟢 운영 |
| 14 | 페이지네이션 | 15min | 🔵 확장성 |
| 15 | Rate Limiting | 10min | 🔵 보안 |

---

## 🎯 기대 결과

개선 완료 시 이 프로젝트는 다음과 같은 포트폴리오 강점을 갖게 됩니다:

- ✅ **클린 아키텍처**: 모듈화된 계층 구조 (routes → service → repository)
- ✅ **견고한 에러 처리**: 일관된 에러 응답, 전역 핸들러
- ✅ **타입 안전성**: Zod + TypeScript full strict mode
- ✅ **영속성**: SQLite + Drizzle ORM 마이그레이션
- ✅ **API 문서**: 인터랙티브 Swagger/OpenAPI
- ✅ **DevOps**: Docker, CI/CD, 자동화된 테스트
- ✅ **실제 서비스 수준**: 인증, 로깅, 레이트 리미팅
- ✅ **확장 가능한 설계**: 게임 모듈 추가가 용이한 구조
