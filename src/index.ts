import { serve } from '@hono/node-server';
import app, { markServerNotReady } from './app.js';
import { logger } from './shared/logger.js';
import { DEFAULT_PORT } from './config.js';
import { validateProductionSecrets } from './shared/validate-secrets.js';
import { startAiRunWorker, stopAiRunWorker } from './ai/worker.js';

validateProductionSecrets();

const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Server running on http://localhost:${info.port}`);
});
startAiRunWorker();

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  markServerNotReady();
  stopAiRunWorker();

  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);

  server.close(async () => {
    clearTimeout(forceExit);
    try {
      const { closePool } = await import('./db/connection.js');
      await closePool();
    } catch { /* DB 연결 없을 수 있음 */ }
    logger.info('Server closed');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandled_rejection', reason: reason instanceof Error ? reason.message : String(reason) }, 'Unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ event: 'uncaught_exception', error: err.message }, 'Uncaught exception, shutting down');
  markServerNotReady();
  stopAiRunWorker();
  server.close(() => process.exit(1));
});
