import { mysqlTable, varchar, int, datetime, index, unique } from 'drizzle-orm/mysql-core';

/** players — 게임 플레이어 데이터 */
export const players = mysqlTable('players', {
  id: varchar('id', { length: 36 }).primaryKey(),
  nickname: varchar('nickname', { length: 20 }).notNull(),
  apiKey: varchar('api_key', { length: 36 }).notNull(),
  electricity: int('electricity').notNull().default(0),
  electricityPerSecond: int('electricity_per_second').notNull().default(1),
  lastClaimedAt: datetime('last_claimed_at').notNull(),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_players_api_key').on(table.apiKey),
  index('idx_players_electricity').on(table.electricity),
]);

/** users — 인증 계정 */
export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  nickname: varchar('nickname', { length: 20 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  role: varchar('role', { length: 20 }).notNull().default('user'),
  suspendedAt: datetime('suspended_at'),
  suspendedReason: varchar('suspended_reason', { length: 200 }),
  refreshToken: varchar('refresh_token', { length: 512 }),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_users_status').on(table.status),
]);

/** refresh_sessions — JWT 리프레시 토큰 관리 */
export const refreshSessions = mysqlTable('refresh_sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  revokedAt: datetime('revoked_at'),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_rs_user_id').on(table.userId),
  index('idx_rs_expires_at').on(table.expiresAt),
]);

/** currency_ledger — 재화 변동 기록 (감사 추적, append-only) */
export const currencyLedger = mysqlTable('currency_ledger', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  currency: varchar('currency', { length: 20 }).notNull().default('electricity'),
  amount: int('amount').notNull(),
  balanceAfter: int('balance_after').notNull(),
  source: varchar('source', { length: 50 }).notNull(),
  reason: varchar('reason', { length: 100 }).notNull().default(''),
  referenceType: varchar('reference_type', { length: 50 }).notNull().default(''),
  referenceId: varchar('reference_id', { length: 36 }).notNull().default(''),
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().default(''),
  requestHash: varchar('request_hash', { length: 64 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_cl_player_id').on(table.playerId),
  index('idx_cl_user_id').on(table.userId),
  index('idx_cl_created_at').on(table.createdAt),
  unique('uq_cl_idempotency').on(table.idempotencyKey),
]);

/** wallet_balances — 플레이어 재화 잔액 */
export const walletBalances = mysqlTable('wallet_balances', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull().unique(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  currency: varchar('currency', { length: 20 }).notNull().default('electricity'),
  electricity: int('electricity').notNull().default(0),
  electricityPerSecond: int('electricity_per_second').notNull().default(1),
  scrap: int('scrap').notNull().default(0),
  balance: int('balance').notNull().default(0),
  // CHECK (electricity >= 0 AND balance >= 0) — 마이그레이션 SQL에 추가
  lastClaimedAt: datetime('last_claimed_at').notNull(),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_wb_user_id').on(table.userId),
  unique('uq_wb_user_currency').on(table.userId, table.currency),
]);

// ═══════════════════════════════════════════════════
// 전투 시스템
// ═══════════════════════════════════════════════════

/** stage_bosses — 스테이지별 보스 정의 */
export const stageBosses = mysqlTable('stage_bosses', {
  id: varchar('id', { length: 36 }).primaryKey(),
  stageId: varchar('stage_id', { length: 36 }).notNull(),
  bossCode: varchar('boss_code', { length: 50 }).notNull(),
  sequence: int('sequence').notNull().default(1),
  checkpointSeconds: int('checkpoint_seconds').notNull(),
  rewardDefinition: varchar('reward_definition', { length: 500 }).notNull().default('{}'),
  enabled: int('enabled').notNull().default(1),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_sb_stage_id').on(table.stageId),
]);

/** stages — 스테이지 정의 */
export const stages = mysqlTable('stages', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  description: varchar('description', { length: 200 }).notNull().default(''),
  sequence: int('sequence').notNull().default(1),
  entryRequirement: varchar('entry_requirement', { length: 100 }).notNull().default('none'),
  durationSeconds: int('duration_seconds').notNull(),
  recommendedPower: int('recommended_power').notNull().default(10),
  enemySet: varchar('enemy_set', { length: 200 }).notNull().default('[]'),
  bossTimings: varchar('boss_timings', { length: 100 }).notNull().default('[180,360]'),
  maxKills: int('max_kills').notNull().default(300),
  maxCoreEnergy: int('max_core_energy').notNull().default(300),
  corePerLevel: int('core_per_level').notNull().default(50),
  corePerKill: int('core_per_kill').notNull().default(5),
  scrapPerKill: int('scrap_per_kill').notNull().default(1),
  unlocked: int('unlocked').notNull().default(1),
  enabled: int('enabled').notNull().default(1),
  contentVersion: varchar('content_version', { length: 20 }).notNull().default('1.0.0'),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_stages_unlocked').on(table.unlocked),
]);

