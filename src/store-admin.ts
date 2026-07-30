/**
 * JSON 파일 기반 Admin 저장소 (개발/테스트용)
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminRepository } from './repository.js';

const grantsFile = process.env.DATA_FILE_ADMIN_GRANTS || join(process.cwd(), 'data-admin-grants.json');
let grants: any[] = [];
let _initialized = false;

function loadArray(fp: string): any[] {
  if (!existsSync(fp)) return [];
  try { const a = JSON.parse(readFileSync(fp, 'utf-8')); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function saveArray(fp: string): void {
  const tmp = fp + '.tmp';
  try { writeFileSync(tmp, JSON.stringify(grants, null, 2), 'utf-8'); JSON.parse(readFileSync(tmp, 'utf-8')); if (existsSync(fp)) copyFileSync(fp, fp + '.bak'); renameSync(tmp, fp); }
  catch { try { if (existsSync(tmp)) unlinkSync(tmp); } catch {} }
}
function ensure() { if (!_initialized) { _initialized = true; grants = loadArray(grantsFile); } }

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
    const { getPlayer } = await import('./store.js');
    const p = getPlayer(userId);
    if (!p) return null;
    return { id: p.id, nickname: p.nickname, electricity: p.electricity, electricityPerSecond: p.electricityPerSecond, createdAt: p.createdAt };
  },

  async getUserWallet() { return null; },
  async getUserLedger() { return []; },
  async getUserBattles() { return []; },
  async getUserSanctions() { return []; },

  async createSanction(data: any) {
    ensure();
    const sanction = { id: crypto.randomUUID(), ...data, status: 'active', createdAt: new Date().toISOString() };
    grants.push(sanction);
    saveArray(grantsFile);
    return sanction;
  },
  async revokeSanction(sanctionId: string) {
    ensure();
    const idx = grants.findIndex((g: any) => g.id === sanctionId);
    if (idx >= 0) { grants[idx].status = 'revoked'; saveArray(grantsFile); }
  },

  async createGrant(data: any) {
    ensure();
    const grant = { id: crypto.randomUUID(), ...data, status: 'completed', createdAt: new Date().toISOString() };
    grants.push(grant);
    saveArray(grantsFile);
    return grant;
  },

  async listOperators() { return [{ id: 'admin', email: 'admin@local', nickname: 'Admin', role: 'admin' }]; },
  async createOperator(data: any) { return { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString() }; },
  async changeOperatorRole(operatorId: string, newRole: string) { return { id: operatorId, role: newRole }; },
  async listSecurityEvents() { return []; },
  async reviewSecurityEvent() {},
  async listAuditLogs() { return []; },
  async checkPermission() { return true; },
};
