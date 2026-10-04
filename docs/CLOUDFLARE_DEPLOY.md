# Cloudflare 배포

Cloudflare Workers 정적 자산으로 관리자 SPA를 제공합니다. `/api/*` 및 상태 확인 요청은 이미 배포되어 검증한 Node 서버로 프록시하고, 서버의 API와 MySQL은 그대로 사용합니다.

## 사전 준비

- Cloudflare 계정에서 Workers와 Static Assets를 사용할 수 있어야 합니다.
- 기존 Node API 서버가 외부에서 HTTPS로 접속 가능해야 합니다.
- API와 DB 인증정보, AI 키는 기존 Node 서버 설정을 그대로 사용합니다. 이 배포에는 DB 비밀번호나 AI 키를 Cloudflare에 복사하지 않습니다.

## 설정

1. 프로젝트 루트에서 `npx wrangler login`을 실행하고 배포할 Cloudflare 계정에 로그인합니다. `npx wrangler whoami`로 계정을 확인합니다.
2. 운영 API origin은 추적되는 `wrangler.jsonc`에 넣지 않습니다. 배포할 때 `--var`로 전달해 GitHub에 서버 주소가 커밋되지 않게 합니다. origin만 입력하고 `/api` 같은 경로는 붙이지 않습니다.
3. 로컬 개발은 `.dev.vars.example`을 `.dev.vars`로 복사합니다. 기본 주소 `http://127.0.0.1:3000`은 개발용 Node 서버를 가리킵니다.

## 빌드와 배포

```powershell
npm ci
npm ci --prefix admin
npm run types:cloudflare
npm run type-check:cloudflare
npm test
npm run build:admin
npx wrangler deploy --var "API_ORIGIN:https://api.example.com"
```

`https://api.example.com`은 기존 Node API의 공개 HTTPS origin으로 바꿉니다. 배포마다 실제 origin을 `--var`로 전달해야 합니다. `wrangler.jsonc`는 안전한 placeholder를 포함하며, `workers.dev`를 켭니다. 사용자 지정 도메인을 연결하려면 Cloudflare 대시보드에서 배포 후 도메인을 추가합니다.

## 배포 후 스모크 테스트

- `/`와 `/login`이 관리자 SPA를 표시하고 새로고침 후에도 SPA 경로가 열리는지 확인합니다.
- `/health`가 기존 Node 서버의 상태를 반환하는지 확인합니다.
- 관리자 계정으로 로그인하고 사용자 목록, 감사 로그 등 API가 기존 서버의 데이터를 반환하는지 확인합니다.
- 새로고침 후 `/login`과 관리자 내부 경로가 계속 열리는지 확인합니다.

로컬 확인 전에 `.dev.vars.example`을 `.dev.vars`로 복사합니다. `/api/*`, `/health`, `/ready`, `/metrics` 요청만 기존 서버로 전달하고, 나머지는 Worker 정적 자산에서 제공합니다.
