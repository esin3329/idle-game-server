import { serve } from '@hono/node-server';
import { app, markNotReady } from './app.js';
import { logger } from './shared/logger.js';
import { DEFAULT_PORT } from './config.js';
import { validateProductionSecrets } from './shared/validate-secrets.js';
import { startAiRunWorker, stopAiRunWorker } from './ai/worker.js';

validateProductionSecrets();
const port = Number(process.env.PORT || DEFAULT_PORT);
const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`Server running on http://localhost:${info.port}`);
});
startAiRunWorker();
async function shutdown(): Promise<void> {
  markNotReady();
  stopAiRunWorker();
  server.close();
  const { closePool } = await import('./db/connection.js');
  const { closePostgresPool } = await import('./db/postgres-connection.js');
  await Promise.all([closePool(), closePostgresPool()]);
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
