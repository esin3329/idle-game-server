/**
 * MySQL + JWT 통합 테스트
 *
 * 실행 전제:
 *   1. docker-compose up -d mysql
 *   2. DB_DRIVER=mysql DB_NAME=idle_game_test npm run db:migrate
 *   3. DB_DRIVER=mysql DB_NAME=idle_game_test npm test
 *
 * DB_NAME에 'test'가 없으면 전체 스킵.
 */
import { describe, it } from 'vitest';

const isTestDb = (process.env.DB_NAME || '').includes('test');

// ─── 멱등성 & 동시성 ────────────────────────────────

describe.skipIf(!isTestDb)('멱등성 (MySQL)', () => {
  it.todo('동일 보상 요청 순차 재전송 → 같은 결과 반환');
  it.todo('동일 보상 요청 동시 전송 → 하나만 처리');
  it.todo('잔액보다 큰 동시 차감 요청 → 하나만 성공, 나머지 400');
  it.todo('트랜잭션 중간 실패 → 전체 rollback');
  it.todo('원장 기록 실패 → 잔액도 변경되지 않음');
});

// ─── 인증 & 권한 ─────────────────────────────────────

describe.skipIf(!isTestDb)('인증 (MySQL + JWT)', () => {
  it.todo('중복 회원가입 → 409 DUPLICATE_ACCOUNT');
  it.todo('Refresh Token 재사용 → 401 TOKEN_EXPIRED');
  it.todo('Refresh Token rotation → 이전 토큰 폐기 후 신규 발급');
  it.todo('다른 사용자의 /wallet 접근 → 본인 데이터만 반환');
  it.todo('다른 사용자의 player/:id/claim → 403 거부');
  it.todo('비활성 계정 로그인 → 403 ACCOUNT_DISABLED');
});
