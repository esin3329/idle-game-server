import { and, asc, count, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/postgres-connection.js';
import { aiRuns, aiToolCalls, users } from '../db/postgres-schema.js';
import { getAdminRepo } from '../provider.js';
import { AppError } from '../shared/errors.js';
import type { AiTokenUsage, AiToolAuditInput, ClaimedAiRun, EnqueuedAiRun, EnqueueAiRunInput } from './runs.js';

const statusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'timed_out']);
const caseSchema = z.enum(['missing_reward', 'duplicate_suspected', 'battle_rejected']);
const providerSchema = z.enum(['gemini', 'huggingface']);
const now = sql`CURRENT_TIMESTAMP`;
const active = inArray(aiRuns.status, ['queued', 'running']);

async function requireOperator(operator: typeof users.$inferSelect | undefined): Promise<boolean> {
  if (!operator || operator.status !== 'active' || !['operator', 'admin', 'administrator'].includes(operator.role)) {
    throw new AppError('운영자 계정이 비활성 상태이거나 권한이 없습니다.', 403, 'FORBIDDEN');
  }
  const isAdmin = ['admin', 'administrator'].includes(operator.role);
  if (!isAdmin && !await (await getAdminRepo()).checkPermission(operator.role, 'admin.users.read')) {
    throw new AppError('AI 분석 권한이 없습니다.', 403, 'FORBIDDEN');
  }
  return isAdmin;
}

export async function enqueueAiRun(input: EnqueueAiRunInput): Promise<EnqueuedAiRun> {
  return getDb().transaction(async (tx) => {
    const [operator] = await tx.select().from(users).where(eq(users.id, input.operatorId)).for('update');
    await requireOperator(operator);
    const [existing] = await tx.select().from(aiRuns).where(and(eq(aiRuns.operatorId, input.operatorId), eq(aiRuns.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new AppError('같은 Idempotency-Key가 다른 분석 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
      return { id: existing.id, status: statusSchema.parse(existing.status), replayed: true };
    }
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.targetUserId)).limit(1);
    if (!target) throw new AppError('대상 사용자를 찾을 수 없습니다.', 404, 'NOT_FOUND');
    const [pending] = await tx.select({ count: count() }).from(aiRuns).where(and(eq(aiRuns.operatorId, input.operatorId), active));
    if (pending && pending.count > 0) throw new AppError('분석이 이미 대기 중이거나 진행 중입니다.', 429, 'AI_RUN_IN_PROGRESS');
    const [recent] = await tx.select({ count: count() }).from(aiRuns).where(and(eq(aiRuns.operatorId, input.operatorId), gte(aiRuns.createdAt, sql`CURRENT_TIMESTAMP - INTERVAL '1 hour'`)));
    if (recent && recent.count >= 10) throw new AppError('한 시간 분석 한도에 도달했습니다.', 429, 'AI_RATE_LIMITED');
    const id = crypto.randomUUID();
    await tx.insert(aiRuns).values({
      id, operatorId: input.operatorId, targetUserId: input.targetUserId, caseType: input.caseType,
      provider: input.provider, model: input.model, inputJson: JSON.stringify({ question: input.question }),
      status: 'queued', activeOperatorId: input.operatorId, idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash, promptVersion: 'gameops-v1', createdAt: now,
      deadlineAt: sql`CURRENT_TIMESTAMP + INTERVAL '10 minutes'`,
    });
    return { id, status: 'queued', replayed: false };
  });
}

export async function expireStaleAiRuns(runId?: string): Promise<void> {
  await getDb().update(aiRuns).set({
    status: 'timed_out', errorCode: 'AI_RUN_TIMEOUT', finishedAt: now, activeOperatorId: null,
    elapsedMs: sql`CASE WHEN ${aiRuns.startedAt} IS NULL THEN NULL ELSE LEAST(2147483647, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${aiRuns.startedAt})) * 1000)))::integer END`,
  }).where(and(active, lte(aiRuns.deadlineAt, now), runId ? eq(aiRuns.id, runId) : undefined));
}

export async function claimNextAiRun(runId?: string): Promise<ClaimedAiRun | null> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(aiRuns)
      .where(and(eq(aiRuns.status, 'queued'), gt(aiRuns.deadlineAt, now), runId ? eq(aiRuns.id, runId) : undefined))
      .orderBy(asc(aiRuns.createdAt), asc(aiRuns.id)).limit(1).for('update', { skipLocked: true });
    if (!row) return null;
    const run = {
      id: row.id, operatorId: row.operatorId, targetUserId: row.targetUserId,
      caseType: caseSchema.parse(row.caseType), provider: providerSchema.parse(row.provider), model: row.model, inputJson: row.inputJson,
    };
    await tx.update(aiRuns).set({ status: 'running', startedAt: now, deadlineAt: sql`CURRENT_TIMESTAMP + INTERVAL '65 seconds'` }).where(eq(aiRuns.id, row.id));
    return run;
  });
}

