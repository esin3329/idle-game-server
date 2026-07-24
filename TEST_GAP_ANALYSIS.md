# 테스트 누락 분석

> 기준: 모든 public API, 엣지케이스, 테스트 유형

---

## 📊 현재 테스트 현황

| 파일 | 개수 | 대상 |
|------|:---:|------|
| `store.test.ts` | 9 | createPlayer, getPlayer, getAllPlayers, updatePlayer, deletePlayer |
| `routes.test.ts` | 18 | POST/GET players, claim, upgrade, battle, rankings, idle-rewards |
| **합계** | **27** | |

---

## 🔴 누락된 테스트

### store.test.ts (4개 누락)

| # | 대상 | 누락된 케이스 | 이유 |
|:---:|------|------|------|
| 1 | `getPlayer` | **존재하는 ID 조회 성공** | 404만 테스트, 200 케이스 없음 |
| 2 | `createPlayer` | **중복 ID로 생성 시 덮어쓰기** | 현재 동작 확인 안 됨 (Map 특성상 덮어씀) |
| 3 | `updatePlayer` | **존재하지 않는 필드 업데이트** | `{ foo: 'bar' }` 같은 잘못된 키 전달 시 동작 |
| 4 | `updatePlayer` | **`updatedAt` 갱신 확인** | 현재 단순 `toBeDefined`만 확인, 실제로 변경되었는지 검증 안 함 |

### routes.test.ts (16개 누락)

| # | 엔드포인트 | 누락된 케이스 | 이유 |
|:---:|------|------|------|
| 5 | `POST /api/players` | **닉네임 20자 초과** | 긴 입력 제한 없음 → 취약점 |
| 6 | `POST /api/players` | **특수문자/XSS 닉네임** | `<script>alert(1)</script>` 필터링 안 함 |
| 7 | `POST /api/players` | **잘못된 Content-Type** | `text/plain` 전송 시 동작 |
| 8 | `POST /api/players` | **JSON 파싱 불가 body** | `{ invalid json` |
| 9 | `GET /api/players/:id` | **존재하는 ID 조회 성공** | 404만 테스트 |
| 10 | `GET /api/players` | **플레이어 있을 때 목록 조회** | 빈 배열만 테스트 |
| 11 | `POST .../claim` | **즉시 재요청 (elapsed=0)** | 0초 경과 케이스 |
| 12 | `POST .../claim` | **8시간 초과 cap 적용** | maxCapped=true 확인 |
| 13 | `POST .../claim` | **claim 후 lastClaimedAt 갱신 확인** | 시간이 갱신되는지 |
| 14 | `GET .../claim` | **존재하지 않는 플레이어 404** | 404 케이스 없음 |
| 15 | `GET .../upgrade` | **존재하지 않는 플레이어 404** | 404 케이스 없음 |
| 16 | `GET .../upgrade` | **canAfford=true인 경우** | false만 테스트 |
| 17 | `POST .../battle` | **패배 시 electricity 불변** | 패배 시 전기가 그대로인지 |
| 18 | `POST .../battle` | **패배 시 reward=0** | 확률적이라 비결정적 |
| 19 | `GET /api/rankings` | **단일 플레이어 랭킹** | 0명 or 2명만 테스트 |
| 20 | `GET .../idle-rewards` | **존재하지 않는 플레이어 404** | 404 케이스 없음 |

---

## 🟡 테스트 품질 문제

| # | 문제 | 상세 | 영향 |
|:---:|------|------|:---:|
| 21 | **비결정적 테스트** | `battle.test.ts` 두 번째 케이스 - 랜덤에 의존, CI에서 flaky 가능성 | 🟡 |
| 22 | **시간 의존적 테스트** | `Date.now()` 실시간 호출로 ±1초 오차로 간헐적 실패 가능 | 🟡 |
| 23 | **테스트 격리 부족** | `store.test.ts`와 `routes.test.ts`가 같은 전역 store 공유 중 | 🔴 |
| 24 | **beforeEach 비효율** | `getAllPlayers()`로 가져와서 반복문 삭제 → `clearStore()` 유틸 부재 | 🟢 |
| 25 | **응답 body 타입 미검증** | `expect(body).toEqual([])`만 하고 `Array.isArray` 검증 없음 | 🟢 |

---

## 🔵 누락된 테스트 유형

| # | 유형 | 현재 | 필요 |
|:---:|------|:---:|:---:|
| 26 | **통합 테스트** | ❌ | 실제 HTTP 서버 구동 후 요청 테스트 |
| 27 | **커버리지 측정** | ❌ | `vitest --coverage` 설정 |
| 28 | **API 스펙 테스트** | ❌ | 응답 스키마 검증 (Zod + snapshot) |
| 29 | **동시성 테스트** | ❌ | 여러 요청 동시 처리 (store race condition) |
| 30 | **부하 테스트** | ❌ | 대량 플레이어 생성/랭킹 성능 |
| 31 | **에러 응답 형식 테스트** | ❌ | 모든 에러가 `{ error: string }` 형식인지 확인 |

---

## 📈 종합

| 구분 | 현재 | 목표 | 갭 |
|------|:---:|:---:|:---:|
| 유닛 테스트 | 27 | 47 (+20) | 엣지케이스 위주 |
| 통합 테스트 | 0 | 5 | HTTP 레벨 |
| 커버리지 | 미측정 | 80%+ | 설정 필요 |
| 테스트 유형 | 1종 | 3종 | 통합 + API 스펙 |

---

## 🎯 빠른 액션 아이템 (30분 내 해결 가능)

1. **store `clear()` 함수 추가** → beforeEach 개선
2. **누락된 404 케이스 4개 추가** → `GET .../claim`, `GET .../upgrade`, `GET .../idle-rewards`, `GET .../players/:id` (200)
3. **claim cap 테스트 추가** → `lastClaimedAt`을 9시간 전으로 설정
4. **비결정적 battle 테스트 개선** → 승/패 분기해서 개별 테스트
5. **닉네임 검증 테스트** → 20자 초과, 특수문자
6. **vitest coverage 설정** → `"test": "vitest run --coverage"` 및 `@vitest/coverage-v8` 설치