/** stage_rewards — 스테이지별 보상표 */
export const stageRewards = mysqlTable('stage_rewards', {
  id: varchar('id', { length: 36 }).primaryKey(),
  stageId: varchar('stage_id', { length: 36 }).notNull(),
  clearType: varchar('clear_type', { length: 20 }).notNull().default('normal'),
  scrapMin: int('scrap_min').notNull().default(0),
  scrapMax: int('scrap_max').notNull().default(0),
  blueprintDropRate: int('blueprint_drop_rate').notNull().default(0),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_sr_stage_id').on(table.stageId),
]);

/** mecha_stats — 플레이어별 메카 스탯 */
export const mechaStats = mysqlTable('mecha_stats', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull().unique(),
  attackPower: int('attack_power').notNull().default(10),
  attackSpeed: int('attack_speed').notNull().default(100),
  moveSpeed: int('move_speed').notNull().default(100),
  dashCooldown: int('dash_cooldown').notNull().default(5000),
  ultimatePower: int('ultimate_power').notNull().default(30),
  ultimateCooldown: int('ultimate_cooldown').notNull().default(30000),
  maxHp: int('max_hp').notNull().default(100),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_ms_player_id').on(table.playerId),
]);

/** battle_sessions — 전투 세션 상태 (서버 권위) */
export const battleSessions = mysqlTable('battle_sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull().default(''),
  stageId: varchar('stage_id', { length: 36 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  coreEnergy: int('core_energy').notNull().default(0),
  currentCoreEnergy: int('current_core_energy').notNull().default(0),
  battleLevel: int('battle_level').notNull().default(1),
  currentLevel: int('current_level').notNull().default(1),
  killsReported: int('kills_reported').notNull().default(0),
  totalKills: int('total_kills').notNull().default(0),
  scrapAccumulated: int('scrap_accumulated').notNull().default(0),
  scrapEarnedInSession: int('scrap_earned_in_session').notNull().default(0),
  upgradesApplied: varchar('upgrades_applied', { length: 1000 }).notNull().default('[]'),
  offeredChoices: varchar('offered_choices', { length: 1000 }).notNull().default('[]'),
  bossDefeated: varchar('boss_defeated', { length: 100 }).notNull().default('[]'),
  highestBossSequence: int('highest_boss_sequence').notNull().default(0),
  statSnapshot: varchar('stat_snapshot', { length: 2000 }).notNull().default('{}'),
  loadoutSnapshot: varchar('loadout_snapshot', { length: 2000 }).notNull().default('{}'),
  researchSnapshot: varchar('research_snapshot', { length: 2000 }).notNull().default('{}'),
  baseStatsSnapshot: varchar('base_stats_snapshot', { length: 2000 }).notNull().default('{}'),
  sessionSeed: varchar('session_seed', { length: 64 }).notNull().default(''),
  randomSeed: varchar('random_seed', { length: 64 }).notNull().default(''),
  contentVersion: varchar('content_version', { length: 20 }).notNull().default('1.0.0'),
  startTime: datetime('start_time').notNull(),
  startedAt: datetime('started_at').notNull(),
  lastEventAt: datetime('last_event_at'),
  expiresAt: datetime('expires_at'),
  endTime: datetime('end_time'),
  completedAt: datetime('completed_at'),
  currentElapsedMs: int('current_elapsed_ms').notNull().default(0),
  verifiedAt: datetime('verified_at'),
  resultCode: varchar('result_code', { length: 50 }),
  rewardScrap: int('reward_scrap').notNull().default(0),
  rewardBlueprint: varchar('reward_blueprint', { length: 36 }),
  rewardPart: varchar('reward_part', { length: 36 }),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_bs_player_id').on(table.playerId),
  index('idx_bs_status').on(table.status),
]);

/** player_records — 플레이어별 최고 기록 */

/** player_stage_progress — 플레이어별 스테이지 진행도 */
export const playerStageProgress = mysqlTable('player_stage_progress', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  stageId: varchar('stage_id', { length: 36 }).notNull(),
  unlockedAt: datetime('unlocked_at'),
  firstClearedAt: datetime('first_cleared_at'),
  bestClearTimeMs: int('best_clear_time_ms'),
  highestBossSequence: int('highest_boss_sequence').notNull().default(0),
  clearCount: int('clear_count').notNull().default(0),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_psp_player_stage').on(table.playerId, table.stageId),
  unique('uq_psp_player_stage').on(table.playerId, table.stageId),
]);

