export interface User {
  id: string;
  email: string;
  nickname: string;
  status: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  playerId?: string;
  suspendedAt?: string;
  suspendedReason?: string;
}

export interface UserDetail extends User {
  wallet?: {
    electricity: number;
    scrap: number;
    balance: number;
  };
  profile?: {
    nickname: string;
    highestStage: number;
  };
}

export interface WalletLedgerEntry {
  id: string;
  playerId: string;
  currency: string;
  amount: number;
  balanceAfter: number;
  source: string;
  createdAt: string;
}

export interface ItemLedgerEntry {
  id: string;
  itemType: string;
  itemId: string;
  quantity: number;
  source: string;
  createdAt: string;
}

export interface Sanction {
  id: string;
  userId: string;
  operatorId: string;
  type: string;
  reasonCode: string;
  reasonText: string;
  status: string;
  startsAt: string;
  expiresAt?: string;
  createdAt: string;
}

export interface Grant {
  id: string;
  targetUserId: string;
  operatorId: string;
  grantType: string;
  resourceCode: string;
  amount: number;
  reasonText: string;
  status: string;
  createdAt: string;
}

export interface SecurityEvent {
  id: string;
  eventType: string;
  userId?: string;
  playerId?: string;
  sessionId?: string;
  code: string;
  severity: string;
  source: string;
  occurredAt: string;
  reviewedAt?: string;
  resolution: string;
}

export interface AuditLog {
  id: string;
  operatorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reasonCode: string;
  reasonText: string;
  result: string;
  createdAt: string;
}

export interface Battle {
  id: string;
  stageId: string;
  status: string;
  totalKills: number;
  rewardScrap: number;
  startTime: string;
  endTime?: string;
}

export interface AuthResult {
  userId: string;
  playerId: string;
  accessToken: string;
  refreshToken: string;
}

export interface PaginatedResponse<T> {
  limit: number;
  offset: number;
  total: number;
}
