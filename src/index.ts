import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import routes from './routes.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';
import { DEFAULT_PORT } from './config.js';

const app = new Hono<{ Variables: { requestId: string; userId?: string } }>();

// ─── 요청 로깅 미들웨어 ────────────────────────────

app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/ready') {
    return next();
  }

  // Request ID: 클라이언트 제공 또는 자동 생성
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.set('requestId', requestId);
  c.res.headers.set('X-Request-Id', requestId);

  const start = Date.now();
  await next();
  logger.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
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
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code },
      err.status as 400 | 401 | 403 | 404 | 409 | 500,
    );
  }

  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json(
      { error: '잘못된 JSON 형식입니다.', code: 'INVALID_JSON' },
      400,
    );
  }

  logger.error(err);
  const message =
    process.env.NODE_ENV === 'production'
      ? '서버 내부 오류가 발생했습니다.'
      : err.message;
  return c.json({ error: message, code: 'INTERNAL_ERROR' }, 500);
});

app.notFound((c) => {
  return c.json(
    { error: '요청하신 경로를 찾을 수 없습니다.', code: 'ROUTE_NOT_FOUND' },
    404,
  );
});

// ─── 라우트 ────────────────────────────────────────

app.get('/', (c) => c.text('Idle Game Server'));
app.get('/health', (c) => c.json({ status: 'ok' }));

let isReady = true;
let dbConnected = false;

app.get('/ready', async (c) => {
  if (!isReady) {
    return c.json({ status: 'not ready' }, 503);
  }

  // DB 연결 상태 확인
  try {
    if (process.env.DB_HOST) {
      const { getPool } = await import('./db/connection.js');
      const pool = getPool();
      await pool.query('SELECT 1');
      dbConnected = true;
    }
  } catch {
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

// ─── 서버 시작 ─────────────────────────────────────

const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Server running on http://localhost:${info.port}`);
});

// ─── Graceful Shutdown ─────────────────────────────

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down...`);
  isReady = false;
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
