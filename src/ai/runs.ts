import { createHash } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/connection.js';
import { AppError } from '../shared/errors.js';
import { getAdminRepo } from '../provider.js';
import type { ProviderId } from './provider.js';

export type AiRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out';
export type AiCaseType = 'missing_reward' | 'duplicate_suspected' | 'battle_rejected';

export interface EnqueueAiRunInput {
  operatorId: string;
  targetUserId: string;
  caseType: AiCaseType;
  provider: ProviderId;
  model: string;
  question: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface EnqueuedAiRun {
  id: string;
  status: AiRunStatus;
  replayed: boolean;
}

export interface AiToolAuditInput {
  sequence: number;
  toolName: string;
  sanitizedArgs: string;
  evidence: unknown[];
  elapsedMs: number;
  status: 'succeeded' | 'failed';
  errorCode?: string;
}

export interface ClaimedAiRun {
  id: string;
  operatorId: string;
  targetUserId: string;
  caseType: AiCaseType;
  provider: ProviderId;
  model: string;
  inputJson: string;
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    return new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`).toISOString();
  }
  return undefined;
}

function safeErrorCode(code: string): string {
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'AI_RUN_FAILED';
}

export function hashAiRequest(input: Pick<EnqueueAiRunInput, 'targetUserId' | 'caseType' | 'provider' | 'question'>): string {
  return createHash('sha256').update(JSON.stringify({
    targetUserId: input.targetUserId,
    caseType: input.caseType,
    provider: input.provider,
    question: input.question,
  })).digest('hex');
}

export async function enqueueAiRun(input: EnqueueAiRunInput): Promise<EnqueuedAiRun> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [operatorRows] = await connection.execute<RowDataPacket[]>(
      'SELECT `id`, `role`, `status` FROM `users` WHERE `id` = ? FOR UPDATE',
      [input.operatorId],
    );
    const operator = operatorRows[0];
    if (!operator || operator.status !== 'active' || !['operator', 'admin', 'administrator'].includes(operator.role)) {
      throw new AppError('운영자 계정이 비활성 상태이거나 권한이 없습니다.', 403, 'FORBIDDEN');
    }
    if (!['admin', 'administrator'].includes(operator.role)) {
      const repo = await getAdminRepo();
      if (!await repo.checkPermission(operator.role, 'admin.users.read')) {
        throw new AppError('AI 분석 권한이 없습니다.', 403, 'FORBIDDEN');
      }
    }

    const [existingRows] = await connection.execute<RowDataPacket[]>(
      'SELECT `id`, `status`, `request_hash` FROM `ai_runs` WHERE `operator_id` = ? AND `idempotency_key` = ? LIMIT 1 FOR UPDATE',
      [input.operatorId, input.idempotencyKey],
    );
    const existing = existingRows[0];
    if (existing) {
      if (existing.request_hash !== input.requestHash) {
        throw new AppError('같은 Idempotency-Key가 다른 분석 요청에 사용되었습니다.', 409, 'IDEMPOTENCY_CONFLICT');
      }
      await connection.commit();
      return { id: existing.id, status: existing.status as AiRunStatus, replayed: true };
    }

    const [targetRows] = await connection.execute<RowDataPacket[]>(
      'SELECT `id` FROM `users` WHERE `id` = ? LIMIT 1',
      [input.targetUserId],
    );
    if (targetRows.length === 0) throw new AppError('대상 사용자를 찾을 수 없습니다.', 404, 'NOT_FOUND');

    const [activeRows] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS `count` FROM `ai_runs` WHERE `operator_id` = ? AND `status` IN ('queued', 'running')",
      [input.operatorId],
    );
    if (Number(activeRows[0]?.count || 0) > 0) {
      throw new AppError('분석이 이미 대기 중이거나 진행 중입니다.', 429, 'AI_RUN_IN_PROGRESS');
    }

    const [recentRows] = await connection.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS `count` FROM `ai_runs` WHERE `operator_id` = ? AND `created_at` >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR)',
      [input.operatorId],
    );
    if (Number(recentRows[0]?.count || 0) >= 10) {
      throw new AppError('한 시간 분석 한도에 도달했습니다.', 429, 'AI_RATE_LIMITED');
    }

    const id = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO \`ai_runs\`
        (\`id\`, \`operator_id\`, \`target_user_id\`, \`case_type\`, \`input_json\`, \`provider\`, \`model\`, \`status\`, \`active_operator_id\`, \`idempotency_key\`, \`request_hash\`, \`prompt_version\`, \`created_at\`, \`deadline_at\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, 'gameops-v1', UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))`,
      [
        id,
        input.operatorId,
        input.targetUserId,
        input.caseType,
        JSON.stringify({ question: input.question }),
        input.provider,
        input.model,
        input.operatorId,
        input.idempotencyKey,
        input.requestHash,
      ],
    );

