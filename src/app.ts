import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { postgresRequestTransaction } from './shared/postgres-request.js';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import routes from './routes.js';
import authRoutes from './auth.routes.js';
import battleRoutes from './battle.routes.js';
import stagesRoutes from './stages.routes.js';
import partsRoutes from './parts.routes.js';
import mechaRoutes from './mecha.routes.js';
import researchRoutes from './research.routes.js';
import craftingRoutes from './crafting.routes.js';
import upgradesRoutes from './upgrades.routes.js';
import adminRoutes from './admin.routes.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';
import { recordRequest, getMetrics } from './shared/metrics.js';

export const app = new Hono<{ Variables: { requestId: string; userId: string; role: string } }>();

let inFlightRequests = 0;

/** UUID를 :id로 치환하여 path cardinality 낮춤 */
function normalizePath(path: string): string {
  return path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
}

// ─── 요청 로깅 + 메트릭 미들웨어 ───────────────────

app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/ready' || c.req.path === '/metrics') {
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
  const durationMs = Date.now() - start;

  // 메트릭 수집
  recordRequest(normalizePath(c.req.path), c.res.status, durationMs);

  logger.info({
    requestId,
    method: c.req.method,
    path: normalizePath(c.req.path),
    status: c.res.status,
    durationMs,
    inFlight: inFlightRequests,
    ...(c.get('userId') ? { userId: c.get('userId') } : {}),
  });
});

// ─── 보안 미들웨어 ─────────────────────────────────

app.use('*', secureHeaders());

app.use('*', cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  maxAge: 86400,
}));

app.use('*', bodyLimit({ maxSize: 50 * 1024 }));
app.use('*', postgresRequestTransaction);

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

// ─── 헬스 체크 ──────────────────────────────────────

let isReady = true;
export function markNotReady(): void { isReady = false; }
let dbConnected = false;

const startedAt = Date.now();
app.get('/health', (c) => c.json({
  status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000),
  environment: process.env.NODE_ENV || 'development',
}));
app.get('/health/live', (c) => c.json({ status: 'ok' }));
app.get('/ready', async (c) => {
  if (!isReady) return c.json({ status: 'not ready' }, 503);
  try {
    if (process.env.DB_DRIVER === 'postgres') {
      const { getDb } = await import('./db/postgres-connection.js');
      await getDb().execute(sql`SELECT 1`);
      dbConnected = true;
    } else if (process.env.DB_DRIVER === 'json') {
      dbConnected = true;
    } else {
      const { getPool } = await import('./db/connection.js');
      await getPool().query('SELECT 1');
      dbConnected = true;
    }
  } catch (error) {
    dbConnected = false;
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Database readiness check failed');
  }
  return c.json({
    status: dbConnected ? 'ready' : 'degraded',
    checks: { database: dbConnected ? 'connected' : 'disconnected' },
  }, dbConnected ? 200 : 503);
});

// ─── 메트릭 ──────────────────────────────────────────

app.get('/metrics', (c) => c.json(getMetrics()));

const api = new Hono();
api.route('/', routes);
api.route('/', authRoutes);
api.route('/', stagesRoutes);
api.route('/', battleRoutes);
api.route('/', partsRoutes);
api.route('/', mechaRoutes);
api.route('/', researchRoutes);
api.route('/', craftingRoutes);
api.route('/', upgradesRoutes);
api.route('/', adminRoutes);
app.route('/api', api);
app.get('/api/health', (c) => c.json({ status: 'ok' }));
