# GitHub Actions 누락 분석

> 기준: 포트폴리오 CI/CD 최소 구성

---

## 📊 현재 상태

```
.github/
└── (존재하지 않음)
```

| 항목 | 상태 |
|------|:---:|
| CI 파이프라인 | ❌ |
| PR 체크 | ❌ |
| 자동 테스트 | ❌ |
| 타입 체크 | ❌ |
| 린트 | ❌ |
| 보안 감사 | ❌ |
| 자동 배포 | ❌ |

---

## 🔴 Critical

### 1. PR 체크 파이프라인 없음

**현상**: PR을 올려도 어떤 검증도 자동으로 실행되지 않음

```
PR → (아무 일도 안 일어남) → merge 가능
     ↑ 타입 에러 있어도, 테스트 깨져도 통과됨
```

### 2. 메인 브랜치 보호 없음

CI가 없으면 GitHub Branch Protection Rule을 활성화할 수 없음

---

## 🟡 High: 필요한 워크플로우

### 3. CI 워크플로우 (PR + Push)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'npm' }
      - run: npm ci
      - run: npm run type-check     # tsc --noEmit
      - run: npm run lint           # (ESLint 필요)
      - run: npm run test           # vitest run
      - run: npm run build          # tsc
      - run: npm audit --audit-level=high
```

### 4. 필요 npm scripts (현재 누락)

```json
{
  "type-check": "tsc --noEmit",
  "lint": "eslint src/",
  "format:check": "prettier --check src/",
  "audit": "npm audit --audit-level=high"
}
```

---

## 🟢 Medium

### 5. DB 마이그레이션 체크

DB 도입 시: PR에서 `drizzle-kit check`로 마이그레이션 누락 확인

### 6. 테스트 커버리지 리포트

```yaml
- run: npm run test -- --coverage
- uses: actions/upload-artifact@v4
  with: { name: coverage, path: coverage/ }
```

### 7. 번들 사이즈 체크

빌드 결과물 크기가 급증하는지 추적 (포트폴리오 가산점)

---

## 🔵 Low

| # | 항목 | 설명 |
|:---:|------|------|
| 8 | **Matrix 빌드** | Node 20/22 여러 버전 테스트 |
| 9 | **Docker 빌드** | PR마다 Docker 이미지 빌드 확인 |
| 10 | **자동 라벨링** | PR 파일 경로 기반 자동 라벨 부착 |
| 11 | **Renovate/Dependabot** | 의존성 자동 업데이트 PR |
| 12 | **Release 자동화** | 태그 푸시 → 자동 GitHub Release |

---

## 📁 제안 전체 구조

```
.github/
├── workflows/
│   ├── ci.yml           # PR/push: type-check → test → build → audit
│   ├── db-check.yml     # DB migration diff 체크 (추후)
│   └── release.yml      # 태그 시 자동 릴리스 (추후)
└── dependabot.yml       # 의존성 자동 업데이트 (추후)
```

---

## 🎯 빠른 액션 (10분)

| 순서 | 작업 |
|:---:|------|
| 1 | `.github/workflows/ci.yml` 생성 |
| 2 | `package.json`에 `type-check` 스크립트 추가 |
| 3 | GitHub 브랜치 보호 규칙 활성화 가이드 작성 |
