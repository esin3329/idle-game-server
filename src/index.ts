import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import routes from './routes.js';
import authRoutes from './auth.routes.js';
import battleRoutes from './battle.routes.js';
import partsRoutes from './parts.routes.js';
import mechaRoutes from './mecha.routes.js';
import researchRoutes from './research.routes.js';
import adminRoutes from './admin.routes.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';
import { DEFAULT_PORT } from './config.js';
import { validateProductionSecrets } from './shared/validate-secrets.js';

// ─── Production secrets 검증 ──────────────────────
validateProductionSecrets();

const app = new Hono<{ Variables: { requestId: string; userId?: string } }>();

let inFlightRequests = 0;

/** UUID를 :id로 치환하여 path cardinality 낮춤 */
function normalizePath(path: string): string {
  return path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
}

// ─── 요청 로깅 미들웨어 ────────────────────────────

app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/ready') {
    return next();
  }

  // Request ID: 클라이언트 제공 또는 자동 생성. 길이·형식 검증.
  const clientId = c.req.header('X-Request-Id');
  const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
  const requestId = (clientId && REQUEST_ID_REGEX.test(clientId))
    ? clientId
    : crypto.randomUUID();
  c.set('requestId', requestId);
  c.res.headers.set('X-Request-Id', requestId);

  const start = Date.now();
  inFlightRequests++;
  await next();
  inFlightRequests--;
  logger.info({
    requestId,
    method: c.req.method,
    path: normalizePath(c.req.path),
    status: c.res.status,
    durationMs: Date.now() - start,
    inFlight: inFlightRequests,
    ...(c.get('userId') ? { userId: c.get('userId') } : {}),
  });
});

// ─── 보안 미들웨어 ─────────────────────────────────

app.use('*', secureHeaders());

app.use('*', cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

app.use('*', bodyLimit({ maxSize: 50 * 1024 }));

// ─── 에러 처리 ─────────────────────────────────────

app.onError((err, c) => {
  const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code, requestId },
      err.status as 400 | 401 | 403 | 404 | 409 | 500,
    );
  }

  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json(
      { error: '잘못된 JSON 형식입니다.', code: 'INVALID_JSON', requestId },
      400,
    );
  }

  logger.error({ requestId, err });
  const message =
    process.env.NODE_ENV === 'production'
      ? '서버 내부 오류가 발생했습니다.'
      : err.message;
  return c.json({ error: message, code: 'INTERNAL_ERROR', requestId }, 500);
});

app.notFound((c) => {
  const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();
  return c.json(
    { error: '요청하신 경로를 찾을 수 없습니다.', code: 'ROUTE_NOT_FOUND', requestId },
    404,
  );
});

// ─── 라우트 ────────────────────────────────────────

app.get('/', (c) => c.text('Idle Game Server'));
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/health/live', (c) => c.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

let isReady = true;
let dbConnected = false;

app.get('/ready', async (c) => {
  if (!isReady) {
    return c.json({ status: 'not ready' }, 503);
  }

  // DB 연결 상태 확인 (3초 timeout)
  try {
    if (process.env.DB_HOST) {
      const { getPool } = await import('./db/connection.js');
      const pool = getPool();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
      await Promise.race([pool.query('SELECT 1'), timeoutPromise]);
      dbConnected = true;
    }
  } catch {
    if (dbConnected) {
      logger.warn({ event: 'database_connection_lost' }, 'Database connection lost');
    }
    dbConnected = false;
  }

  return c.json({
    status: dbConnected ? 'ready' : 'degraded',
    uptime: Math.floor(process.uptime()),
    checks: {
      database: dbConnected ? 'connected' : 'disconnected',
    },
  });
});

app.route('/', routes);
app.route('/', authRoutes);
app.route('/', battleRoutes);
app.route('/', partsRoutes);
app.route('/', mechaRoutes);
app.route('/', researchRoutes);
app.route('/', adminRoutes);

// ─── 서버 시작 ─────────────────────────────────────

const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Server running on http://localhost:${info.port}`);
});

// ─── Graceful Shutdown ─────────────────────────────

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  isReady = false;

  // 10초 후 강제 종료
  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);

  server.close(async () => {
    clearTimeout(forceExit);
    // DB 연결 풀 정리
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

// ─── Unhandled rejection / exception ─────────────────

process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandled_rejection', reason: reason instanceof Error ? reason.message : String(reason) }, 'Unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ event: 'uncaught_exception', error: err.message }, 'Uncaught exception, shutting down');
  isReady = false;
  server.close(() => process.exit(1));
});
