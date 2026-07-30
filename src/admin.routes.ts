import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { operatorAuth, requirePermission } from './shared/jwt-auth.js';
import { idempotencyGuard } from './shared/idempotency.js';
import { logger, auditLog } from './shared/logger.js';
import { getAdminRepo } from './provider.js';
import { AppError } from './shared/errors.js';
import { getDb } from './db/connection.js';
import { users, accountSanctions, securityEvents, operatorAuditLogs, operatorAccounts } from './db/schema.js';
import { eq, and, or, gte, lte } from 'drizzle-orm';

const adminRoutes = new Hono<{ Variables: { userId: string; role: string } }>();

// 운영 API CORS: localhost만 허용
adminRoutes.use('/admin/*', cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  maxAge: 3600,
}));

// 모든 운영 API에 operatorAuth 적용
adminRoutes.use('/admin/*', operatorAuth);

// ─── 권한 검증 헬퍼 ────────────────────────────────

async function checkPerm(c: any, permission: string) {
  const role = c.get('role');
  if (role === 'admin' || role === 'administrator') return;
  const repo = await getAdminRepo();
  const ok = await repo.checkPermission(role, permission);
  if (!ok) throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
}

// ─── GET /admin/users ───────────────────────────────

adminRoutes.get('/admin/users', async (c) => {
  await checkPerm(c, 'admin.users.read');
  const repo = await getAdminRepo();
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0);
  const search = c.req.query('search');
  const statusFilter = c.req.query('status');

  const { users: rows, total } = await repo.listUsers(limit, offset, search, statusFilter);

  return c.json({ users: rows, limit, offset, total });
});

// ─── GET /admin/users/:id ────────────────────────────

adminRoutes.get('/admin/users/:id', async (c) => {
  await checkPerm(c, 'admin.users.read');
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const user = await repo.getUserDetail(userId);
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  return c.json(user);
});

// ─── GET /admin/users/:id/wallet-ledger ──────────────

adminRoutes.get('/admin/users/:id/wallet-ledger', async (c) => {
  await checkPerm(c, 'admin.wallets.read');
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const ledger = await repo.getUserLedger(userId);
  return c.json({ ledger });
});

// ─── GET /admin/users/:id/item-ledger ────────────────

adminRoutes.get('/admin/users/:id/item-ledger', async (c) => {
  await checkPerm(c, 'admin.inventories.read');
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const items = await repo.getUserItems(userId);
  return c.json({ items });
});

// ─── GET /admin/users/:id/battles ────────────────────

adminRoutes.get('/admin/users/:id/battles', async (c) => {
  await checkPerm(c, 'admin.battles.read');
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const battles = await repo.getUserBattles(userId);
  return c.json({ battles });
});

// ─── PUT /admin/users/:id/suspend ─────────────────────

adminRoutes.put('/admin/users/:id/suspend', idempotencyGuard, async (c) => {
  await checkPerm(c, 'admin.sanctions.write');
  const targetId = c.req.param('id')!;
  const operatorId = c.get('userId');
  const { reason } = await c.req.json();
  if (!reason || reason.length < 1) return c.json({ error: '사유가 필요합니다.', code: 'BAD_REQUEST' }, 400);
  const repo = await getAdminRepo();
  const user = await repo.getUserDetail(targetId);
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  await repo.suspendUser(targetId, operatorId, reason);
  logger.info({ operatorId, targetId, reason, event: 'user_suspended' });
  return c.json({ status: 'suspended' });
});

// ─── PUT /admin/users/:id/unsuspend ───────────────────

adminRoutes.put('/admin/users/:id/unsuspend', idempotencyGuard, async (c) => {
  await checkPerm(c, 'admin.sanctions.write');
  const targetId = c.req.param('id')!;
  const operatorId = c.get('userId');
  const { reason } = await c.req.json();
  if (!reason || reason.length < 1) return c.json({ error: '사유가 필요합니다.', code: 'BAD_REQUEST' }, 400);
  const repo = await getAdminRepo();
  const user = await repo.getUserDetail(targetId);
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  await repo.unsuspendUser(targetId, operatorId, reason);
  logger.info({ operatorId, targetId, reason, event: 'user_unsuspended' });
  return c.json({ status: 'active' });
});

// ─── GET /admin/users/:id/sanctions ───────────────────

adminRoutes.get('/admin/users/:id/sanctions', async (c) => {
  await checkPerm(c, 'admin.sanctions.read');
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const sanctions = await repo.getUserSanctions(userId);
  return c.json({ sanctions });
});

