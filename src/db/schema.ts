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
