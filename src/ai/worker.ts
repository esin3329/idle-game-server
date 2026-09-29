import { logger } from '../shared/logger.js';
import { AppError } from '../shared/errors.js';
import { analysisInputSchema, analyzeGameOpsIssue } from './game-ops.js';
import {
  appendAiToolCall,
  claimNextAiRun,
  completeAiRun,
  expireStaleAiRuns,
  failAiRun,
  updateAiRunTokenUsage,
  type ClaimedAiRun,
} from './runs.js';

const POLL_INTERVAL_MS = 2_000;
let pollTimer: NodeJS.Timeout | undefined;
let pollInProgress = false;
let lastPollErrorAt = 0;

async function executeRun(run: ClaimedAiRun): Promise<void> {
  const startedAt = Date.now();
  try {
    let savedInput: unknown;
    try { savedInput = JSON.parse(run.inputJson); }
    catch { throw new AppError('저장된 분석 요청을 읽을 수 없습니다.', 500, 'AI_INVALID_RUN_INPUT'); }

    const parsed = analysisInputSchema.safeParse({
      ...(savedInput && typeof savedInput === 'object' ? savedInput : {}),
      targetUserId: run.targetUserId,
      caseType: run.caseType,
      provider: run.provider,
    });
    if (!parsed.success) throw new AppError('저장된 분석 요청 형식이 올바르지 않습니다.', 500, 'AI_INVALID_RUN_INPUT');

    const analysis = await analyzeGameOpsIssue(
      parsed.data,
      run.operatorId,
      (toolCall) => appendAiToolCall(run.id, toolCall),
      (usage) => updateAiRunTokenUsage(run.id, usage),
    );
    await completeAiRun(
      run.id,
      analysis.result,
      analysis.toolsUsed,
      analysis.model || run.model,
      Date.now() - startedAt,
      analysis.tokenUsage,
    );
    logger.info({ runId: run.id, operatorId: run.operatorId, provider: run.provider, elapsedMs: Date.now() - startedAt, event: 'ai.game_ops_analysis_completed' }, 'GameOps AI analysis completed');
  } catch (error) {
    const errorCode = error instanceof AppError ? error.code : 'AI_RUN_FAILED';
    try {
      await failAiRun(run.id, errorCode, Date.now() - startedAt);
    } catch (persistenceError) {
      logger.error({ runId: run.id, error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError), event: 'ai.run_failure_not_persisted' }, 'Unable to persist failed GameOps AI run');
    }
    logger.warn({ runId: run.id, operatorId: run.operatorId, errorCode, elapsedMs: Date.now() - startedAt, event: 'ai.game_ops_analysis_failed' }, 'GameOps AI analysis failed');
  }
}

async function poll(): Promise<void> {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    await expireStaleAiRuns();
    const run = await claimNextAiRun();
    if (run) await executeRun(run);
    lastPollErrorAt = 0;
  } catch (error) {
    const now = Date.now();
    if (now - lastPollErrorAt >= 30_000) {
      logger.error({ error: error instanceof Error ? error.message : String(error), event: 'ai.run_worker_poll_failed' }, 'GameOps AI queue poll failed');
      lastPollErrorAt = now;
    }
  } finally {
    pollInProgress = false;
  }
}

export function startAiRunWorker(): void {
  if (process.env.DB_DRIVER === 'json' || pollTimer) return;
  pollTimer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
  void poll();
}

export function stopAiRunWorker(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
}
