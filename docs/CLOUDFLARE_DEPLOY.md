# Cloudflare 배포

이 저장소는 Cloudflare Workers 정적 자산으로 관리자 SPA를 제공하고, Worker가 Hono API를 처리합니다. MySQL 연결은 Hyperdrive, GameOps AI 비동기 작업은 Workflows를 사용합니다.

## 사전 준비

- Cloudflare 계정에서 Workers와 Workflows를 사용할 수 있어야 합니다.
- Hyperdrive가 접속할 수 있는 TLS 지원 MySQL 8 엔드포인트와 앱 전용 DB 계정이 필요합니다. MySQL 포트가 Cloudflare에서 접근 가능해야 합니다.
- AI 모델 키는 선택 사항입니다. 키가 없으면 서버와 관리 화면은 배포되지만 GameOps AI 분석은 공급자를 사용할 수 없다고 표시됩니다.

## 계정과 Hyperdrive

1. 프로젝트 루트에서 `npx wrangler login`을 실행하고 배포할 Cloudflare 계정에 로그인합니다. `npx wrangler whoami`로 계정을 확인합니다.
2. `.cloudflare-deploy.env.example`을 `.cloudflare-deploy.env`로 복사해 기존 MySQL의 공개 호스트·포트·DB·앱 전용 사용자 정보를 로컬에서 채웁니다. 복사본은 Git에서 제외됩니다. 비밀번호를 채팅, 저장소, 셸 기록에 직접 적지 마세요.
3. Wrangler Hyperdrive 설정을 만들 때 로컬 비밀 파일의 값을 사용합니다. 비밀번호가 들어간 URI를 터미널에 출력하지 마세요.
4. 생성된 Hyperdrive ID를 `wrangler.jsonc`의 `hyperdrive[0].id`에 넣습니다. 현재 커밋의 0으로 채워진 ID는 배포용이 아닙니다. `localConnectionString`은 로컬 개발 전용 예시입니다.

## 비밀값

Worker의 JWT 비밀값은 Wrangler Secret으로 등록합니다. AI 키는 실제 분석을 사용할 때만 등록합니다.

```powershell
npx wrangler secret put JWT_ACCESS_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
# 선택: npx wrangler secret put GEMINI_API_KEY
# 선택: npx wrangler secret put HF_TOKEN
```

각 명령은 값을 입력하라는 메시지를 표시합니다. `MYSQL_ROOT_PASSWORD`는 Worker에 필요하지 않으며, Worker는 Hyperdrive의 앱 전용 DB 자격 증명을 사용합니다.

## 빌드와 배포

같은 MySQL DB를 계속 사용하는 경우 서버 배포에서 적용한 `0005_gameops_ai` 마이그레이션을 확인합니다. 별도 DB를 쓰면 배포 전에 해당 DB에 마이그레이션을 적용해야 합니다.

```powershell
npm ci
npm ci --prefix admin
npm run types:cloudflare
npm run type-check
npm run type-check:cloudflare
npm test
npm run deploy:cloudflare
```

`wrangler.jsonc`는 `workers.dev`를 켭니다. 사용자 지정 도메인을 연결하려면 Cloudflare 대시보드에서 배포 후 도메인을 추가합니다.

## 배포 후 스모크 테스트

- `/`와 `/login`이 관리자 SPA를 표시하고 새로고침 후에도 SPA 경로가 열리는지 확인합니다.
- `/health`가 200을, `/ready`가 `status: ready`와 DB 연결 상태를 반환하는지 확인합니다.
- 관리자 계정으로 로그인하고 `GET /api/admin/ai/providers`가 공급자 목록을 반환하는지 확인합니다.
- 실제 모델 키를 등록한 뒤 합성 사용자 계정으로 GameOps AI 분석을 요청합니다. 요청 응답은 202, 최종 상태는 `succeeded` 또는 안전한 오류 코드여야 합니다.
- AI Workflows 단계는 제공자 호출이 있었을 수 있는 경우 비용이 발생하는 재추론을 피하도록 자동 재시도를 0회로 설정했습니다.

로컬 확인은 `npm run dev:cloudflare`로 시작합니다. 로컬 MySQL이 없으면 `/ready`가 503을 반환하는 것이 정상입니다.
