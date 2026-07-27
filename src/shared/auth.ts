import type { Context, Next } from 'hono';
import { getPlayer } from '../store.js';
import { AppError } from './errors.js';

export class UnauthorizedError extends AppError {
  constructor(message = '인증이 필요합니다.') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '접근 권한이 없습니다.') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Bearer 토큰에서 apiKey 추출 → 플레이어 찾아서 context에 저장
 */
export async function authMiddleware(c: Context, next: Next) {
  const id = c.req.param('id')!;
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError();
  }

  const apiKey = authHeader.slice(7);
  const player = getPlayer(id);

  if (!player) {
    // UUID 검증 통과 후 여기까지 왔는데 없으면 404
    throw new AppError('플레이어를 찾을 수 없습니다.', 404, 'PLAYER_NOT_FOUND');
  }

  if (player.apiKey !== apiKey) {
    throw new ForbiddenError();
  }

  c.set('player', player);
  await next();
}