/** player_records — 플레이어별 최고 기록 */
export const playerRecords = mysqlTable('player_records', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  stageId: varchar('stage_id', { length: 36 }).notNull(),
  bestClearTimeSec: int('best_clear_time_sec'),
  bestKillCount: int('best_kill_count').notNull().default(0),
  totalClears: int('total_clears').notNull().default(0),
  firstClearedAt: datetime('first_cleared_at'),
  lastClearedAt: datetime('last_cleared_at'),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_pr_player_stage').on(table.playerId, table.stageId),
  unique('uq_pr_player_stage').on(table.playerId, table.stageId),
]);

/** battle_events — 전투 세션 이벤트 로그 (append-only) */
export const battleEvents = mysqlTable('battle_events', {
  id: varchar('id', { length: 36 }).primaryKey(),
  battleSessionId: varchar('battle_session_id', { length: 36 }).notNull(),
  sequence: int('sequence').notNull().default(1),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  elapsedMs: int('elapsed_ms').notNull().default(0),
  payload: varchar('payload', { length: 2000 }).notNull().default('{}'),
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_be_session_id').on(table.battleSessionId),
  unique('uq_be_session_seq').on(table.battleSessionId, table.sequence),
]);

/** battle_upgrade_offers — 전투 중 강화 선택지 제공 기록 */
export const battleUpgradeOffers = mysqlTable('battle_upgrade_offers', {
  id: varchar('id', { length: 36 }).primaryKey(),
  battleSessionId: varchar('battle_session_id', { length: 36 }).notNull(),
  level: int('level').notNull().default(1),
  sequence: int('sequence').notNull().default(1),
  optionSlot: int('option_slot').notNull().default(0),
  upgradeId: varchar('upgrade_id', { length: 36 }).notNull(),
  selected: int('selected').notNull().default(0),
  selectedAt: datetime('selected_at'),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_buo_session_id').on(table.battleSessionId),
  unique('uq_buo_session_level').on(table.battleSessionId, table.level),
]);

