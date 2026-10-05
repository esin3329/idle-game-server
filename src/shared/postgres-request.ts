import type { Context, Next } from 'hono';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, withPostgresTransaction } from '../db/postgres-connection.js';
import { getAuthRepo } from '../provider.js';
import { AppError } from './errors.js';
import { jwtAuth } from './jwt-auth.js';

class RollbackResponse extends Error {}

export async function postgresRequestTransaction(c: Context<{ Variables: { userId: string } }>, next: Next): Promise<void> {
  if (process.env.DB_DRIVER !== 'postgres' || ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    await next();
    return;
  }
  const transact = async (): Promise<void> => {
    try {
      await withPostgresTransaction(async () => {
        const scope = c.get('userId') || createHash('sha256').update(await c.req.raw.clone().text()).digest('hex');
        await getDb().execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'request:' + scope}, 0))`);
        const requestedPlayer = /^\/api\/players\/([^/]+)(?:\/|$)/.exec(c.req.path)?.[1];
        if (requestedPlayer && c.get('userId')) {
          const profile = await (await getAuthRepo()).findProfileByUserId(c.get('userId'));
          if (profile?.playerId !== requestedPlayer) throw new AppError('본인 플레이어만 변경할 수 있습니다.', 403, 'FORBIDDEN');
        }
        await next();
        if (c.res.status >= 400) throw new RollbackResponse();
      });
    } catch (error) {
      if (!(error instanceof RollbackResponse)) throw error;
    }
  };
  const authEndpoint = /^\/(?:api\/)?auth\/(login|register|refresh|logout)$/.test(c.req.path);
  if (!authEndpoint && c.req.header('Authorization')?.startsWith('Bearer ')) {
    await jwtAuth(c, transact);
  } else {
    await transact();
  }
}


