import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { operatorAuth, requirePermission } from './shared/jwt-auth.js';
import { idempotencyGuard } from './shared/idempotency.js';
import { logger, auditLog } from './shared/logger.js';
import { getAdminRepo } from './provider.js';
import { AppError } from './shared/errors.js';
import { BATTLE_POLICY } from './shared/battle-policy.js';
import { analysisInputSchema, sanitizeQuestion } from './ai/game-ops.js';
import { listProviders } from './ai/provider.js';
import { enqueueAiRun, getAiRun, hashAiRequest } from './ai/runs.js';
import { usesSupabaseAuth } from './shared/supabase-auth.js';

const adminRoutes = new Hono<{ Variables: { userId: string; role: string; idempotencyKey: string } }>();

// 운영 API CORS: localhost만 허용
adminRoutes.use('/admin/*', cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  maxAge: 3600,
}));

// 모든 운영 API에 operatorAuth 적용
adminRoutes.use('/admin/*', operatorAuth);

async function hasAnyPermission(role: string, permissions: string[]): Promise<boolean> {
  if (role === 'admin' || role === 'administrator') return true;
  const repo = await getAdminRepo();
  for (const permission of permissions) {
    if (await repo.checkPermission(role, permission)) return true;
  }
  return false;
}

function parseOptionalDate(raw: string | undefined, paramName: string): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`유효하지 않은 날짜 형식입니다: ${paramName}`, 400, 'BAD_REQUEST');
  }
  return date;
}

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

// ─── GET /admin/users ───────────────────────────────

adminRoutes.get('/admin/users', requirePermission('admin.users.read'), async (c) => {
  const repo = await getAdminRepo();
  const limit = parseBoundedInt(c.req.query('limit'), 20, 1, 100);
  const offset = parseBoundedInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const search = c.req.query('search');
  const statusFilter = c.req.query('status');

  const { users: rows, total } = await repo.listUsers(limit, offset, search, statusFilter);

  return c.json({ users: rows, limit, offset, total });
});

// ─── GET /admin/users/:id ────────────────────────────

adminRoutes.get('/admin/users/:id', requirePermission('admin.users.read'), async (c) => {
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const user = await repo.getUserDetail(userId);
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  return c.json(user);
});

// ─── GET /admin/users/:id/wallet-ledger ──────────────

adminRoutes.get('/admin/users/:id/wallet-ledger', requirePermission('admin.wallets.read'), async (c) => {
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const ledger = await repo.getUserLedger(userId);
  return c.json({ ledger });
});

// ─── GET /admin/users/:id/item-ledger ────────────────

adminRoutes.get('/admin/users/:id/item-ledger', requirePermission('admin.inventories.read'), async (c) => {
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const items = await repo.getUserItems(userId);
  return c.json({ items });
});

// ─── GET /admin/users/:id/battles ────────────────────

adminRoutes.get('/admin/users/:id/battles', requirePermission('admin.battles.read'), async (c) => {
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const battles = await repo.getUserBattles(userId);
  return c.json({ battles });
});

// ─── PUT /admin/users/:id/suspend ─────────────────────

