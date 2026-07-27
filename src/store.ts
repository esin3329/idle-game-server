import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Player } from './types.js';
import { logger } from './shared/logger.js';

// ─── 데이터 파일 경로 ────────────────────────────────

let dataFile = process.env.DATA_FILE || join(process.cwd(), 'data.json');
const players = new Map<string, Player>();

// 초기 로드
_loadFromFile();

// ─── 스키마 검증 ───────────────────────────────────

const REQUIRED_PLAYER_FIELDS: (keyof Player)[] = [
  'id', 'nickname', 'apiKey', 'electricity',
  'electricityPerSecond', 'lastClaimedAt', 'createdAt', 'updatedAt',
];

function _isValidPlayer(obj: unknown): obj is Player {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return REQUIRED_PLAYER_FIELDS.every((f) => f in record && record[f] !== undefined);
}

function _isValidPlayerArray(arr: unknown): arr is Player[] {
  return Array.isArray(arr) && arr.every(_isValidPlayer);
}

// ─── 초기 로드 (크래시 복구 포함) ───────────────────

function _loadFromFile(): void {
  const tmpFile = dataFile + '.tmp';

  // 크래시 복구: .tmp 파일이 남아있으면 dataFile 대신 사용 시도
  if (existsSync(tmpFile) && !existsSync(dataFile)) {
    logger.warn({ operation: 'tmpRecovery', tmpFile }, 'Found orphaned .tmp file, attempting recovery');
    try { renameSync(tmpFile, dataFile); } catch (err) {
      logger.error({ operation: 'tmpRecovery', tmpFile, dataFile, err: (err as Error).message }, 'Failed to recover .tmp file');
    }
  }

  if (!existsSync(dataFile)) return;

  try {
    const raw = readFileSync(dataFile, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (!_isValidPlayerArray(parsed)) {
      logger.error({ operation: 'loadValidation', dataFile }, 'Invalid data format: expected Player[]');
      throw new Error('Invalid data format: expected Player[]');
    }

    // 검증 통과 후에만 Map 교체 (원자적)
    players.clear();
    for (const player of parsed) {
      players.set(player.id, player);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'loadParse', dataFile, err: msg }, 'Failed to load %s, trying backup', dataFile);

    // 백업 파일로 복구 시도
    const bakFile = dataFile + '.bak';
    if (existsSync(bakFile)) {
      try {
        const raw = readFileSync(bakFile, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (_isValidPlayerArray(parsed)) {
          players.clear();
          for (const player of parsed) {
            players.set(player.id, player);
          }
          // 백업을 메인으로 복원
          copyFileSync(bakFile, dataFile);
          logger.info({ operation: 'backupRecovery', dataFile, bakFile }, 'Recovered from backup file');
          return;
        }
      } catch (bakErr) {
        logger.error({ operation: 'backupRecovery', dataFile, bakFile, err: (bakErr as Error).message }, 'Backup file also corrupted');
      }
    }

    logger.error({ operation: 'loadFromFile', dataFile }, 'Starting with empty store');
    players.clear();
  }
}

/**
 * 테스트 전용: 데이터 파일 경로를 변경하고 새 경로에서 재로드.
 * 프로덕션 코드에서 호출해서는 안 됨.
 */
export function setDataFilePath(path: string): void {
  dataFile = path;
  _loadFromFile();
}

// ─── 원자적 저장 (백업 + tmp + rename) ─────────────

function saveToFile(): void {
  const bakFile = dataFile + '.bak';
  const tmpFile = dataFile + '.tmp';

  // 1. 직렬화 (Map → JSON)
  let json: string;
  try {
    const data = Array.from(players.values());
    json = JSON.stringify(data, null, 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'serialize', dataFile, err: msg }, 'Failed to serialize data');
    throw new Error(`Failed to serialize data: ${msg}`);
  }

  // 2. 임시 파일에 쓰기
  try {
    writeFileSync(tmpFile, json, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'writeTmp', dataFile, tmpFile, err: msg }, 'Failed to write temp file');
    throw new Error(`Failed to write temp file: ${msg}`);
  }

  // 3. 임시 파일 재검증 (쓰기 손상 방지)
  try {
    const raw = readFileSync(tmpFile, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!_isValidPlayerArray(parsed)) {
      throw new Error('Temp file validation failed: invalid Player[]');
    }
    if (parsed.length !== players.size) {
      throw new Error(`Temp file validation failed: count mismatch (expected ${players.size}, got ${parsed.length})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'validateTmp', dataFile, tmpFile, err: msg }, 'Temp file validation failed');
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* best effort */ }
    throw new Error(`Failed to validate temp file: ${msg}`);
  }

  // 4. 기존 파일을 백업으로 보존
  try {
    if (existsSync(dataFile)) {
      copyFileSync(dataFile, bakFile);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to create backup file');
  }

  // 5. 임시 파일을 메인으로 승격 (원자적)
  try {
    renameSync(tmpFile, dataFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'renameToMain', dataFile, tmpFile, err: msg }, 'Failed to promote temp file');
    // tmp 정리 시도
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* best effort */ }
    throw new Error(`Failed to persist data: ${msg}`);
  }
}

// ─── CRUD ──────────────────────────────────────────

export function createPlayer(player: Player): Player {
  players.set(player.id, player);
  saveToFile();
  return player;
}

export function getPlayer(id: string): Player | undefined {
  return players.get(id);
}

export function getAllPlayers(): Player[] {
  return Array.from(players.values());
}

export function updatePlayer(id: string, updates: Partial<Player>): Player | undefined {
  const player = players.get(id);
  if (!player) return undefined;
  // 보호: id, apiKey, createdAt 은 외부에서 덮어쓸 수 없음
  const { id: _id, apiKey: _apiKey, createdAt: _createdAt, ...safeUpdates } = updates as Record<string, unknown>;
  const updated = { ...player, ...safeUpdates, updatedAt: new Date().toISOString() } as Player;
  players.set(id, updated);
  saveToFile();
  return updated;
}

export function deletePlayer(id: string): boolean {
  const result = players.delete(id);
  if (result) saveToFile();
  return result;
}