/** battle_results — 전투 결과 및 보상 확정 기록 */
export const battleResults = mysqlTable('battle_results', {
  id: varchar('id', { length: 36 }).primaryKey(),
  battleSessionId: varchar('battle_session_id', { length: 36 }).notNull().unique(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  result: varchar('result', { length: 20 }).notNull(),
  isFirstClear: int('is_first_clear').notNull().default(0),
  verifiedElapsedMs: int('verified_elapsed_ms').notNull().default(0),
  verifiedKills: int('verified_kills').notNull().default(0),
  verifiedBossSequence: int('verified_boss_sequence').notNull().default(0),
  scrapReward: int('scrap_reward').notNull().default(0),
  rewardSummary: varchar('reward_summary', { length: 500 }).notNull().default('{}'),
  finalizedAt: datetime('finalized_at'),
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_br_session_id').on(table.battleSessionId),
]);

/** player_profiles — 플레이어 부가 정보 */

/** item_ledger — 아이템(설계도·파츠) 획득 기록 (append-only) */
export const itemLedger = mysqlTable('item_ledger', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  itemType: varchar('item_type', { length: 20 }).notNull(),
  itemId: varchar('item_id', { length: 50 }).notNull(),
  quantity: int('quantity').notNull().default(1),
  source: varchar('source', { length: 50 }).notNull(),
  referenceType: varchar('reference_type', { length: 50 }).notNull().default(''),
  referenceId: varchar('reference_id', { length: 36 }).notNull().default(''),
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_il_player_id').on(table.playerId),
  index('idx_il_user_id').on(table.userId),
  unique('uq_il_idempotency').on(table.idempotencyKey),
]);

/** account_sanctions — 계정 제재 내역 (append-only 감사) */

/** security_events — 보안·의심 이벤트 기록 */
export const securityEvents = mysqlTable('security_events', {
  id: varchar('id', { length: 36 }).primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  userId: varchar('user_id', { length: 36 }),
  playerId: varchar('player_id', { length: 36 }),
  sessionId: varchar('session_id', { length: 36 }),
  code: varchar('code', { length: 50 }).notNull().default(''),
  severity: varchar('severity', { length: 10 }).notNull().default('warn'),
  source: varchar('source', { length: 50 }).notNull().default(''),
  referenceType: varchar('reference_type', { length: 50 }).notNull().default(''),
  referenceId: varchar('reference_id', { length: 36 }).notNull().default(''),
  detail: varchar('detail', { length: 1000 }).notNull().default('{}'),
  safeDetails: varchar('safe_details', { length: 1000 }).notNull().default('{}'),
  requestId: varchar('request_id', { length: 36 }).notNull().default(''),
  occurredAt: datetime('occurred_at').notNull(),
  reviewedAt: datetime('reviewed_at'),
  reviewedByOperatorId: varchar('reviewed_by_operator_id', { length: 36 }),
  resolution: varchar('resolution', { length: 50 }).notNull().default(''),
  resolutionNote: varchar('resolution_note', { length: 200 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_se_user_id').on(table.userId),
  index('idx_se_event_type').on(table.eventType),
  index('idx_se_created_at').on(table.createdAt),
]);

/** operator_audit_logs — 운영자 행위 감사 로그 (append-only)
 *
 * beforeSummary / afterSummary: 변경 전후 요약만 저장.
 * password_hash, token, 전체 body 등 민감 원문은 저장하지 않는다.
 */

/** operator_accounts — 운영자 계정 확장 정보 */

/** operator_roles — 운영자 역할 정의 */
export const operatorRoles = mysqlTable('operator_roles', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  description: varchar('description', { length: 200 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_or_name').on(table.name),
]);

/** operator_permissions — 역할별 권한 매핑 */
export const operatorPermissions = mysqlTable('operator_permissions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 200 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_op_code').on(table.code),
]);

/** operator_role_permissions — 역할-권한 연결 (N:M) */
export const operatorRolePermissions = mysqlTable('operator_role_permissions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  roleId: varchar('role_id', { length: 36 }).notNull(),
  permissionId: varchar('permission_id', { length: 36 }).notNull(),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_orp_role').on(table.roleId),
  unique('uq_orp_role_perm').on(table.roleId, table.permissionId),
]);

