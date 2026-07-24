# 통합 개선 계획 (중요도순)

> 12개 분석에서 도출된 모든 누락 항목을 중요도로 정렬

---

## 🔴 Critical (지금 당장)

| 순서 | 항목 | 내용 | 예상 시간 |
|:---:|------|------|:---:|
| C1 | **에러 처리** | `app.onError`, `app.notFound`, JSON 파싱 try-catch, 커스텀 에러 클래스 | 15min |
| C2 | **입력값 검증** | UUID regex, Zod 도입, 닉네임 길이/문자셋 제한, Content-Type 검증 | 30min |
| C3 | **보안** | CORS, secure-headers, bodyLimit, API 키 인증 | 20min |
| C4 | **DB 마이그레이션** | SQLite + Drizzle ORM, schema.ts, repository 패턴, 마이그레이션 스크립트 | 40min |
| C5 | **로깅** | Pino 도입, 요청 로깅 미들웨어, 게임 이벤트 로깅, requestId | 15min |
| C6 | **Graceful Shutdown** | SIGTERM 핸들러, 서버 인스턴스 저장, `/ready`, 강제종료 타임아웃 | 5min |
| C7 | **Health Check** | `/health`, `/ready`, `/status` | 5min |
| C8 | **GitHub Actions** | CI 워크플로우 (type-check → test → build → audit) | 10min |

> C1~C8 합계: **약 2시간 20분**

---

## 🟡 High (실행 직후)

| 순서 | 항목 | 내용 | 예상 시간 |
|:---:|------|------|:---:|
| H1 | **테스트 보강** | 누락된 404/400 케이스 20개, cap 테스트, 커버리지 설정 | 30min |
| H2 | **API 문서 보강** | OpenAPI Scalar UI, 누락된 응답 예시, curl 예제 | 20min |
| H3 | **README 완성** | 뱃지, 기능 목록, 프로젝트 구조, 환경변수 테이블 | 15min |
| H4 | **ERD/아키텍처** | Mermaid ERD, 시스템 아키텍처, API 시퀀스 다이어그램 | 15min |
| H5 | **Rate Limiting** | claim/battle/upgrade 속도 제한 | 10min |

> H1~H5 합계: **약 1시간 30분**

---

## 🟢 Medium (마무리)

| 순서 | 항목 | 내용 | 예상 시간 |
|:---:|------|------|:---:|
| M1 | ESLint + Prettier | 코드 스타일 일관성 | 10min |
| M2 | Docker | Dockerfile + docker-compose.yml | 10min |
| M3 | 통합 테스트 | 실제 HTTP 서버 테스트 | 15min |
| M4 | 시드 데이터 | 개발용 더미 플레이어 생성 스크립트 | 10min |
| M5 | 배틀 버그 수정 | ±20% 분산 계산 수정 | 5min |
| M6 | 페이지네이션 | 랭킹/플레이어 목록 페이지네이션 | 15min |
| M7 | 닉네임 중복 체크 | 동일 닉네임 방지 | 5min |

> M1~M7 합계: **약 1시간 10분**

---

## 🔵 Low (있으면 좋은 것)

| 순서 | 항목 | 내용 | 예상 시간 |
|:---:|------|------|:---:|
| L1 | `.env.example` | 환경변수 문서화 | 5min |
| L2 | `"private": true` | npm publish 방지 | 1min |
| L3 | 수치 상한 | MAX_ELECTRICITY_PER_SECOND | 5min |
| L4 | 배포 가이드 | README에 Docker/클라우드 배포 방법 | 10min |
| L5 | License | MIT LICENSE 파일 | 1min |
| L6 | Dependabot | 의존성 자동 업데이트 | 5min |

---

## 📈 타임라인 요약

| 단계 | 항목 수 | 소요 시간 |
|------|:---:|:---:|
| 🔴 Critical | 8 | 2h 20m |
| 🟡 High | 5 | 1h 30m |
| 🟢 Medium | 7 | 1h 10m |
| 🔵 Low | 6 | 27m |
| **총계** | **26** | **약 5.5시간** |

---

## 🎯 MVP (최소 포트폴리오 완성, 2.5시간)

```
C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8 → H3 → M5
```
