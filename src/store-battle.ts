/**
 * JSON 파일 기반 전투 세션 저장소
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { BattleRepository } from './repository.js';
import { STAGES } from './data/stages.js';
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

// data/stages.ts 에서 STAGES 임포트

export const jsonBattleRepo: BattleRepository = {
  async getStage(stageId: string) { return STAGES.find((s) => s.id === stageId) || null; },
  async getStages() { return STAGES; },
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
