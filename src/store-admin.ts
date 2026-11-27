/**
 * JSON 파일 기반 Admin 저장소 (개발/테스트용)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { promoteJsonTempFile } from './shared/json-file.js';
import { join } from 'node:path';
import type { AdminRepository, AuditLogFilter, OperatorSummary, SecurityEventFilter } from './repository.js';
import { AppError } from './shared/errors.js';
import { playerIdForUser } from './shared/player-identity.js';

const grantsFile = process.env.DATA_FILE_ADMIN_GRANTS || join(process.cwd(), 'data-admin-grants.json');
let grants: any[] = [];
let sanctions: any[] = [];
let auditLogs: any[] = [];
let securityEvents: any[] = [];
let _initialized = false;

const OPERATOR_PERMISSIONS = new Set([
  'admin.users.read',
  'admin.wallets.read',
  'admin.inventories.read',
  'admin.battles.read',
  'admin.users.write',
  'admin.sanctions.read',
  'admin.sanctions.write',
  'admin.grants.read',
  'admin.grants.create',
  'admin.grants.low',
  'admin.security.read',
  'admin.security.write',
  'admin.audit_logs.read',
]);

const SUPPORT_PERMISSIONS = new Set(['admin.users.read', 'admin.security.read']);

function loadArray(fp: string): any[] {
  if (!existsSync(fp)) return [];
  try {
    const value: unknown = JSON.parse(readFileSync(fp, 'utf-8'));
    if (!Array.isArray(value)) throw new Error('Invalid grants data');
    return value;
  } catch (err) {
    throw new Error(`Failed to load admin grants from ${fp}`, { cause: err });
  }
}
function saveArray(fp: string): void {
  const tmp = fp + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(grants, null, 2), 'utf-8');
    JSON.parse(readFileSync(tmp, 'utf-8'));
    if (existsSync(fp)) copyFileSync(fp, fp + '.bak');
    promoteJsonTempFile(tmp, fp);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    throw err;
  }
}
function ensure() {
  if (!_initialized) {
    grants = loadArray(grantsFile);
    _initialized = true;
  }
}

function parseSafeDetails(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function recordAudit(entry: {
  operatorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reasonCode: string;
  reasonText: string;
  result?: string;
}) {
  auditLogs.unshift({
    id: crypto.randomUUID(),
    operatorId: entry.operatorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reasonCode: entry.reasonCode,
    reasonText: entry.reasonText,
    result: entry.result || 'success',
    createdAt: new Date().toISOString(),
  });
}

export const jsonAdminRepo: AdminRepository = {
  async listUsers(limit, offset, search, status) {
    const { getAllUsers } = await import('./store-auth.js');
    const allUsers = getAllUsers();
    let filtered = allUsers.map((u) => ({ id: u.id, email: u.email, nickname: u.nickname, status: u.status, role: u.role, createdAt: u.createdAt }));
    if (search) filtered = filtered.filter((u) => u.nickname.includes(search) || u.email.includes(search));
    if (status) filtered = filtered.filter((u) => u.status === status);
    return { users: filtered.slice(offset, offset + limit), total: filtered.length };
  },

  async getUserDetail(userId: string) {
    const { jsonAuthRepo } = await import('./store-auth.js');
    const user = await jsonAuthRepo.findUserById(userId);
    if (user) {
      const { passwordHash: _passwordHash, ...safe } = user;
      return safe;
    }
    const { getPlayer } = await import('./store.js');
    const p = getPlayer(userId);
    if (!p) return null;
    return { id: p.id, nickname: p.nickname, electricity: p.electricity, electricityPerSecond: p.electricityPerSecond, createdAt: p.createdAt };
  },

  async getUserWallet(userId: string) {
    const playerId = await playerIdForUser(userId);
    const { jsonWalletRepo } = await import('./store-wallet.js');
    const wallet = await jsonWalletRepo.getBalance(playerId);
    if (!wallet) return null;
    return {
      playerId: wallet.playerId,
      electricity: wallet.balance,
      scrap: wallet.scrap,
      electricityPerSecond: wallet.electricityPerSecond,
      lastClaimedAt: wallet.lastClaimedAt,
    };
  },
  async getUserLedger(userId: string, limit = 50) {
    const playerId = await playerIdForUser(userId);
    const { jsonWalletRepo } = await import('./store-wallet.js');
    return jsonWalletRepo.getLedger(playerId, limit);
  },
  async getUserSecurityEvents(userId: string, limit = 50) {
    return securityEvents.filter((event) => event.userId === userId).slice(0, limit);
  },
  async getUserBattles() { return []; },

  async createSanction(data: any) {
    const now = new Date();
    const hasDuplicate = sanctions.some((sanction) =>
      sanction.userId === data.userId
      && sanction.type === data.type
      && sanction.status === 'active'
      && (!sanction.expiresAt || new Date(sanction.expiresAt) > now));
    if (hasDuplicate) {
      throw new AppError('동일한 유형의 활성 제재가 이미 존재합니다.', 409, 'DUPLICATE_SANCTION');
    }
    const sanction = {
      id: data.id || crypto.randomUUID(),
      ...data,
      startsAt: data.startsAt instanceof Date ? data.startsAt.toISOString() : (data.startsAt || now.toISOString()),
      expiresAt: data.expiresAt instanceof Date ? data.expiresAt.toISOString() : (data.expiresAt ?? null),
      status: 'active',
      createdAt: data.createdAt instanceof Date ? data.createdAt.toISOString() : now.toISOString(),
    };
    sanctions.push(sanction);
    recordAudit({
      operatorId: sanction.operatorId || '',
      action: 'account_sanctioned',
      targetType: 'user',
      targetId: sanction.userId,
      reasonCode: sanction.reasonCode || sanction.type,
      reasonText: sanction.reasonText || '',
    });
    return sanction;
  },
  async revokeSanction(sanctionId: string, operatorId: string, reason = '') {
    const idx = sanctions.findIndex((s: any) => s.id === sanctionId);
    if (idx < 0) {
      throw new AppError('제재를 찾을 수 없습니다.', 404, 'NOT_FOUND');
    }
    sanctions[idx] = {
      ...sanctions[idx],
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      revokedByOperatorId: operatorId,
      revokeReason: reason,
    };
    recordAudit({
      operatorId,
      action: 'account_unsanctioned',
      targetType: 'user',
      targetId: sanctions[idx].userId,
      reasonCode: 'sanction_revoked',
      reasonText: reason,
    });
  },

  async createGrant(data: any) {
    ensure();
    const existing = data.idempotencyKey
      ? grants.find((grant: any) => grant.idempotencyKey === data.idempotencyKey)
      : undefined;
    if (existing) {
      const sameRequest = existing.operatorId === data.operatorId
        && existing.targetUserId === data.targetUserId
        && existing.grantType === data.grantType
        && existing.amount === data.amount
        && existing.resourceCode === data.resourceCode
        && existing.reasonText === data.reasonText;
      if (!sameRequest) throw new AppError('동일한 키가 다른 지급 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
      return existing;
    }

    const id = crypto.randomUUID();
    const grant = { id, ...data, status: 'completed', createdAt: new Date().toISOString() };
    if (data.grantType === 'currency') {
      const { adjustBalance } = await import('./shared/wallet.js');
      const playerId = await playerIdForUser(data.targetUserId);
      await adjustBalance(
        playerId, data.amount, 'operator_grant', data.idempotencyKey || id,
        data.resourceCode, data.reasonText, 'operator_grant', id,
      );
    }
    grants.push(grant);
    try {
      saveArray(grantsFile);
    } catch (err) {
      grants.pop();
      throw err;
    }
    recordAudit({
      operatorId: data.operatorId,
      action: 'operator_grant',
      targetType: 'user',
      targetId: data.targetUserId,
      reasonCode: data.reasonCode || data.grantType,
      reasonText: data.reasonText || '',
    });
    return grant;
  },
  async listAuditLogs(filter: AuditLogFilter = {}) {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
    const offset = Math.max(filter.offset ?? 0, 0);
    const filtered = auditLogs.filter((log) => {
      if (filter.action && log.action !== filter.action) return false;
      if (filter.operatorId && log.operatorId !== filter.operatorId) return false;
      if (filter.targetId && log.targetId !== filter.targetId) return false;
      const created = new Date(log.createdAt);
      if (filter.startDate && created < filter.startDate) return false;
      if (filter.endDate && created > filter.endDate) return false;
      return true;
    });
    return filtered.slice(offset, offset + limit);
  },
  async listOperators(): Promise<OperatorSummary[]> {
    const { getAllUsers } = await import('./store-auth.js');
    return getAllUsers()
      .filter((u) => ['operator', 'admin', 'administrator'].includes(u.role))
      .map((u) => ({
        id: u.id,
        email: u.email,
        nickname: u.nickname,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
      }));
  },
  async createOperator(data) {
    const { jsonAuthRepo } = await import('./store-auth.js');
    const existing = await jsonAuthRepo.findUserByEmail(data.email);
    if (existing) {
      throw new AppError('이미 사용 중인 이메일입니다.', 409, 'DUPLICATE_ACCOUNT');
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await jsonAuthRepo.createUser({
      id,
      email: data.email,
      nickname: data.nickname,
      passwordHash: data.passwordHash,
      status: 'active',
      role: data.role,
      createdAt: now,
      updatedAt: now,
    });
    recordAudit({
      operatorId: data.grantedBy,
      action: 'operator_created',
      targetType: 'user',
      targetId: id,
      reasonCode: 'role_grant',
      reasonText: `Created ${data.role}: ${data.email}`,
    });
    return { id, email: data.email, role: data.role, status: 'active' };
  },
  async updateOperatorRole(targetId, role, operatorId, reason) {
    const { jsonAuthRepo } = await import('./store-auth.js');
    const user = await jsonAuthRepo.findUserById(targetId);
    if (!user) {
      throw new AppError('사용자를 찾을 수 없습니다.', 404, 'NOT_FOUND');
    }
    const oldRole = user.role;
    await jsonAuthRepo.createUser({ ...user, role, updatedAt: new Date().toISOString() });
    recordAudit({
      operatorId,
      action: 'role_changed',
      targetType: 'user',
      targetId,
      reasonCode: 'role_grant',
      reasonText: reason,
    });
    return { id: targetId, role, oldRole };
  },
  async listSecurityEvents(filter: SecurityEventFilter = {}) {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
    const offset = Math.max(filter.offset ?? 0, 0);
    const filtered = securityEvents.filter((event) => {
      if (filter.eventType && event.eventType !== filter.eventType) return false;
      if (filter.userId && event.userId !== filter.userId) return false;
      if (filter.severity && event.severity !== filter.severity) return false;
      if (filter.source && event.source !== filter.source) return false;
      const occurred = new Date(event.occurredAt);
      if (filter.startDate && occurred < filter.startDate) return false;
      if (filter.endDate && occurred > filter.endDate) return false;
      return true;
    });
    return filtered.slice(offset, offset + limit).map((e) => ({
      ...e,
      safeDetails: parseSafeDetails(e.safeDetails),
    }));
  },
  async reviewSecurityEvent(eventId, operatorId, resolution, resolutionNote) {
    const idx = securityEvents.findIndex((event) => event.id === eventId);
    if (idx < 0) return false;
    securityEvents[idx] = {
      ...securityEvents[idx],
      reviewedAt: new Date().toISOString(),
      reviewedByOperatorId: operatorId,
      resolution,
      resolutionNote: resolutionNote || '',
    };
    return true;
  },
  async getUserSanctions(userId: string) {
    return sanctions.filter((s: any) => s.userId === userId);
  },

  async suspendUser(userId: string, operatorId: string, reason: string) {
    const { jsonAuthRepo } = await import('./store-auth.js');
    const user = await jsonAuthRepo.findUserById(userId);
    const now = new Date().toISOString();
    if (user) {
      await jsonAuthRepo.createUser({ ...user, status: 'suspended', updatedAt: now });
    }
    sanctions.push({ id: crypto.randomUUID(), userId, operatorId, type: 'suspension', reasonText: reason, status: 'active', startsAt: now, createdAt: now });
    recordAudit({
      operatorId,
      action: 'user_suspended',
      targetType: 'user',
      targetId: userId,
      reasonCode: 'operator_action',
      reasonText: reason,
    });
  },
  async unsuspendUser(userId: string, operatorId: string, reason: string) {
    const { jsonAuthRepo } = await import('./store-auth.js');
    const user = await jsonAuthRepo.findUserById(userId);
    const now = new Date().toISOString();
    if (user) {
      await jsonAuthRepo.createUser({ ...user, status: 'active', updatedAt: now });
    }
    for (const s of sanctions) {
      if (s.userId === userId && s.type === 'suspension' && s.status === 'active') {
        s.status = 'revoked';
        s.revokedAt = now;
        s.revokedByOperatorId = operatorId;
        s.revokeReason = reason;
      }
    }
    recordAudit({
      operatorId,
      action: 'user_unsuspended',
      targetType: 'user',
      targetId: userId,
      reasonCode: 'operator_action',
      reasonText: reason,
    });
  },
  async getUserItems(userId: string, limit = 50) {
    const playerId = await playerIdForUser(userId);
    const { getItemLedger } = await import('./store-item-ledger.js');
    return getItemLedger(playerId, limit);
  },
  async getIdleRewardLogs(userId: string, limit = 50) {
    try {
      const playerId = await playerIdForUser(userId);
      const { getLedger } = await import('./shared/wallet.js');
      return (await getLedger(playerId, limit)).filter((e: any) => e.source === 'claim');
    } catch { return []; }
  },
  async listGrants(limit, offset, targetUserId) {
    ensure();
    let filtered = [...grants];
    if (targetUserId) filtered = filtered.filter((g: any) => g.targetUserId === targetUserId);
    filtered.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filtered.slice(offset || 0, (offset || 0) + (limit || 50));
  },
  async checkPermission(roleCode: string, permissionCode: string) {
    if (roleCode === 'admin' || roleCode === 'administrator') return true;
    if (roleCode === 'operator' || roleCode === 'game_master') return OPERATOR_PERMISSIONS.has(permissionCode);
    if (roleCode === 'viewer' || roleCode === 'support') return SUPPORT_PERMISSIONS.has(permissionCode);
    return false;
  },
};

export function seedJsonSecurityEvent(event: Record<string, unknown>): void {
  securityEvents.unshift({
    id: crypto.randomUUID(),
    safeDetails: {},
    occurredAt: new Date().toISOString(),
    reviewedAt: null,
    resolution: null,
    ...event,
  });
}

export function resetAdminStores(): void {
  grants = [];
  sanctions = [];
  auditLogs = [];
  securityEvents = [];
  _initialized = false;
}
