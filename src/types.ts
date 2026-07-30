/** 저장소 모델: 데이터 저장/조회 전용 */
export interface Player {
  id: string;
  nickname: string;
  apiKey: string;
  electricity: number;
  electricityPerSecond: number;
  lastClaimedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** 사용자 계정 */
export interface User {
  id: string;
  email: string;
  nickname: string;
  passwordHash: string;
  status: string;
  role: string;
  suspendedAt?: string;
  suspendedReason?: string;
  refreshToken?: string;
  createdAt: string;
  updatedAt: string;
}

/** Refresh 세션 */
export interface RefreshSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
}

/** 계정 제재 */
export interface Sanction {
  id: string;
  userId: string;
  type: string;
  status: string;
  reasonText: string;
  startsAt: string;
  expiresAt?: string;
  createdAt: string;
}

/** 플레이어 프로필 */
export interface PlayerProfile {
  id: string;
  playerId: string;
  userId: string;
  nickname: string;
  highestStage: number;
  createdAt: string;
  updatedAt: string;
}

/** 지갑 잔액 */
export interface WalletBalance {
  id: string;
  playerId: string;
  userId: string;
  currency: string;
  electricity: number;
  electricityPerSecond: number;
  scrap: number;
  balance: number;
  lastClaimedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** 재화 원장 (currency_ledger) */
export interface CurrencyLedger {
  id: string;
  playerId: string;
  userId: string;
  currency: string;
  amount: number;
  balanceAfter: number;
  source: string;
  reason: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  requestHash: string;
  createdAt: string;
}

// ─── 파츠(Part) 시스템 ───────────────────────────

/** 파츠 인벤토리 — 플레이어가 보유한 파츠 */
export interface PlayerPart {
  id: string;
  playerId: string;
  partCode: string;       // data/parts.ts의 code
  partType: 'frame' | 'weapon' | 'core' | 'module';
  level: number;
  equipped: 0 | 1;
  createdAt: string;
}

/** 플레이어 장착 상태 — 각 슬롯에 장착된 파츠 */
export interface EquipSlot {
  id: string;
  playerId: string;
  frame: string;          // partCode
  weapon: string;
  core: string;
  module: string;
  updatedAt: string;
}

/** 파츠 합성 재료 */
export interface PartCrafting {
  id: string;
  playerId: string;
  resultCode: string;
  materials: string;      // JSON: {code: qty, ...}
  startedAt: string;
  completesAt: string;
  completed: 0 | 1;
  createdAt: string;
}
