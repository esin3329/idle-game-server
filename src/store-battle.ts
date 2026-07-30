/**
 * JSON 파일 기반 전투 세션 저장소
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { BattleRepository } from './repository.js';
import { logger } from './shared/logger.js';

const sessionsFile = process.env.DATA_FILE_BATTLES || join(process.cwd(), 'data-battles.json');
const eventsFile = process.env.DATA_FILE_BEVENTS || join(process.cwd(), 'data-battle-events.json');
const resultsFile = process.env.DATA_FILE_RESULTS || join(process.cwd(), 'data-battle-results.json');

let sessions = new Map<string, any>();
let events: any[] = [];
let results = new Map<string, any>();
let _initialized = false;

function loadMap<T>(fp: string, _name: string): Map<string, T> {
  if (!existsSync(fp)) return new Map();
  try { const a = JSON.parse(readFileSync(fp, 'utf-8')); return new Map(Array.isArray(a) ? a.map((i: any) => [i.id, i]) : []); }
  catch { return new Map(); }
}
function loadArray(fp: string, _name: string): any[] {
  if (!existsSync(fp)) return [];
  try { const a = JSON.parse(readFileSync(fp, 'utf-8')); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function saveMap<T>(map: Map<string, T>, fp: string, name: string): void {
  const tmp = fp + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(Array.from(map.values()), null, 2), 'utf-8');
    JSON.parse(readFileSync(tmp, 'utf-8'));
    if (existsSync(fp)) copyFileSync(fp, fp + '.bak');
    renameSync(tmp, fp);
  } catch (err) {
    logger.error({ operation: 'save', file: fp, name, err: (err as Error).message }, `Failed to save ${name}`);
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  }
}
function saveArray(fp: string, name: string): void {
  const tmp = fp + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(events, null, 2), 'utf-8');
    JSON.parse(readFileSync(tmp, 'utf-8'));
    if (existsSync(fp)) copyFileSync(fp, fp + '.bak');
    renameSync(tmp, fp);
  } catch (err) {
    logger.error({ operation: 'save', file: fp, name, err: (err as Error).message }, `Failed to save ${name}`);
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  }
}
function ensure() {
  if (!_initialized) { _initialized = true; sessions = loadMap(sessionsFile, 'sessions'); events = loadArray(eventsFile, 'events'); results = loadMap(resultsFile, 'results'); }
}

// 정적 스테이지 데이터 (마이그레이션 없이 사용 가능)
const STATIC_STAGES = [
  { id: 'stage_01_ruins', name: 'stage_01_ruins', description: '폐허', sequence: 1, durationSeconds: 300, entryRequirement: 'none', recommendedPower: 10, enemySet: '["zombie","slime"]', bossTimings: '[180]', maxKills: 300, maxCoreEnergy: 300, corePerLevel: 50, corePerKill: 5, scrapPerKill: 1, unlocked: 1, enabled: 1, contentVersion: '1.0.0' },
  { id: 'stage_02_factory', name: 'stage_02_factory', description: '공장', sequence: 2, durationSeconds: 360, entryRequirement: 'stage_01_ruins', recommendedPower: 30, enemySet: '["goblin","drone"]', bossTimings: '[180,300]', maxKills: 400, maxCoreEnergy: 400, corePerLevel: 60, corePerKill: 6, scrapPerKill: 2, unlocked: 0, enabled: 1, contentVersion: '1.0.0' },
  { id: 'stage_03_lab', name: 'stage_03_lab', description: '연구소', sequence: 3, durationSeconds: 420, entryRequirement: 'stage_02_factory', recommendedPower: 60, enemySet: '["mutant","skeleton"]', bossTimings: '[180,300,400]', maxKills: 500, maxCoreEnergy: 500, corePerLevel: 70, corePerKill: 7, scrapPerKill: 3, unlocked: 0, enabled: 1, contentVersion: '1.0.0' },
  { id: 'stage_04_core', name: 'stage_04_core', description: '코어', sequence: 4, durationSeconds: 480, entryRequirement: 'stage_03_lab', recommendedPower: 100, enemySet: '["boss"]', bossTimings: '[180,300,400,460]', maxKills: 600, maxCoreEnergy: 600, corePerLevel: 80, corePerKill: 8, scrapPerKill: 4, unlocked: 0, enabled: 1, contentVersion: '1.0.0' },
];

export const jsonBattleRepo: BattleRepository = {
  async getStage(stageId: string) { return STATIC_STAGES.find((s) => s.id === stageId) || null; },
  async getStages() { return STATIC_STAGES; },
  async getStageRewards() { return []; },
  async getMechStats() { return null; },
  async createMechStats() {},
  async getActiveSanctions() { return []; },
  async getActiveSessions(playerId: string) { ensure(); return Array.from(sessions.values()).filter((s: any) => s.playerId === playerId && s.status === 'active'); },
  async abandonSession(sessionId: string) { ensure(); const s = sessions.get(sessionId); if (s) { s.status = 'abandoned'; sessions.set(sessionId, s); saveMap(sessions, sessionsFile, 'sessions'); } },

  async createSession(session: any) { ensure(); sessions.set(session.id, session); saveMap(sessions, sessionsFile, 'sessions'); },
  async getSession(sessionId: string) { ensure(); return sessions.get(sessionId) || null; },
  async updateSession(sessionId: string, data: Record<string, unknown>) {
    ensure(); const s = sessions.get(sessionId); if (s) { Object.assign(s, data); sessions.set(sessionId, s); saveMap(sessions, sessionsFile, 'sessions'); }
  },

  async saveBattleEvent(event: any) { ensure(); events.push(event); saveArray(eventsFile, 'events'); },
  async getUpgradeOffers(sessionId: string) { ensure(); return events.filter((e: any) => e.battleSessionId === sessionId && e.eventType === 'upgrade_offer'); },
  async saveUpgradeOffer(offer: any) { ensure(); events.push({ ...offer, eventType: 'upgrade_offer' }); saveArray(eventsFile, 'events'); },

  async createBattleResult(result: any) { ensure(); results.set(result.id, result); saveMap(results, resultsFile, 'results'); },
  async getBattleResult(sessionId: string) { ensure(); return Array.from(results.values()).find((r: any) => r.battleSessionId === sessionId) || null; },

  async getWalletBalance() { return null; },
  async updateWalletElectricity() {},
  async updateWalletScrap() {},
  async insertCurrencyLedger() {},

  async getPlayerRecord() { return null; },
  async upsertPlayerRecord() {},
  async getPlayerStageProgress() { return null; },
  async upsertPlayerStageProgress() {},

  async createSecurityEvent(_event: any) { /* best effort */ },
};

export function resetBattleStores(): void {
  sessions = new Map(); events = []; results = new Map(); _initialized = false;
}
