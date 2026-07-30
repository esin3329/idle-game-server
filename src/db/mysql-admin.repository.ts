/**
 * MySQL 기반 Admin 저장소
 */
import { getDb } from './connection.js';
import { users, operatorRoles, operatorRolePermissions, operatorPermissions } from './schema.js';
import { eq, and } from 'drizzle-orm';
import type { AdminRepository } from '../repository.js';

export const mysqlAdminRepo: AdminRepository = {
  async listUsers(limit, offset, search, status) {
    const db = getDb();
    let query = db.select({ id: users.id, email: users.email, nickname: users.nickname, status: users.status, role: users.role, createdAt: users.createdAt }).from(users);
    const conds: any[] = [];
    if (search) {
      const { like, or } = await import('drizzle-orm');
      conds.push(or(like(users.nickname, `%${search}%`), like(users.email, `%${search}%`)));
    }
    if (status) conds.push(eq(users.status, status));
    if (conds.length > 0) query = query.where(and(...conds)) as any;
    const rows = await query.limit(limit).offset(offset);
    return { users: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total: rows.length };
  },
  async getUserDetail(userId: string) {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] || null;
  },
  async getUserWallet() { return null; },
  async getUserLedger() { return []; },
  async getUserBattles() { return []; },
  async createSanction(d: any) { return d; },
  async revokeSanction() {},
  async createGrant(d: any) { return d; },
  async listOperators() { return []; },
  async createOperator(d: any) { return d; },
  async changeOperatorRole(id: string, r: string) { return { id, role: r }; },
  async listSecurityEvents() { return []; },
  async reviewSecurityEvent() {},
  async listAuditLogs() { return []; },
  async getUserSanctions(userId: string) {
    const db = getDb(); const { accountSanctions } = await import("./schema.js"); const { eq } = await import("drizzle-orm"); return db.select().from(accountSanctions).where(eq(accountSanctions.userId, userId));
  },
  async suspendUser(userId: string, operatorId: string, reason: string) {
    const db = getDb(); const now = new Date(); const { users, accountSanctions } = await import("./schema.js"); const { eq } = await import("drizzle-orm");
    await db.update(users).set({ status: "suspended", suspendedAt: now, suspendedReason: reason, updatedAt: now }).where(eq(users.id, userId));
    await db.insert(accountSanctions).values({ id: crypto.randomUUID(), userId, operatorId, type: "suspension", reasonCode: "operator_action", reasonText: reason, startsAt: now, status: "active", createdAt: now });
  },
  async unsuspendUser(userId: string, operatorId: string, reason: string) {
    const db = getDb(); const now = new Date(); const { users, accountSanctions } = await import("./schema.js"); const { eq, and } = await import("drizzle-orm");
    await db.update(users).set({ status: "active", suspendedAt: null, suspendedReason: null, updatedAt: now }).where(eq(users.id, userId));
    await db.update(accountSanctions).set({ status: "revoked", revokedAt: now, revokedByOperatorId: operatorId, revokeReason: reason }).where(and(eq(accountSanctions.userId, userId), eq(accountSanctions.status, "active")));
  },
  async checkPermission(roleCode: string, permissionCode: string) {
    const db = getDb();
    const roleRows = await db.select().from(operatorRoles).where(eq(operatorRoles.code, roleCode)).limit(1);
    if (roleRows.length === 0) return false;
    const permRows = await db.select().from(operatorPermissions).where(eq(operatorPermissions.code, permissionCode)).limit(1);
    if (permRows.length === 0) return false;
    const mapping = await db.select().from(operatorRolePermissions)
      .where(and(eq(operatorRolePermissions.roleId, roleRows[0].id), eq(operatorRolePermissions.permissionId, permRows[0].id))).limit(1);
    return mapping.length > 0;
  },
};