adminRoutes.put('/admin/users/:id/suspend', idempotencyGuard, requirePermission('admin.sanctions.write'), async (c) => {
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

adminRoutes.put('/admin/users/:id/unsuspend', idempotencyGuard, requirePermission('admin.sanctions.write'), async (c) => {
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

adminRoutes.get('/admin/users/:id/sanctions', requirePermission('admin.sanctions.read'), async (c) => {
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const sanctions = await repo.getUserSanctions(userId);
  return c.json({ sanctions });
});

// ─── POST /admin/users/:id/sanctions ──────────────────

adminRoutes.post('/admin/users/:id/sanctions', idempotencyGuard, async (c) => {
  if (!(await hasAnyPermission(c.get('role'), ['admin.sanctions.write', 'admin.users.write']))) {
    throw new AppError('권한이 없습니다.', 403, 'FORBIDDEN');
  }
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

  const repo = await getAdminRepo();
  const user = await repo.getUserDetail(userId);
  if (!user) {
    return c.json({ error: '사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  }

  // 만료일 검증
  let expiresAt: Date | null = null;
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
    expiresAt = expDate;
  }

  const sanctionId = crypto.randomUUID();
  await repo.createSanction({
    id: sanctionId,
    userId,
    operatorId,
    type,
    reasonCode: reasonCode || type,
    reasonText,
    startsAt: now,
    expiresAt,
    status: 'active',
    createdAt: now,
  });

  auditLog.warn({ operatorId, userId, type, reasonText, sanctionId, event: 'account.sanctioned' }, `Sanction ${type} for ${userId}`);
  return c.json({ id: sanctionId, type, status: 'active' }, 201);
});

// ─── PUT /admin/users/:id/sanctions/:sanctionId/revoke ─

adminRoutes.put('/admin/users/:id/sanctions/:sanctionId/revoke', idempotencyGuard, requirePermission('admin.sanctions.write'), async (c) => {
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

adminRoutes.post('/admin/users/:id/grants', idempotencyGuard, requirePermission('admin.grants.low'), async (c) => {
  const operatorId = c.get('userId');
  const role = c.get('role');
  const targetUserId = c.req.param('id')!;

  const { resourceType, resourceCode, amount, reasonText, externalReference } = await c.req.json();
  if (!resourceType || !resourceCode) return c.json({ error: 'resourceType, resourceCode는 필수입니다.', code: 'BAD_REQUEST' }, 400);
  if (resourceType !== 'currency' && resourceType !== 'item') {
    return c.json({ error: 'resourceType은 currency 또는 item이어야 합니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (resourceType === 'currency' && !['electricity', 'scrap'].includes(resourceCode)) {
    return c.json({ error: '지원하지 않는 재화입니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (!reasonText || reasonText.length < 5) return c.json({ error: '충분한 사유가 필요합니다 (5자 이상).', code: 'BAD_REQUEST' }, 400);
  if (!Number.isSafeInteger(amount) || amount === 0 || amount > BATTLE_POLICY.MAX_GRANT_AMOUNT || amount < BATTLE_POLICY.MIN_GRANT_AMOUNT) {
    return c.json({ error: '유효한 amount가 필요합니다 (-100000 ~ 100000, 0 제외).', code: 'BAD_REQUEST' }, 400);
  }

  const repo = await getAdminRepo();
  if (Math.abs(amount) >= BATTLE_POLICY.HIGH_VALUE_GRANT_THRESHOLD) {
    const canHighGrant = role === 'admin' || role === 'administrator' || await repo.checkPermission(role, 'admin.grants.high');
    if (!canHighGrant) {
      return c.json({ error: '고액 지급은 관리자 권한이 필요합니다.', code: 'FORBIDDEN' }, 403);
    }
  }

  const user = await repo.getUserDetail(targetUserId);
  if (!user) return c.json({ error: '대상 사용자를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);

  const result = await repo.createGrant({
    targetUserId, operatorId, grantType: resourceType, resourceCode, amount,
    reasonCode: resourceType, reasonText, externalReference: externalReference || '',
    status: 'completed', idempotencyKey: c.get('idempotencyKey'),
  });

  auditLog.warn({ operatorId, targetUserId, grantType: resourceType, resourceCode, amount, reasonText, grantId: result.id, event: 'operator_grant' });
  return c.json({ status: 'completed', grantType: resourceType, resourceCode, amount, grantId: result.id }, 201);
});

// ─── GET /admin/grants ───────────────────────────────

adminRoutes.get('/admin/grants', requirePermission('admin.grants.read'), async (c) => {
  const repo = await getAdminRepo();
  const limit = parseBoundedInt(c.req.query('limit'), 50, 1, 200);
  const offset = parseBoundedInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const targetUserId = c.req.query('userId');
  const grants = await repo.listGrants(limit, offset, targetUserId);
  return c.json({ grants, limit, offset });
});

// ─── GET /admin/users/:id/idle-rewards ─────────────

adminRoutes.get('/admin/users/:id/idle-rewards', requirePermission('admin.wallets.read'), async (c) => {
  const userId = c.req.param('id')!;
  const repo = await getAdminRepo();
  const logs = await repo.getIdleRewardLogs(userId);
  return c.json({ idleRewards: logs });
});

adminRoutes.get('/admin/health', (c) => {
  const userId = c.get('userId');
  const role = c.get('role');
  logger.info({ userId, role, event: 'admin_health' }, 'Admin health check');
  return c.json({ status: 'ok', userId, role, authProvider: usesSupabaseAuth() ? 'supabase' : 'local' });
});

// ─── POST /admin/operators ──────────────────────────

adminRoutes.post('/admin/operators', idempotencyGuard, requirePermission('admin.operators.manage'), async (c) => {
  const operatorId = c.get('userId');
  const operatorRole = c.get('role');

  if (!['admin', 'administrator'].includes(operatorRole)) {
    return c.json({ error: '운영자 생성은 admin만 가능합니다.', code: 'FORBIDDEN' }, 403);
  }
  if (usesSupabaseAuth()) {
    return c.json({
      error: 'Supabase Auth 사용 시 운영자 계정은 Supabase에서 먼저 생성해야 하며, 이 API로는 만들 수 없습니다.',
      code: 'SUPABASE_AUTH_OPERATOR_CREATE_UNSUPPORTED',
    }, 501);
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

  const repo = await getAdminRepo();
  const created = await repo.createOperator({ email, passwordHash, nickname, role, grantedBy: operatorId });

  auditLog.warn({ operatorId, newUserId: created.id, email, role, event: 'operator_created' }, `New ${role} created: ${email}`);
  return c.json(created, 201);
});

// ─── GET /admin/operators ───────────────────────────

adminRoutes.get('/admin/operators', requirePermission('admin.operators.read'), async (c) => {
  const repo = await getAdminRepo();
  const operators = await repo.listOperators();
  return c.json({ operators });
});

// ─── PUT /admin/operators/:id/role ──────────────────

adminRoutes.put('/admin/operators/:id/role', idempotencyGuard, requirePermission('admin.operators.manage'), async (c) => {
  const operatorId = c.get('userId');
  const operatorRole = c.get('role');
  const targetId = c.req.param('id')!;

  if (!['admin', 'administrator'].includes(operatorRole)) {
    return c.json({ error: '역할 변경은 admin만 가능합니다.', code: 'FORBIDDEN' }, 403);
  }

  const { role, reason } = await c.req.json<{ role: string; reason: string }>();
  if (!['operator', 'admin'].includes(role)) {
    return c.json({ error: 'role은 operator 또는 admin이어야 합니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (!reason || reason.length < 1) {
    return c.json({ error: '사유가 필요합니다.', code: 'BAD_REQUEST' }, 400);
  }

  const repo = await getAdminRepo();
  const updated = await repo.updateOperatorRole(targetId, role, operatorId, reason);

  auditLog.warn({ operatorId, targetId, oldRole: updated.oldRole, newRole: role, reason, event: 'operator_role_changed' }, `Role changed: ${updated.oldRole} -> ${role}`);
  return c.json({ id: updated.id, role: updated.role });
});

// ─── GET /admin/security-events ──────────────────────

adminRoutes.get('/admin/security-events', requirePermission('admin.security.read'), async (c) => {
  const limit = parseBoundedInt(c.req.query('limit'), 50, 1, 200);
  const offset = parseBoundedInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const startDate = parseOptionalDate(c.req.query('start'), 'start');
  const endDate = parseOptionalDate(c.req.query('end'), 'end');

  const repo = await getAdminRepo();
  const events = await repo.listSecurityEvents({
    limit,
    offset,
    eventType: c.req.query('eventType'),
    userId: c.req.query('userId'),
    severity: c.req.query('severity'),
    source: c.req.query('source'),
    startDate,
    endDate,
  });

  return c.json({ events, limit, offset });
});

// ─── PUT /admin/security-events/:id/review ────────────

adminRoutes.put('/admin/security-events/:id/review', requirePermission('admin.security.write'), async (c) => {
  const eventId = c.req.param('id')!;
  const operatorId = c.get('userId');

  const { resolution, resolutionNote } = await c.req.json<{ resolution: string; resolutionNote?: string }>();
  if (!resolution) {
    return c.json({ error: 'resolution이 필요합니다.', code: 'BAD_REQUEST' }, 400);
  }

  const repo = await getAdminRepo();
  const updated = await repo.reviewSecurityEvent(eventId, operatorId, resolution, resolutionNote);
  if (!updated) {
    return c.json({ error: '보안 이벤트를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404);
  }

  auditLog.info({ operatorId, eventId, resolution, event: 'security_event_reviewed' }, 'Security event reviewed');
  return c.json({ status: 'reviewed' });
});

// ─── GET /admin/audit-logs ───────────────────────────

adminRoutes.get('/admin/audit-logs', requirePermission('admin.audit_logs.read'), async (c) => {
  const limit = parseBoundedInt(c.req.query('limit'), 50, 1, 200);
  const offset = parseBoundedInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const startDate = parseOptionalDate(c.req.query('start'), 'start');
  const endDate = parseOptionalDate(c.req.query('end'), 'end');

  const repo = await getAdminRepo();
  const logs = await repo.listAuditLogs({
    limit,
    offset,
    action: c.req.query('action'),
    operatorId: c.req.query('operator_id'),
    targetId: c.req.query('target_id'),
    startDate,
    endDate,
  });

  return c.json({ logs, limit, offset });
});

// ─── GameOps AI: 읽기 전용 운영 분석 ──────────────

adminRoutes.get('/admin/ai/providers', requirePermission('admin.users.read'), async (c) => {
  return c.json({ providers: listProviders() });
});

adminRoutes.post('/admin/ai/analyze', requirePermission('admin.users.read'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = analysisInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: '분석 요청 형식이 올바르지 않습니다.', code: 'BAD_REQUEST' }, 400);
  }
  if (process.env.DB_DRIVER === 'json') {
    return c.json({ error: 'AI 분석 큐에는 PostgreSQL 저장소가 필요합니다.', code: 'AI_QUEUE_REQUIRES_POSTGRES' }, 503);
  }

  const idempotencyKey = c.req.header('Idempotency-Key') || '';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
    return c.json({ error: '유효한 Idempotency-Key가 필요합니다.', code: 'BAD_REQUEST' }, 400);
  }

  const provider = listProviders().find((item) => item.id === parsed.data.provider);
  if (!provider?.enabled) {
    return c.json({ error: '선택한 AI 제공자가 서버에 설정되지 않았습니다.', code: 'AI_PROVIDER_NOT_CONFIGURED' }, 503);
  }

  let run;
  try {
    run = await enqueueAiRun({
      operatorId: c.get('userId'),
      targetUserId: parsed.data.targetUserId,
      caseType: parsed.data.caseType,
      provider: parsed.data.provider,
      model: provider.model,
      question: sanitizeQuestion(parsed.data.question),
      idempotencyKey,
      requestHash: hashAiRequest(parsed.data),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ operatorId: c.get('userId'), error: error instanceof Error ? error.message : String(error), event: 'ai.run_enqueue_failed' }, 'Unable to enqueue GameOps AI analysis');
    return c.json({ error: 'AI 분석 작업을 저장하지 못했습니다. DB 연결과 마이그레이션 상태를 확인해 주세요.', code: 'AI_QUEUE_UNAVAILABLE' }, 503);
  }

  auditLog.info({ operatorId: c.get('userId'), targetUserId: parsed.data.targetUserId, runId: run.id, provider: parsed.data.provider, replayed: run.replayed, event: 'ai.game_ops_analysis_queued' }, 'GameOps AI analysis queued');
  return c.json(run, run.replayed ? 200 : 202);
});

adminRoutes.get('/admin/ai/runs/:id', requirePermission('admin.users.read'), async (c) => {
  if (process.env.DB_DRIVER === 'json') {
    return c.json({ error: 'AI 분석 큐에는 PostgreSQL 저장소가 필요합니다.', code: 'AI_QUEUE_REQUIRES_POSTGRES' }, 503);
  }
  const targetUserId = c.req.query('targetUserId') || '';
  if (!targetUserId) return c.json({ error: 'targetUserId가 필요합니다.', code: 'BAD_REQUEST' }, 400);
  try {
    const run = await getAiRun(c.req.param('id')!, c.get('userId'), targetUserId);
    return c.json(run);
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({ runId: c.req.param('id'), error: error instanceof Error ? error.message : String(error), event: 'ai.run_read_failed' }, 'Unable to read GameOps AI run');
    return c.json({ error: 'AI 분석 상태를 읽지 못했습니다.', code: 'AI_QUEUE_UNAVAILABLE' }, 503);
  }
});

export default adminRoutes;
