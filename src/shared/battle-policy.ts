/**
 * 전투 검증 중앙 정책
 *
 * 모든 허용 오차, 상한 배율, 기본값을 한 곳에서 관리한다.
 * 라우트나 서비스 코드에 매직 넘버를 직접 쓰지 않는다.
 */

export const BATTLE_POLICY = {
  // ── 동시 세션 ──
  /** 사용자당 최대 동시 active 세션 수 */
  MAX_ACTIVE_SESSIONS_PER_USER: 1,

  // ── 세션 만료 ──
  /** 스테이지 제한시간 이후 추가 허용 시간 (초) */
  SESSION_EXPIRY_GRACE_SECONDS: 120,

  // ── 시간 검증 ──
  /** finish 시 클라이언트 제출 경과시간 허용 오차 (초) */
  FINISH_TIME_TOLERANCE_SECONDS: 10,

  // ── 처치 수 ──
  /** 이벤트별 처치 수 상한 배율 */
  KILL_STAGE_MAX_MULTIPLIER: 1.05,
  /** finish 시 처치 수 허용 오차 (건) */
  FINISH_KILL_TOLERANCE: 5,

  // ── core_energy ──
  /** core_energy = kills × corePerKill × 이 배율 이내 */
  CORE_PER_KILL_TOLERANCE: 1.2,
  /** finish 시 core_energy 허용 오차 (건) */
  FINISH_CORE_TOLERANCE: 10,

  // ── 보스 ──
  /** 보스 등장 N초 전부터 처치 허용 */
  BOSS_EARLY_TOLERANCE_SECONDS: 5,

  // ── 콘텐츠 기본값 (DB 미지정 시) ──
  DEFAULT_CORE_PER_LEVEL: 50,
  DEFAULT_CORE_PER_KILL: 5,
  DEFAULT_MAX_KILLS: 300,
  DEFAULT_MAX_CORE_ENERGY: 300,
  DEFAULT_SCRAP_PER_KILL: 1,

  // ── 선택지 ──
  /** 레벨업 시 제시할 선택지 수 */
  UPGRADE_CHOICES_PER_LEVEL: 3,

  // ── 콘텐츠 버전 ──
  CONTENT_VERSION: '1.0.0',

  // ── 운영 지급 제한 ──
  MAX_GRANT_AMOUNT: 100000,
  MIN_GRANT_AMOUNT: -100000,
  /** admin role만 고액 지급 가능한 임계값 */
  HIGH_VALUE_GRANT_THRESHOLD: 10000,
} as const;
