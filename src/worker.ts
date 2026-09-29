import app from './app.js';
import { GameOpsAiWorkflow } from './gameops-workflow.js';
import { configureCloudflareEnvironment } from './cloudflare-environment.js';
import { validateProductionSecrets } from './shared/validate-secrets.js';
import { failWorkflowAiRun } from './ai/worker.js';
import { getPool } from './db/connection.js';
import { logger } from './shared/logger.js';
import { rewriteAdminApiRequest } from './cloudflare-routing.js';

export { GameOpsAiWorkflow };

let productionSecretsValidated = false;

async function startWorkflow(env: Env, runId: string): Promise<boolean> {
  try {
    await env.AI_ANALYSIS_WORKFLOW.create({ id: runId, params: { runId } });
    return true;
  } catch {
    // Replayed Idempotency-Key requests can reach the same Workflow instance.
    try {
      await env.AI_ANALYSIS_WORKFLOW.get(runId);
      return true;
    } catch {
      logger.error({ runId, event: 'ai.workflow_start_failed' }, 'Unable to start GameOps AI Workflow');
      await failWorkflowAiRun(runId, 'AI_WORKFLOW_START_FAILED').catch(() => undefined);
      return false;
    }
  }
}

async function handleReady(): Promise<Response> {
  try {
    await getPool().query('SELECT 1');
    return Response.json({ status: 'ready', checks: { database: 'connected' } });
  } catch {
    return Response.json({ status: 'not ready', checks: { database: 'disconnected' } }, { status: 503 });
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/health/live') {
      return Response.json({ status: 'ok', runtime: 'cloudflare-workers' });
    }
    if (url.pathname === '/ready') {
      configureCloudflareEnvironment(env);
      return handleReady();
    }

    const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (!isApiRequest && url.pathname !== '/metrics') {
      return env.ASSETS.fetch(request);
    }

    configureCloudflareEnvironment(env);
    if (isApiRequest && !productionSecretsValidated) {
      validateProductionSecrets({ requireMysqlRootPassword: false });
      productionSecretsValidated = true;
    }

    const internalRequest = rewriteAdminApiRequest(request);
    const response = await app.fetch(internalRequest);
    if (url.pathname === '/api/admin/ai/analyze' && request.method === 'POST' && response.ok) {
      const body = await response.clone().json().catch(() => null) as { id?: string; status?: string } | null;
      if (body?.id && body.status === 'queued') {
        const started = await startWorkflow(env, body.id);
        if (!started) {
          return Response.json({ error: 'AI 분석 작업 실행을 시작하지 못했습니다.', code: 'AI_WORKFLOW_START_FAILED' }, { status: 503 });
        }
      }
    }
    return response;
  },
};

export default worker;