function safeErrorCode(code: string): string {
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'AI_RUN_FAILED';
}

export async function appendAiToolCall(runId: string, input: AiToolAuditInput): Promise<void> {
  await getDb().insert(aiToolCalls).values({
    id: crypto.randomUUID(), runId, sequence: input.sequence, toolName: input.toolName.slice(0, 64),
    sanitizedArgs: input.sanitizedArgs.slice(0, 2000), evidenceJson: JSON.stringify(input.evidence),
    elapsedMs: Math.max(0, Math.min(2_147_483_647, Math.floor(input.elapsedMs))), status: input.status,
    errorCode: input.errorCode ? safeErrorCode(input.errorCode) : null, createdAt: now,
  });
}

export async function updateAiRunTokenUsage(runId: string, tokenUsage: AiTokenUsage): Promise<void> {
  await getDb().update(aiRuns).set({ tokenUsageJson: JSON.stringify(tokenUsage) }).where(and(eq(aiRuns.id, runId), eq(aiRuns.status, 'running')));
}

export async function completeAiRun(runId: string, result: unknown, toolsUsed: string[], model: string, elapsedMs: number, tokenUsage: AiTokenUsage | null): Promise<void> {
  await getDb().update(aiRuns).set({
    status: 'succeeded', resultJson: JSON.stringify({ result, toolsUsed }), model: model.slice(0, 255),
    elapsedMs: Math.max(0, Math.floor(elapsedMs)), tokenUsageJson: tokenUsage ? JSON.stringify(tokenUsage) : null,
    finishedAt: now, activeOperatorId: null,
  }).where(and(eq(aiRuns.id, runId), eq(aiRuns.status, 'running')));
}

export async function failAiRun(runId: string, errorCode: string, elapsedMs?: number): Promise<void> {
  const code = safeErrorCode(errorCode);
  await getDb().update(aiRuns).set({
    status: code === 'AI_RUN_TIMEOUT' ? 'timed_out' : 'failed', errorCode: code,
    elapsedMs: elapsedMs === undefined ? null : Math.max(0, Math.floor(elapsedMs)), finishedAt: now, activeOperatorId: null,
  }).where(and(eq(aiRuns.id, runId), eq(aiRuns.status, 'running')));
}

function parseSaved(value: string | null): unknown {
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

export async function getAiRun(runId: string, operatorId: string, expectedTargetUserId: string) {
  await expireStaleAiRuns(runId);
  const [row] = await getDb().select().from(aiRuns).where(eq(aiRuns.id, runId)).limit(1);
  if (!row || row.targetUserId !== expectedTargetUserId) throw new AppError('분석 작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');
  const [operator] = await getDb().select().from(users).where(eq(users.id, operatorId)).limit(1);
  const isAdmin = await requireOperator(operator);
  if (!isAdmin && row.operatorId !== operatorId) throw new AppError('이 분석 작업을 조회할 권한이 없습니다.', 403, 'FORBIDDEN');
  const saved = z.object({ result: z.unknown().optional(), toolsUsed: z.array(z.string()).optional() }).safeParse(parseSaved(row.resultJson));
  const usage = z.object({ promptTokens: z.number(), completionTokens: z.number(), totalTokens: z.number() }).safeParse(parseSaved(row.tokenUsageJson));
  return {
    id: row.id, targetUserId: row.targetUserId, caseType: caseSchema.parse(row.caseType), provider: providerSchema.parse(row.provider), model: row.model,
    status: statusSchema.parse(row.status), createdAt: row.createdAt.toISOString(), startedAt: row.startedAt?.toISOString(), finishedAt: row.finishedAt?.toISOString(),
    elapsedMs: row.elapsedMs ?? undefined, errorCode: row.errorCode ?? undefined,
    tokenUsage: usage.success ? usage.data : undefined, toolsUsed: saved.success ? saved.data.toolsUsed ?? [] : [], result: saved.success ? saved.data.result : undefined,
  };
}

export async function listQueuedAiRunIds(): Promise<string[]> {
  const rows = await getDb().select({ id: aiRuns.id }).from(aiRuns)
    .where(and(eq(aiRuns.status, 'queued'), gt(aiRuns.deadlineAt, now)))
    .orderBy(asc(aiRuns.createdAt), asc(aiRuns.id)).limit(100);
  return rows.map((row) => row.id);
}