    await connection.commit();
    return { id, status: 'queued', replayed: false };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function expireStaleAiRuns(): Promise<void> {
  await getPool().execute(
    `UPDATE \`ai_runs\`
     SET \`status\` = 'timed_out', \`error_code\` = 'AI_RUN_TIMEOUT', \`finished_at\` = UTC_TIMESTAMP(3),
         \`elapsed_ms\` = CASE WHEN \`started_at\` IS NULL THEN NULL ELSE TIMESTAMPDIFF(MICROSECOND, \`started_at\`, UTC_TIMESTAMP(3)) DIV 1000 END,
         \`active_operator_id\` = NULL
     WHERE \`status\` IN ('queued', 'running') AND \`deadline_at\` <= UTC_TIMESTAMP(3)`,
  );
}

async function claimAiRun(runId?: string): Promise<ClaimedAiRun | null> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = runId
      ? await connection.execute<RowDataPacket[]>(
        "SELECT `id`, `operator_id`, `target_user_id`, `case_type`, `provider`, `model`, `input_json` FROM `ai_runs` WHERE `id` = ? AND `status` = 'queued' AND `deadline_at` > UTC_TIMESTAMP(3) LIMIT 1 FOR UPDATE SKIP LOCKED",
        [runId],
      )
      : await connection.execute<RowDataPacket[]>(
        "SELECT `id`, `operator_id`, `target_user_id`, `case_type`, `provider`, `model`, `input_json` FROM `ai_runs` WHERE `status` = 'queued' AND `deadline_at` > UTC_TIMESTAMP(3) ORDER BY `created_at`, `id` LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
    const row = rows[0];
    if (!row) {
      await connection.commit();
      return null;
    }

    await connection.execute(
      "UPDATE `ai_runs` SET `status` = 'running', `started_at` = UTC_TIMESTAMP(3), `deadline_at` = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 65 SECOND) WHERE `id` = ? AND `status` = 'queued'",
      [row.id],
    );
    await connection.commit();
    return {
      id: row.id,
      operatorId: row.operator_id,
      targetUserId: row.target_user_id,
      caseType: row.case_type as AiCaseType,
      provider: row.provider as ProviderId,
      model: row.model,
      inputJson: row.input_json,
    };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export function claimNextAiRun(): Promise<ClaimedAiRun | null> {
  return claimAiRun();
}

export function claimAiRunById(runId: string): Promise<ClaimedAiRun | null> {
  return claimAiRun(runId);
}

export async function appendAiToolCall(runId: string, input: AiToolAuditInput): Promise<void> {
  await getPool().execute(
    `INSERT INTO \`ai_tool_calls\`
      (\`id\`, \`run_id\`, \`sequence\`, \`tool_name\`, \`sanitized_args\`, \`evidence_json\`, \`elapsed_ms\`, \`status\`, \`error_code\`, \`created_at\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      crypto.randomUUID(),
      runId,
      input.sequence,
      input.toolName.slice(0, 64),
      input.sanitizedArgs.slice(0, 2000),
      JSON.stringify(input.evidence),
      Math.max(0, Math.min(2_147_483_647, Math.floor(input.elapsedMs))),
      input.status,
      input.errorCode ? safeErrorCode(input.errorCode) : null,
    ],
  );
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function updateAiRunTokenUsage(runId: string, tokenUsage: AiTokenUsage): Promise<void> {
  await getPool().execute(
    "UPDATE `ai_runs` SET `token_usage_json` = ? WHERE `id` = ? AND `status` = 'running'",
    [JSON.stringify(tokenUsage), runId],
  );
}

export async function completeAiRun(
  runId: string,
  result: unknown,
  toolsUsed: string[],
  model: string,
  elapsedMs: number,
  tokenUsage: AiTokenUsage | null,
): Promise<void> {
  await getPool().execute<ResultSetHeader>(
    `UPDATE \`ai_runs\`
     SET \`status\` = 'succeeded', \`result_json\` = ?, \`model\` = ?, \`elapsed_ms\` = ?,
         \`token_usage_json\` = ?, \`finished_at\` = UTC_TIMESTAMP(3), \`active_operator_id\` = NULL
     WHERE \`id\` = ? AND \`status\` = 'running'`,
    [
      JSON.stringify({ result, toolsUsed }),
      model.slice(0, 255),
      Math.max(0, Math.floor(elapsedMs)),
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      runId,
    ],
  );
}

export async function failAiRun(runId: string, errorCode: string, elapsedMs?: number): Promise<void> {
  const safeCode = safeErrorCode(errorCode);
  const status = safeCode === 'AI_RUN_TIMEOUT' ? 'timed_out' : 'failed';
  await getPool().execute(
    `UPDATE \`ai_runs\`
     SET \`status\` = ?, \`error_code\` = ?, \`elapsed_ms\` = ?, \`finished_at\` = UTC_TIMESTAMP(3), \`active_operator_id\` = NULL
     WHERE \`id\` = ? AND \`status\` = 'running'`,
    [status, safeCode, elapsedMs === undefined ? null : Math.max(0, Math.floor(elapsedMs)), runId],
  );
}

/** Mark queued or running work terminal when a Cloudflare Workflow cannot safely continue it. */
export async function failAiRunForWorkflow(runId: string, errorCode: string): Promise<void> {
  const safeCode = safeErrorCode(errorCode);
  const status = safeCode === 'AI_RUN_TIMEOUT' ? 'timed_out' : 'failed';
  await getPool().execute(
    `UPDATE \`ai_runs\`
     SET \`status\` = ?, \`error_code\` = ?, \`finished_at\` = UTC_TIMESTAMP(3),
         \`elapsed_ms\` = CASE WHEN \`started_at\` IS NULL THEN NULL ELSE TIMESTAMPDIFF(MICROSECOND, \`started_at\`, UTC_TIMESTAMP(3)) DIV 1000 END,
         \`active_operator_id\` = NULL
     WHERE \`id\` = ? AND \`status\` IN ('queued', 'running')`,
    [status, safeCode, runId],
  );
}

export async function getAiRun(runId: string, operatorId: string, expectedTargetUserId: string) {
  const pool = getPool();
  await pool.execute(
    `UPDATE \`ai_runs\`
     SET \`status\` = 'timed_out', \`error_code\` = 'AI_RUN_TIMEOUT', \`finished_at\` = UTC_TIMESTAMP(3),
         \`elapsed_ms\` = CASE WHEN \`started_at\` IS NULL THEN NULL ELSE TIMESTAMPDIFF(MICROSECOND, \`started_at\`, UTC_TIMESTAMP(3)) DIV 1000 END,
         \`active_operator_id\` = NULL
     WHERE \`id\` = ? AND \`status\` IN ('queued', 'running') AND \`deadline_at\` <= UTC_TIMESTAMP(3)`,
    [runId],
  );
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT \`id\`, \`operator_id\`, \`target_user_id\`, \`case_type\`, \`provider\`, \`model\`, \`status\`,
       DATE_FORMAT(\`created_at\`, '%Y-%m-%dT%H:%i:%s.%fZ') AS \`created_at\`,
       DATE_FORMAT(\`started_at\`, '%Y-%m-%dT%H:%i:%s.%fZ') AS \`started_at\`,
       DATE_FORMAT(\`finished_at\`, '%Y-%m-%dT%H:%i:%s.%fZ') AS \`finished_at\`,
       \`elapsed_ms\`, \`result_json\`, \`error_code\`, \`token_usage_json\`
     FROM \`ai_runs\` WHERE \`id\` = ? LIMIT 1`,
    [runId],
  );
  const row = rows[0];
  if (!row || row.target_user_id !== expectedTargetUserId) throw new AppError('분석 작업을 찾을 수 없습니다.', 404, 'NOT_FOUND');

  const [operatorRows] = await pool.execute<RowDataPacket[]>(
    'SELECT `role`, `status` FROM `users` WHERE `id` = ? LIMIT 1',
    [operatorId],
  );
  const operator = operatorRows[0];
  if (!operator || operator.status !== 'active' || !['operator', 'admin', 'administrator'].includes(operator.role)) {
    throw new AppError('운영자 계정이 비활성 상태이거나 권한이 없습니다.', 403, 'FORBIDDEN');
  }
  const isAdmin = ['admin', 'administrator'].includes(operator.role);
  const repo = await getAdminRepo();
  if (!isAdmin && !await repo.checkPermission(operator.role, 'admin.users.read')) {
    throw new AppError('분석 작업 조회 권한이 없습니다.', 403, 'FORBIDDEN');
  }
  if (!isAdmin && row.operator_id !== operatorId) throw new AppError('이 분석 작업을 조회할 권한이 없습니다.', 403, 'FORBIDDEN');

  const saved = parseJson<{ result?: unknown; toolsUsed?: string[] }>(row.result_json);
  return {
    id: row.id as string,
    targetUserId: row.target_user_id as string,
    caseType: row.case_type as AiCaseType,
    provider: row.provider as ProviderId,
    model: row.model as string,
    status: row.status as AiRunStatus,
    createdAt: toIso(row.created_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    elapsedMs: row.elapsed_ms === null ? undefined : Number(row.elapsed_ms),
    errorCode: row.error_code ? String(row.error_code) : undefined,
    tokenUsage: parseJson<AiTokenUsage>(row.token_usage_json),
    toolsUsed: saved?.toolsUsed || [],
    result: saved?.result,
  };
}
