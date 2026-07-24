import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import routes from './routes.js';
import { AppError } from './shared/errors.js';
import logger from './logger.js';

const app = new Hono();

// ─── 요청 로깅 미들웨어 ────────────────────────────

app.use('*', async (c, next) => {
  const start = Date.now();
  const { method, url } = c.req;
  logger.info({ method, url }, '--> request');
  await next();
  const duration = Date.now() - start;
  logger.info({ method, url, status: c.res.status, duration: `${duration}ms` }, '<-- response');
});

// ─── 보안 미들웨어 ─────────────────────────────────

// 1. 보안 헤더
app.use('*', secureHeaders());

// 2. CORS
app.use('*', cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// 3. Body 크기 제한 (50KB)
app.use('*', bodyLimit({ maxSize: 50 * 1024 }));

// ─── 에러 처리 ─────────────────────────────────────

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code },
      err.status as 400 | 401 | 403 | 404 | 500,
    );
  }

  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json(
      { error: '잘못된 JSON 형식입니다.', code: 'INVALID_JSON' },
      400,
    );
  }

  logger.error(err, '[UNHANDLED_ERROR]');
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

// ─── 헬스 체크 ─────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));
app.get('/ready', (c) => c.json({ status: 'ok' }));

// ─── 라우트 ────────────────────────────────────────

app.get('/', (c) => c.text('Idle Game Server'));
app.route('/', routes);

// ─── 서버 시작 + Graceful Shutdown ────────────────

const server = serve(
  { fetch: app.fetch, port: Number(process.env.PORT) || 3000 },
  (info) => {
    logger.info(`Server is running on http://localhost:${info.port}`);
  },
);

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
