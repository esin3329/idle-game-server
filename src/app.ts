import { Hono } from 'hono';
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

const app = new Hono<{ Variables: { requestId: string; userId?: string } }>();

let inFlightRequests = 0;
let isReady = true;
let dbConnected = false;

/** UUID를 :id로 치환하여 path cardinality 낮춤 */
function normalizePath(path: string): string {
  return path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
}

app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/ready' || c.req.path === '/metrics') {
    return next();
  }

  const clientId = c.req.header('X-Request-Id');
  const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
  const requestId = (clientId && REQUEST_ID_REGEX.test(clientId)) ? clientId : crypto.randomUUID();
  c.set('requestId', requestId);
  c.res.headers.set('X-Request-Id', requestId);

  const start = Date.now();
  inFlightRequests++;
  await next();
  inFlightRequests--;
  const durationMs = Date.now() - start;
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

app.use('*', secureHeaders());
app.use('*', cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));
app.use('*', bodyLimit({ maxSize: 50 * 1024 }));

app.onError((err, c) => {
  const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code, requestId }, err.status as 400 | 401 | 403 | 404 | 409 | 500);
  }
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json({ error: '잘못된 JSON 형식입니다.', code: 'INVALID_JSON', requestId }, 400);
  }
  logger.error({ requestId, err });
  const message = process.env.NODE_ENV === 'production' ? '서버 내부 오류가 발생했습니다.' : err.message;
  return c.json({ error: message, code: 'INTERNAL_ERROR', requestId }, 500);
});

app.notFound((c) => {
  const requestId = c.res.headers.get('X-Request-Id') || crypto.randomUUID();
  return c.json({ error: '요청하신 경로를 찾을 수 없습니다.', code: 'ROUTE_NOT_FOUND', requestId }, 404);
});

app.get('/', (c) => c.text('Idle Game Server'));

app.get('/health', (c) => {
  const mem = process.memoryUsage();
  return c.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
    },
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
  });
});

app.get('/health/live', (c) => c.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

app.get('/ready', async (c) => {
  if (!isReady) return c.json({ status: 'not ready' }, 503);
  try {
    if (process.env.DB_HOST) {
      const { getPool } = await import('./db/connection.js');
      const pool = getPool();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
      await Promise.race([pool.query('SELECT 1'), timeoutPromise]);
      dbConnected = true;
    }
  } catch {
    if (dbConnected) logger.warn({ event: 'database_connection_lost' }, 'Database connection lost');
    dbConnected = false;
  }
  return c.json({
    status: dbConnected ? 'ready' : 'degraded',
    uptime: Math.floor(process.uptime()),
    inFlightRequests,
    checks: { database: dbConnected ? 'connected' : 'disconnected' },
  });
});

app.get('/metrics', (c) => c.json(getMetrics()));

app.route('/', routes);
app.route('/', authRoutes);
app.route('/', stagesRoutes);
app.route('/', battleRoutes);
app.route('/', partsRoutes);
app.route('/', mechaRoutes);
app.route('/', researchRoutes);
app.route('/', craftingRoutes);
app.route('/', upgradesRoutes);
app.route('/', adminRoutes);

export function markServerNotReady(): void {
  isReady = false;
}

export default app;
