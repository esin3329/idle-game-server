import { app } from './app.js';
import { validateProductionSecrets } from './shared/validate-secrets.js';
import { withPostgresConnection, getDb } from './db/postgres-connection.js';
import { processAiRun } from './ai/worker.js';
import { expireStaleAiRuns, listQueuedAiRunIds } from './ai/runs.js';
import { withRuntime } from './runtime.js';
import { logger } from './shared/logger.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

interface WorkerEnvironment {
  readonly ASSETS: Fetcher;
  readonly HYPERDRIVE?: Hyperdrive;
  readonly DATABASE_URL?: string;
  readonly AI_RUNS_QUEUE: Queue<{ readonly runId: string }>;
}
const queueMessage = z.object({ runId: z.string().uuid() });
function databaseUrl(env: WorkerEnvironment): string {
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url) throw new Error('HYPERDRIVE or DATABASE_URL must be configured');
  return url;
}
const worker = {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const path = new URL(request.url).pathname;
    const isApi = path === '/api' || path.startsWith('/api/') || ['/health', '/health/live', '/ready', '/metrics'].includes(path);
    if (!isApi) return env.ASSETS.fetch(request);
    if (path === '/health' || path === '/health/live' || path === '/api/health') return app.fetch(request);
    try {
      validateProductionSecrets();
      return await withPostgresConnection(databaseUrl(env), () =>
        withRuntime(env.AI_RUNS_QUEUE, async () => app.fetch(request)));
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Worker request failed');
      return Response.json({ error: '서버에 연결할 수 없습니다.', code: 'DATABASE_UNAVAILABLE' }, { status: 503 });
    }
  },
  async queue(batch: MessageBatch<unknown>, env: WorkerEnvironment): Promise<void> {
    for (const message of batch.messages) {
      const parsed = queueMessage.safeParse(message.body);
      if (!parsed.success) { message.ack(); continue; }
      await withPostgresConnection(databaseUrl(env), () => processAiRun(parsed.data.runId));
      message.ack();
    }
  },
  async scheduled(_event: ScheduledEvent, env: WorkerEnvironment): Promise<void> {
    await withPostgresConnection(databaseUrl(env), async () => {
      await expireStaleAiRuns();
      for (const runId of await listQueuedAiRunIds()) await env.AI_RUNS_QUEUE.send({ runId });
      await getDb().execute(sql`DELETE FROM game.request_idempotency WHERE expires_at <= CURRENT_TIMESTAMP`);
      await getDb().execute(sql`DELETE FROM game.request_rate_limits WHERE reset_at <= CURRENT_TIMESTAMP`);
    });
  },
};
export default worker;

