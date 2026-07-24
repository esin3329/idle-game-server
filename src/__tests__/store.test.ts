import { describe, it, expect, beforeEach } from 'vitest';
import { createPlayer, getPlayer, getAllPlayers, updatePlayer, deletePlayer } from '../store.js';
import type { Player } from '../types.js';

beforeEach(() => {
  const players = getAllPlayers();
  for (const p of players) {
    deletePlayer(p.id);
  }
});

function makePlayer(overrides: Partial<Player> = {}): Player {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    nickname: 'test',
    electricity: 0,
    electricityPerSecond: 1,
    lastClaimedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('store', () => {
  describe('createPlayer', () => {
    it('플레이어를 생성하고 반환해야 한다', () => {
      const player = makePlayer();
      const result = createPlayer(player);
      expect(result).toEqual(player);
    });

    it('생성된 플레이어를 조회할 수 있어야 한다', () => {
      const player = makePlayer();
      createPlayer(player);
      expect(getPlayer(player.id)).toEqual(player);
    });
  });

  describe('getPlayer', () => {
    it('존재하지 않는 ID는 undefined를 반환해야 한다', () => {
      expect(getPlayer('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllPlayers', () => {
    it('빈 배열로 시작해야 한다', () => {
      expect(getAllPlayers()).toEqual([]);
    });

    it('생성된 모든 플레이어를 반환해야 한다', () => {
      const p1 = makePlayer();
      const p2 = makePlayer();
      createPlayer(p1);
      createPlayer(p2);
      expect(getAllPlayers()).toHaveLength(2);
    });
  });

  describe('updatePlayer', () => {
    it('플레이어 정보를 업데이트해야 한다', () => {
      const player = makePlayer();
      createPlayer(player);
      const updated = updatePlayer(player.id, { electricity: 100 });
      expect(updated?.electricity).toBe(100);
      expect(updated?.updatedAt).toBeDefined();
    });

    it('존재하지 않는 플레이어는 undefined를 반환해야 한다', () => {
      expect(updatePlayer('nonexistent', { electricity: 100 })).toBeUndefined();
    });
  });

  describe('deletePlayer', () => {
    it('플레이어를 삭제해야 한다', () => {
      const player = makePlayer();
      createPlayer(player);
      expect(deletePlayer(player.id)).toBe(true);
      expect(getPlayer(player.id)).toBeUndefined();
    });

    it('존재하지 않는 플레이어 삭제는 false를 반환해야 한다', () => {
      expect(deletePlayer('nonexistent')).toBe(false);
    });
  });
});