/** operator_account_roles — 계정-역할 연결 (N:M) */
export const operatorAccountRoles = mysqlTable('operator_account_roles', {
  id: varchar('id', { length: 36 }).primaryKey(),
  operatorAccountId: varchar('operator_account_id', { length: 36 }).notNull(),
  roleId: varchar('role_id', { length: 36 }).notNull(),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_oar_account').on(table.operatorAccountId),
  unique('uq_oar_account_role').on(table.operatorAccountId, table.roleId),
]);

/** operator_accounts — 운영자 계정 확장 정보 */
export const operatorAccounts = mysqlTable('operator_accounts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().unique(),
  roleId: varchar('role_id', { length: 36 }).notNull().default(''),
  grantedBy: varchar('granted_by', { length: 36 }).notNull().default(''),
  grantedAt: datetime('granted_at'),
  revokedAt: datetime('revoked_at'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_oa_user_id').on(table.userId),
]);

/** operator_audit_logs — 운영자 행위 감사 로그 (append-only)
 *
 * beforeSummary / afterSummary: 변경 전후 요약만 저장.
 * password_hash, token, 전체 body 등 민감 원문은 저장하지 않는다.
 */
export const operatorAuditLogs = mysqlTable('operator_audit_logs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  operatorId: varchar('operator_id', { length: 36 }).notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  targetType: varchar('target_type', { length: 20 }).notNull().default(''),
  targetId: varchar('target_id', { length: 36 }).notNull().default(''),
  reasonCode: varchar('reason_code', { length: 50 }).notNull().default(''),
  reasonText: varchar('reason_text', { length: 200 }).notNull().default(''),
  beforeSummary: varchar('before_summary', { length: 500 }).notNull().default('{}'),
  afterSummary: varchar('after_summary', { length: 500 }).notNull().default('{}'),
  result: varchar('result', { length: 20 }).notNull().default('success'),
  detail: varchar('detail', { length: 1000 }).notNull().default('{}'),
  requestId: varchar('request_id', { length: 36 }).notNull().default(''),
  ipHash: varchar('ip_hash', { length: 64 }).notNull().default(''),
  userAgentSummary: varchar('user_agent_summary', { length: 100 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_oal_operator').on(table.operatorId),
  index('idx_oal_action').on(table.action),
  index('idx_oal_created_at').on(table.createdAt),
]);

/** account_sanctions — 계정 제재 내역 (append-only 감사) */
export const accountSanctions = mysqlTable('account_sanctions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  operatorId: varchar('operator_id', { length: 36 }).notNull(),
  revokedByOperatorId: varchar('revoked_by_operator_id', { length: 36 }),
  revokedAt: datetime('revoked_at'),
  revokeReason: varchar('revoke_reason', { length: 200 }),
  type: varchar('type', { length: 20 }).notNull(),
  reasonCode: varchar('reason_code', { length: 50 }).notNull().default(''),
  reasonText: varchar('reason_text', { length: 200 }).notNull(),
  startsAt: datetime('starts_at').notNull(),
  expiresAt: datetime('expires_at'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_as_user_id').on(table.userId),
]);

/** operator_grants — 운영자 재화·아이템 지급/보정 기록 (append-only) */
export const operatorGrants = mysqlTable('operator_grants', {
  id: varchar('id', { length: 36 }).primaryKey(),
  targetUserId: varchar('target_user_id', { length: 36 }).notNull(),
  operatorId: varchar('operator_id', { length: 36 }).notNull(),
  grantType: varchar('grant_type', { length: 50 }).notNull(),
  resourceCode: varchar('resource_code', { length: 20 }).notNull(),
  amount: int('amount').notNull(),
  reasonCode: varchar('reason_code', { length: 50 }).notNull().default(''),
  reasonText: varchar('reason_text', { length: 200 }).notNull(),
  externalReference: varchar('external_reference', { length: 200 }).notNull().default(''),
  status: varchar('status', { length: 20 }).notNull().default('completed'),
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().default(''),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_og_target_user').on(table.targetUserId),
  index('idx_og_operator').on(table.operatorId),
  unique('uq_og_idempotency').on(table.idempotencyKey),
]);

/** player_profiles — 플레이어 부가 정보 */
export const playerProfiles = mysqlTable('player_profiles', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull().unique(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  nickname: varchar('nickname', { length: 20 }).notNull(),
  highestStage: int('highest_stage').notNull().default(1),
  displayName: varchar('display_name', { length: 30 }),
  avatarUrl: varchar('avatar_url', { length: 512 }),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_pp_user_id').on(table.userId),
]);

/** parts_inventory — 플레이어 보유 파츠 */
export const partsInventory = mysqlTable('parts_inventory', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  partCode: varchar('part_code', { length: 50 }).notNull(),
  partType: varchar('part_type', { length: 10 }).notNull(),
  level: int('level').notNull().default(1),
  equipped: int('equipped').notNull().default(0),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_pi_player_id').on(table.playerId),
  unique('uq_pi_player_code').on(table.playerId, table.partCode),
]);