// ─── POST /admin/users/:id/sanctions ──────────────────

adminRoutes.post('/admin/users/:id/sanctions', idempotencyGuard, requirePermission('admin.users.write'), async (c) => {
  const db = getDb();
  const userId = c.req.param('id')!;
  const operatorId = c.get('userId');
  const now = new Date();

  const { type, reasonCode, reasonText, expiresAt: expStr } = await c.req.json<{
    type: string; reasonCode?: string; reasonText: string; expiresAt?: string;
  }>();

  const ALLOWED_TYPES = ['suspension', 'battle_restriction', 'reward_restriction'];
  if (!ALLOWED_TYPES.includes(type)) {
    return c.json({ error: '지원하지 않는 제재 유형입니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (!reasonText || reasonText.length < 5) {
    return c.json({ error: '충분한 사유가 필요합니다 (5자 이상).', code: 'BAD_REQUEST' }, 400);
  }

  // 대상 사용자 존재 확인
  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  }

  // 만료일 검증
  if (expStr) {
    const expDate = new Date(expStr);
    if (isNaN(expDate.getTime())) {
      return c.json({ error: '유효하지 않은 만료일입니다.', code: 'BAD_REQUEST' }, 400);
    }
    if (expDate <= now) {
      return c.json({ error: '만료일은 현재 이후여야 합니다.', code: 'BAD_REQUEST' }, 400);
    }
    const maxExpiry = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
    if (expDate > maxExpiry) {
      return c.json({ error: '최대 제재 기간은 365일입니다.', code: 'BAD_REQUEST' }, 400);
    }
  }

  const sanctionId = crypto.randomUUID();
  await db.insert(accountSanctions).values({
    id: sanctionId,
    userId,
    operatorId,
    type,
    reasonCode: reasonCode || type,
    reasonText,
    startsAt: now,
    expiresAt: expStr ? new Date(expStr) : null,
    status: 'active',
    createdAt: now,
  });

  auditLog.warn({ operatorId, userId, type, reasonText, sanctionId, event: 'account.sanctioned' }, `Sanction ${type} for ${userId}`);
  return c.json({ id: sanctionId, type, status: 'active' }, 201);
});

// ─── PUT /admin/users/:id/sanctions/:sanctionId/revoke ─

adminRoutes.put('/admin/users/:id/sanctions/:sanctionId/revoke', idempotencyGuard, async (c) => {
  await checkPerm(c, 'admin.sanctions.write');
  const sanctionId = c.req.param('sanctionId')!;
  const operatorId = c.get('userId');
  const { reason } = await c.req.json();
  if (!reason || reason.length < 1) return c.json({ error: '사유가 필요합니다.', code: 'BAD_REQUEST' }, 400);
  const repo = await getAdminRepo();
  await repo.revokeSanction(sanctionId, operatorId, reason);
  auditLog.info({ operatorId, sanctionId, reason, event: 'account.unsanctioned' });
  return c.json({ status: 'revoked' });
});

// ─── POST /admin/users/:id/grants ────────────────────

adminRoutes.post('/admin/users/:id/grants', idempotencyGuard, async (c) => {
  await checkPerm(c, 'admin.grants.low');
  const operatorId = c.get('userId');
  const targetUserId = c.req.param('id')!;

  const { resourceType, resourceCode, amount, reasonText, externalReference } = await c.req.json();
  if (!resourceType || !resourceCode) return c.json({ error: 'resourceType, resourceCode는 필수입니다.', code: 'BAD_REQUEST' }, 400);
  if (!reasonText || reasonText.length < 5) return c.json({ error: '충분한 사유가 필요합니다 (5자 이상).', code: 'BAD_REQUEST' }, 400);
  if (typeof amount !== 'number' || amount === 0) return c.json({ error: '유효한 amount가 필요합니다.', code: 'BAD_REQUEST' }, 400);

  const repo = await getAdminRepo();
  const user = await repo.getUserDetail(targetUserId);
  if (!user) return c.json({ error: '대상 사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);

  const result = await repo.createGrant({
    targetUserId, operatorId, grantType: resourceType, resourceCode, amount,
    reasonCode: resourceType, reasonText, externalReference: externalReference || '',
    status: 'completed', idempotencyKey: c.req.header('Idempotency-Key') || '',
  });

  auditLog.warn({ operatorId, targetUserId, grantType: resourceType, resourceCode, amount, reasonText, grantId: result.id, event: 'operator_grant' });
  return c.json({ status: 'completed', grantType: resourceType, resourceCode, amount, grantId: result.id }, 201);
});

// ─── GET /admin/grants ───────────────────────────────

adminRoutes.get('/admin/grants', async (c) => {
  await checkPerm(c, 'admin.grants.read');
  const repo = await getAdminRepo();
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0);
  const targetUserId = c.req.query('userId');
  const grants = await repo.listGrants(limit, offset, targetUserId);
  return c.json({ grants, limit, offset });
});

// ─── GET /admin/users/:id/idle-rewards ─────────────

adminRoutes.get('/admin/users/:id/idle-rewards', async (c) => {
  await checkPerm(c, 'admin.wallets.read');
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const logs = await repo.getIdleRewardLogs(userId);
  return c.json({ idleRewards: logs });
});

adminRoutes.get('/admin/health', (c) => {
  const userId = c.get('userId');
  const role = c.get('role');
  logger.info({ userId, role, event: 'admin_health' }, 'Admin health check');
  return c.json({ status: 'ok', role });
});

export default adminRoutes;


// ─── POST /admin/operators ──────────────────────────

adminRoutes.post('/admin/operators', idempotencyGuard, requirePermission('admin.operators.manage'), async (c) => {
  const db = getDb();
  const operatorId = c.get('userId');
  const operatorRole = c.get('role');
  const now = new Date();

  if (operatorRole !== 'admin') {
    return c.json({ error: '운영자 생성은 admin만 가능합니다.', code: 'FORBIDDEN' }, 403);
  }

  const { email, password, nickname, role } = await c.req.json<{ email: string; password: string; nickname: string; role: string }>();

  if (!email || !password || !nickname) {
    return c.json({ error: 'email, password, nickname은 필수입니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: '비밀번호는 8자 이상이어야 합니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (!['operator', 'admin'].includes(role)) {
    return c.json({ error: 'role은 operator 또는 admin이어야 합니다.', code: 'BAD_REQUEST' }, 400);
  }

  const { hash } = await import('bcryptjs');
  const passwordHash = await hash(password, 10);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return c.json({ error: '이미 사용 중인 이메일입니다.', code: 'DUPLICATE_ACCOUNT' }, 409);
  }

  const newUserId = crypto.randomUUID();
  await db.insert(users).values({
    id: newUserId, email, nickname, passwordHash, role, status: 'active', createdAt: now, updatedAt: now,
  });

  await db.insert(operatorAccounts).values({
    id: crypto.randomUUID(),
    userId: newUserId,
    roleId: role,
    grantedBy: operatorId,
    grantedAt: now,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(operatorAuditLogs).values({
    id: crypto.randomUUID(),
    operatorId,
    action: 'operator_created',
    targetType: 'user',
    targetId: newUserId,
    reasonCode: 'role_grant',
    reasonText: `Created ${role}: ${email}`,
    beforeSummary: '{}',
    afterSummary: JSON.stringify({ role, email }),
    result: 'success',
    createdAt: now,
  });

  auditLog.warn({ operatorId, newUserId, email, role, event: 'operator_created' }, `New ${role} created: ${email}`);
  return c.json({ id: newUserId, email, role, status: 'active' }, 201);
});

// ─── GET /admin/operators ───────────────────────────

adminRoutes.get('/admin/operators', requirePermission('admin.operators.read'), async (c) => {
  const db = getDb();
  const rows = await db.select({
    id: users.id, email: users.email, nickname: users.nickname,
    role: users.role, status: users.status, createdAt: users.createdAt,
  }).from(users).where(or(eq(users.role, 'operator'), eq(users.role, 'admin')));

  return c.json({ operators: rows });
});

// ─── PUT /admin/operators/:id/role ──────────────────

adminRoutes.put('/admin/operators/:id/role', idempotencyGuard, requirePermission('admin.operators.manage'), async (c) => {
  const db = getDb();
  const operatorId = c.get('userId');
  const operatorRole = c.get('role');
  const targetId = c.req.param('id')!;
  const now = new Date();

  if (operatorRole !== 'admin') {
    return c.json({ error: '역할 변경은 admin만 가능합니다.', code: 'FORBIDDEN' }, 403);
  }

  const { role, reason } = await c.req.json<{ role: string; reason: string }>();
  if (!['operator', 'admin'].includes(role)) {
    return c.json({ error: 'role은 operator 또는 admin이어야 합니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (!reason || reason.length < 1) {
    return c.json({ error: '사유가 필요합니다.', code: 'BAD_REQUEST' }, 400);
  }

  const userRows = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (userRows.length === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  }

  const oldRole = userRows[0].role;
  await db.update(users).set({ role, updatedAt: now }).where(eq(users.id, targetId));

  await db.insert(operatorAuditLogs).values({
    id: crypto.randomUUID(), operatorId,
    action: 'role_changed', targetType: 'user', targetId,
    reasonCode: 'role_grant', reasonText: reason,
    beforeSummary: JSON.stringify({ role: oldRole }),
    afterSummary: JSON.stringify({ role }),
    result: 'success', createdAt: now,
  });

  auditLog.warn({ operatorId, targetId, oldRole, newRole: role, reason, event: 'operator_role_changed' }, `Role changed: ${oldRole} -> ${role}`);
  return c.json({ id: targetId, role });
});
// ─── GET /admin/security-events ──────────────────────

adminRoutes.get('/admin/security-events', requirePermission('admin.security.read'), async (c) => {
  const db = getDb();
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0);
  const eventType = c.req.query('eventType');
  const userId = c.req.query('userId');
  const severity = c.req.query('severity');
  const source = c.req.query('source');
  const startDate = c.req.query('start');
  const endDate = c.req.query('end');

  const conditions = [];
  if (eventType) conditions.push(eq(securityEvents.eventType, eventType));
  if (userId) conditions.push(eq(securityEvents.userId, userId));
  if (severity) conditions.push(eq(securityEvents.severity, severity));
  if (source) conditions.push(eq(securityEvents.source, source));
  if (startDate) conditions.push(gte(securityEvents.occurredAt, new Date(startDate)));
  if (endDate) conditions.push(lte(securityEvents.occurredAt, new Date(endDate)));

  const query = db.select().from(securityEvents);
  const rows = conditions.length > 0
    ? await query.where(and(...conditions)).limit(limit).offset(offset)
    : await query.limit(limit).offset(offset);

  return c.json({
    events: rows.map((e) => ({
      id: e.id, eventType: e.eventType, userId: e.userId,
      playerId: e.playerId, sessionId: e.sessionId,
      code: e.code, severity: e.severity, source: e.source,
      safeDetails: JSON.parse(e.safeDetails || '{}'),
      referenceType: e.referenceType, referenceId: e.referenceId,
      occurredAt: e.occurredAt, reviewedAt: e.reviewedAt,
      resolution: e.resolution,
    })),
    limit, offset,
  });
});

// ─── PUT /admin/security-events/:id/review ────────────

adminRoutes.put('/admin/security-events/:id/review', requirePermission('admin.security.write'), async (c) => {
  const db = getDb();
  const eventId = c.req.param('id')!;
  const operatorId = c.get('userId');
  const now = new Date();

  const { resolution, resolutionNote } = await c.req.json<{ resolution: string; resolutionNote?: string }>();
  if (!resolution) {
    return c.json({ error: 'resolution이 필요합니다.', code: 'BAD_REQUEST' }, 400);
  }

  await db.update(securityEvents).set({
    reviewedAt: now,
    reviewedByOperatorId: operatorId,
    resolution,
    resolutionNote: resolutionNote || '',
  }).where(eq(securityEvents.id, eventId));

  auditLog.info({ operatorId, eventId, resolution, event: 'security_event_reviewed' }, 'Security event reviewed');
  return c.json({ status: 'reviewed' });
});

// ─── GET /admin/audit-logs ───────────────────────────

adminRoutes.get('/admin/audit-logs', requirePermission('admin.audit_logs.read'), async (c) => {
  const db = getDb();
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0);
  const action = c.req.query('action');
  const operatorId = c.req.query('operator_id');
  const targetId = c.req.query('target_id');
  const startDate = c.req.query('start');
  const endDate = c.req.query('end');

  const conditions = [];
  if (action) conditions.push(eq(operatorAuditLogs.action, action));
  if (operatorId) conditions.push(eq(operatorAuditLogs.operatorId, operatorId));
  if (targetId) conditions.push(eq(operatorAuditLogs.targetId, targetId));
  if (startDate) conditions.push(gte(operatorAuditLogs.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(operatorAuditLogs.createdAt, new Date(endDate)));

  const rows = conditions.length > 0
    ? await db.select().from(operatorAuditLogs).where(and(...conditions)).limit(limit).offset(offset)
    : await db.select().from(operatorAuditLogs).limit(limit).offset(offset);

  return c.json({
    logs: rows.map((l) => ({
      id: l.id, operatorId: l.operatorId, action: l.action,
      targetType: l.targetType, targetId: l.targetId,
      reasonCode: l.reasonCode, reasonText: l.reasonText,
      result: l.result, createdAt: l.createdAt,
    })),
    limit, offset,
  });
});
