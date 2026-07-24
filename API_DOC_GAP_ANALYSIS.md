# API 문서 누락 분석

> 기준: OpenAPI 3.0 표준, 포트폴리오 수준 완성도

---

## 📊 현재 상태

| 구분 | 상태 |
|------|:---:|
| README 수동 문서 | ✅ 있음 |
| OpenAPI/Swagger Spec | ❌ 없음 |
| 인터랙티브 문서 UI | ❌ 없음 |
| 타입 기반 자동 생성 | ❌ 없음 |
| 에러 응답 문서화 | ❌ 없음 |

---

## 🔴 엔드포인트별 문서 누락 (README)

### 1. `POST /api/players`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 실패 응답 예시 | `400 { error: "닉네임은 필수입니다." }` 문서 없음 |
| ❌ 닉네임 제약조건 | 최대 길이, 허용 문자 명시 안 됨 |
| ❌ Content-Type | `application/json` 필수 명시 안 됨 |
| ❌ 멱등성 | 재요청 시 새 플레이어 생성됨 (idempotency key 없음) |

### 2. `GET /api/players`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 응답 본문 예시 | "플레이어 배열"만 있고 실제 예시 JSON 없음 |
| ❌ 정렬 순서 | 생성순? 이름순? 명시 안 됨 |
| ❌ 페이지네이션 | 지원 여부 명시 안 됨 (현재 미지원) |

### 3. `GET /api/players/:id`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 200 응답 예시 | 성공 시 응답 본문 없음 |
| ❌ 404 응답 예시 | `{ error: "플레이어를 찾을 수 없습니다." }` 문서 없음 |

### 4. `POST /api/players/:id/claim`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 404 응답 예시 | 존재하지 않는 플레이어 |
| ❌ 생산량 계산 공식 | `elapsed × electricityPerSecond` 문서에 명시 안 됨 |
| ❌ `maxCapped` 설명 | 어떤 조건에서 true가 되는지 |
| ❌ `elapsedSeconds=0` 케이스 | 방금 claim 했을 때 응답 예시 |
| ❌ 부작용(side effect) | `electricity` 증가 + `lastClaimedAt` 갱신 명시 |

### 5. `GET /api/players/:id/claim`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 404 응답 예시 | |
| ❌ `pending` 의미 | "claim 시 받을 수 있는 양" 설명 부족 |
| ❌ GET vs POST 차이 | 읽기 전용임을 명시 안 함 |

### 6. `GET /api/players/:id/idle-rewards`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 404 응답 예시 | |
| ❌ `offlineTime` 포맷 | `{h}h {m}m {s}s` 형식 명시 안 됨 |
| ❌ `maxCapped: true` 예시 | 8시간 초과 케이스 응답 없음 |

### 7. `GET /api/players/:id/upgrade`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 404 응답 예시 | |
| ❌ `cost` 계산식 | `electricityPerSecond × 50` 문서에 미기재 |
| ❌ `canAfford: true` 예시 | 전기 충분할 때 응답 없음 |

### 8. `POST /api/players/:id/upgrade`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 400 에러 응답 본문 | `{ error, cost, current }` 구조 미문서 |
| ❌ 업그레이드 효과 | `electricityPerSecond` +1 증가, `electricity` -cost 감소 |
| ❌ 연속 업그레이드 시 비용 증가 | 각 레벨별 비용 테이블 없음 |

### 9. `POST /api/players/:id/battle`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ 패배 시 응답 예시 | `won: false, reward: 0` 케이스 |
| ❌ 적 목록 | 8종 몬스터 이름 전체 |
| ❌ 전투력 계산식 | `playerPower = electricityPerSecond × 10` |
| ❌ 보상 계산식 | `reward = electricityPerSecond × 30 × (0.5~1.5 랜덤)` |
| ❌ 승률 설명 | 적 전투력 ±20% 랜덤, playerPower ≥ enemyPower 시 승리 |

### 10. `GET /api/rankings`

| 누락 항목 | 설명 |
|-----------|------|
| ❌ `totalWealth` 계산식 | `electricity + (경과시간 × electricityPerSecond)` |
| ❌ 정렬 기준 | totalWealth 내림차순 |
| ❌ 응답 개수 제한 | 전체 반환 (제한 없음) 명시 |

---

## 🟡 구조적 누락

| # | 항목 | 설명 |
|:---:|------|------|
| 1 | **OpenAPI Spec 파일** | `openapi.yaml` 또는 `openapi.json` 없음 |
| 2 | **인터랙티브 문서** | Swagger UI / Scalar / Redoc 미탑재 |
| 3 | **공통 응답 형식** | 성공/에러 응답 래퍼 스키마 정의 없음 |
| 4 | **인증 방식** | API 키/토큰 사용 여부 명시 없음 |
| 5 | **Rate Limit** | 제한 정책 문서 없음 |
| 6 | **버전 관리** | API 버저닝 전략 (`/v1/` 등) 없음 |
| 7 | **데이터 타입 정의** | `Player` 전체 스키마를 한 곳에 정의 안 함 |
| 8 | **상태 코드 요약** | 어떤 엔드포인트가 어떤 HTTP status를 반환하는지 매트릭스 없음 |
| 9 | **변경 이력** | Changelog / API version history 없음 |
| 10 | **예제 요청 (curl)** | curl 예제가 하나도 없음 |

---

## 🔵 엔드포인트 × 응답코드 매트릭스 (문서화 필요)

| 엔드포인트 | 200 | 201 | 400 | 404 | 500 |
|------|:---:|:---:|:---:|:---:|:---:|
| `POST /api/players` | - | ✅ | ❌문서 | - | - |
| `GET /api/players` | ❌예시 | - | - | - | - |
| `GET /api/players/:id` | ❌예시 | - | - | ❌예시 | - |
| `POST .../claim` | ✅ | - | - | ❌예시 | ❌예시 |
| `GET .../claim` | ✅ | - | - | ❌예시 | - |
| `GET .../idle-rewards` | ✅ | - | - | ❌예시 | - |
| `GET .../upgrade` | ✅ | - | - | ❌예시 | - |
| `POST .../upgrade` | ✅ | - | ❌예시 | ❌예시 | ❌예시 |
| `POST .../battle` | ✅ | - | - | ❌예시 | ❌예시 |
| `GET /api/rankings` | ✅ | - | - | - | - |

> ✅=문서화됨, ❌문서=상태코드 존재하나 문서 없음, ❌예시=응답 예시 없음, -=해당 없음

---

## 🎯 빠른 액션 아이템

| 순서 | 작업 | 예상 시간 |
|:---:|------|:---:|
| 1 | README에 누락된 404/400 에러 응답 예시 추가 | 10min |
| 2 | 모든 GET 엔드포인트에 200 응답 예시 추가 | 10min |
| 3 | `totalWealth`, 전투력, 업글 비용 등 **계산식 문서화** | 10min |
| 4 | `@hono/zod-openapi` + Scalar UI로 **인터랙티브 문서** 추가 | 20min |
| 5 | curl 예제 전체 추가 | 10min |
| 6 | 상태코드 매트릭스 테이블 추가 | 5min |