/** equip_slots — 플레이어 장착 상태 */
export const equipSlots = mysqlTable('equip_slots', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull().unique(),
  frame: varchar('frame', { length: 50 }).notNull().default('medium_frame'),
  weapon: varchar('weapon', { length: 50 }).notNull().default('machine_gun'),
  core: varchar('core', { length: 50 }).notNull().default('assault_core'),
  module: varchar('module', { length: 50 }).notNull().default('power_module'),
  updatedAt: datetime('updated_at').notNull(),
});

/** mecha_configs — 메카 장착 구성 프리셋 */
export const mechaConfigs = mysqlTable('mecha_configs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  name: varchar('name', { length: 50 }).notNull().default('기본 구성'),
  frame: varchar('frame', { length: 50 }).notNull().default('medium_frame'),
  weapon: varchar('weapon', { length: 50 }).notNull().default('machine_gun'),
  core: varchar('core', { length: 50 }).notNull().default('assault_core'),
  module: varchar('module', { length: 50 }).notNull().default('power_module'),
  isActive: int('is_active').notNull().default(0),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_mc_player_id').on(table.playerId),
]);

/** player_research — 플레이어 연구 진행도 */
export const playerResearch = mysqlTable('player_research', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  level: int('level').notNull().default(0),
  completed: int('completed').notNull().default(0),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
}, (table) => [
  index('idx_pr_player_id').on(table.playerId),
  unique('uq_pr_player_code').on(table.playerId, table.code),
]);

/** player_blueprints — 플레이어 보유 설계도 */
export const playerBlueprints = mysqlTable('player_blueprints', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  blueprintCode: varchar('blueprint_code', { length: 50 }).notNull(),
  acquiredAt: datetime('acquired_at').notNull(),
}, (table) => [
  index('idx_pb_player_id').on(table.playerId),
  unique('uq_pb_player_code').on(table.playerId, table.blueprintCode),
]);

/** crafting_queue — 파츠 제작 대기열 */
export const craftingQueue = mysqlTable('crafting_queue', {
  id: varchar('id', { length: 36 }).primaryKey(),
  playerId: varchar('player_id', { length: 36 }).notNull(),
  resultCode: varchar('result_code', { length: 50 }).notNull(),
  materials: varchar('materials', { length: 500 }).notNull().default('{}'),
  startedAt: datetime('started_at').notNull(),
  completesAt: datetime('completes_at').notNull(),
  completed: int('completed').notNull().default(0),
  createdAt: datetime('created_at').notNull(),
}, (table) => [
  index('idx_cq_player_id').on(table.playerId),
]);
