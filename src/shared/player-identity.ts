import { getAuthRepo } from '../provider.js';
import { AppError } from './errors.js';

/** Resolve a user's canonical player ID, retaining legacy rows that used userId as playerId. */
export async function playerIdForUser(userId: string): Promise<string> {
  const profile = await (await getAuthRepo()).findProfileByUserId(userId);
  return profile?.playerId ?? userId;
}

export async function requirePlayerOwnership(userId: string, requestedPlayerId: string): Promise<string> {
  const playerId = await playerIdForUser(userId);
  if (playerId !== requestedPlayerId) {
    throw new AppError('본인 플레이어만 변경할 수 있습니다.', 403, 'FORBIDDEN');
  }
  return playerId;
}
