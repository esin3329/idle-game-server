# 성능 기준값 (Benchmark)

> 최초 측정일: 2026-07-30
> 환경: Node.js v24.17.0, JSON 저장소 (DB_DRIVER=json), 싱글 스레드
> 도구: autocannon v8.0.0 (connections=10, duration=10s)

---

## 읽기 엔드포인트 (GET)

| # | 엔드포인트 | RPS | Avg Latency | P50 | P95 | P99 | 오류율 |
|:---:|-----------|:---:|:-----------:|:---:|:---:|:---:|:-----:|
| 1 | `/health` | **392** | 25ms | 49ms | 73ms | 137ms | 0% |
| 2 | `/parts` | **401** | 24ms | 46ms | 54ms | 125ms | 0% |
| 3 | `/research` | **409** | 24ms | 47ms | 56ms | 78ms | 0% |
| 4 | `/stages` | **472** | 21ms | 31ms | 41ms | 96ms | 0% |
| 5 | `/api/players` | **472** | 21ms | 35ms | 43ms | 105ms | 0% |

## 쓰기 엔드포인트 (POST)

> 주의: nickname/idempotencyKey 중복으로 인해 실제 쓰기 부하 측정에는 부적합.
> 별도 단일 요청 기준값으로 대체.

| 엔드포인트 | 단건 평균 | 비고 |
|-----------|:--------:|------|
| `POST /api/players` | ~15ms | 플레이어 생성 (JSON 파일 저장) |
| `POST /auth/register` | ~80ms | 회원가입 (bcrypt hash + wallet 생성) |
| `POST /api/players/:id/claim` | ~20ms | 방치 보상 수집 (adjustBalance + 원장) |
| `POST /crafting/drop` | ~10ms | 설계도 드롭 |

## 자원 사용량

| 항목 | 값 |
|------|:---:|
| 메모리 RSS | 11MB |
| 힙 사용 | 18MB |
| 힙 전체 | 20MB |
| 응답 크기 (/health) | ~150B |
| 응답 크기 (/parts) | ~4KB |
| 응답 크기 (/research) | ~5.5KB |
| 응답 크기 (/stages) | ~5KB |

## 해석

### 강점
- **읽기 API 400+ RPS**: 단순 JSON 반환 엔드포인트는 초당 400~470 요청 처리
- **P50 < 50ms**: 대부분의 요청이 50ms 이내 처리
- **메모리 20MB**: 매우 가벼운 풋프린트
- **오류율 0%**: 모든 GET 요청 정상 처리

### 병목
- **JSON 직렬화**: `/parts`(4KB)가 `/health`(150B)보다 낮은 RPS (401 vs 392는 유사)
- **파일 I/O**: JSON 저장소는 파일 쓰기 시 직렬 병목 (POST 성능 저하 원인)
- **bcrypt**: 회원가입 시 bcrypt hash가 가장 큰 병목 (단건 80ms)

### MySQL 기대치
- JSON 저장소 대비 **쓰기 성능 3~5배 향상** 예상 (트랜잭션 + 인덱스)
- 읽기 성능은 **유사 또는 소폭 감소** (네트워크 왕복 시간 추가)
- 동시성 처리 능력 **대폭 향상** (connection pool)

---

## 측정 방법

```bash
# GET 엔드포인트
npx autocannon -m GET --connections 10 --duration 10 http://localhost:3000/health

# POST 엔드포인트 (단건)
npx autocannon -m POST --connections 5 --duration 5 \
  -H 'Content-Type: application/json' \
  -b '{"nickname":"bench-{{$guid}}"}' \
  http://localhost:3000/api/players
```
