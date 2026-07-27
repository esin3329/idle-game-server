import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── 임시 디렉터리 + 주입 ───────────────────────────

const tmpDir = mkdtempSync(join(homedir() || '/tmp', `idle-game-test-store-`));

import { setDataFilePath, createPlayer, getPlayer, getAllPlayers, updatePlayer, deletePlayer } from '../store.js';
import { clearRateLimits } from '../shared/rate-limit.js';
import type { Player } from '../types.js';

// store 모듈 로드 후 명시적으로 경로 주입
setDataFilePath(join(tmpDir, 'data.json'));

// ─── 정리 ──────────────────────────────────────────

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

beforeEach(() => {
  clearRateLimits();
  const players = getAllPlayers();
  for (const p of players) {
    deletePlayer(p.id);
  }
});

// ─── 헬퍼 ──────────────────────────────────────────

function makePlayer(overrides: Partial<Player> = {}): Player {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    nickname: 'test',
    apiKey: crypto.randomUUID(),
    electricity: 0,
    electricityPerSecond: 1,
    lastClaimedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── 테스트 ────────────────────────────────────────

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

  describe('saveToFile (atomic write)', () => {
    it('파일이 존재해야 한다', () => {
      createPlayer(makePlayer());
      expect(existsSync(join(tmpDir, 'data.json'))).toBe(true);
    });

    it('저장 후 재조회 시 데이터가 유지되어야 한다', () => {
      const player = makePlayer();
      createPlayer(player);
      const reloaded = getPlayer(player.id);
      expect(reloaded).toBeDefined();
      expect(reloaded?.nickname).toBe('test');
    });

    it('id, apiKey, createdAt은 update로 덮어쓸 수 없어야 한다', () => {
      const player = makePlayer();
      createPlayer(player);
      const originalId = player.id;
      const originalApiKey = player.apiKey;
      const originalCreatedAt = player.createdAt;

      const updated = updatePlayer(player.id, {
        id: 'hacked-id',
        apiKey: 'hacked-key',
        createdAt: '2020-01-01',
        electricity: 999,
      } as Partial<Player>);

      expect(updated?.id).toBe(originalId);
      expect(updated?.apiKey).toBe(originalApiKey);
      expect(updated?.createdAt).toBe(originalCreatedAt);
      expect(updated?.electricity).toBe(999);
    });
  });

  describe('파일 저장 신뢰성', () => {
    it('저장 시 .bak 백업 파일을 생성해야 한다', () => {
      createPlayer(makePlayer());
      const bakFile = join(tmpDir, 'data.json.bak');
      expect(existsSync(bakFile)).toBe(true);
    });

    it('저장 후 .tmp 파일이 남지 않아야 한다', () => {
      createPlayer(makePlayer());
      const tmpFile = join(tmpDir, 'data.json.tmp');
      expect(existsSync(tmpFile)).toBe(false);
    });

    it('잘못된 JSON + 백업 없음 → 빈 store로 시작해야 한다', () => {
      const dataPath = join(tmpDir, 'data.json');
      const bakPath = dataPath + '.bak';

      // 메인 + 백업 모두 손상
      writeFileSync(dataPath, 'not valid json{{{{', 'utf-8');
      try { if (existsSync(bakPath)) unlinkSync(bakPath); } catch { /* ok */ }

      setDataFilePath(dataPath);
      expect(getAllPlayers()).toEqual([]);
    });

    it('필수 필드 누락 + 백업 없음 → 빈 store로 시작해야 한다', () => {
      const dataPath = join(tmpDir, 'data.json');
      const bakPath = dataPath + '.bak';

      writeFileSync(dataPath, JSON.stringify([{ id: 'x', nickname: 'bad' }]), 'utf-8');
      try { if (existsSync(bakPath)) unlinkSync(bakPath); } catch { /* ok */ }

      setDataFilePath(dataPath);
      expect(getAllPlayers()).toEqual([]);
    });

    it('메인 파일 손상 시 .bak 백업에서 복구해야 한다', () => {
      const dataPath = join(tmpDir, 'data.json');
      const bakPath = dataPath + '.bak';

      // 첫 저장 → bak에 이전 상태([]) 저장됨
      const player1 = makePlayer({ nickname: '복구1' });
      createPlayer(player1);

      // 두 번째 저장 → bak에 player1이 있는 상태로 저장됨
      const player2 = makePlayer({ nickname: '복구2' });
      createPlayer(player2);
      expect(existsSync(bakPath)).toBe(true);

      // 메인 파일만 손상
      writeFileSync(dataPath, 'corrupted{{{', 'utf-8');

      // 재로드 → bak에서 player1이 있는 이전 상태로 복구
      setDataFilePath(dataPath);
      const recovered = getAllPlayers();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].nickname).toBe('복구1');
    });
  });

  describe('저장 실패 시나리오', () => {
    it('존재하지 않는 디렉터리에 저장 시 오류를 throw해야 한다', () => {
      const badPath = join(tmpDir, 'nonexistent', 'data.json');
      setDataFilePath(badPath);

      expect(() => createPlayer(makePlayer())).toThrow('Failed to write temp file');

      // 오류 후 정상 경로로 복원 → 데이터 정상 동작 확인
      setDataFilePath(join(tmpDir, 'data.json'));
      const player = makePlayer();
      const created = createPlayer(player);
      expect(created.nickname).toBe(player.nickname);
    });

    it('직렬화 실패 시 오류를 throw하고 기존 데이터를 보존해야 한다', () => {
      const dataPath = join(tmpDir, 'data.json');
      setDataFilePath(dataPath);

      // 기존 데이터 생성
      const player = makePlayer({ nickname: '보존용' });
      createPlayer(player);

      // JSON.stringify 모킹 → 실패 유도
      const originalStringify = JSON.stringify;
      JSON.stringify = () => { throw new Error('mock serialization error'); };

      try {
        expect(() => createPlayer(makePlayer())).toThrow('Failed to serialize data');
      } finally {
        JSON.stringify = originalStringify;
      }

      // 기존 데이터가 그대로 보존되었는지 확인
      const recovered = getPlayer(player.id);
      expect(recovered).toBeDefined();
      expect(recovered!.nickname).toBe('보존용');
    });

    it('저장 실패 후에도 store가 정상 동작해야 한다', () => {
      const dataPath = join(tmpDir, 'data.json');
      setDataFilePath(dataPath);

      // 실패 유도
      const badPath = join(tmpDir, 'nonexistent', 'data.json');
      setDataFilePath(badPath);
      expect(() => createPlayer(makePlayer())).toThrow();

      // 정상 경로 복원 후 CRUD 동작 확인
      setDataFilePath(dataPath);
      const p = createPlayer(makePlayer({ nickname: '복구후' }));
      expect(getPlayer(p.id)?.nickname).toBe('복구후');

      const updated = updatePlayer(p.id, { electricity: 50 });
      expect(updated?.electricity).toBe(50);

      expect(deletePlayer(p.id)).toBe(true);
      expect(getPlayer(p.id)).toBeUndefined();
    });
  });

  describe('데이터 격리', () => {
    it('임시 디렉터리를 사용해야 한다', () => {
      expect(tmpDir).toContain('idle-game-test-store');
      expect(existsSync(tmpDir)).toBe(true);
    });

    it('실제 data.json을 생성하거나 수정하지 않아야 한다', () => {
      const existedBefore = existsSync('data.json');
      const contentBefore = existedBefore ? readFileSync('data.json', 'utf-8') : null;

      createPlayer(makePlayer()); // 저장소 쓰기 발생

      if (existedBefore) {
        expect(existsSync('data.json')).toBe(true);
        expect(readFileSync('data.json', 'utf-8')).toBe(contentBefore);
      } else {
        expect(existsSync('data.json')).toBe(false);
      }
    });
  });
});
