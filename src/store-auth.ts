/**
 * JSON 파일 기반 Auth 저장소 (개발/테스트용)
 *
 * MySQL 미연결 시 provider.ts에서 자동 로드됨.
 * 모든 데이터를 JSON 파일에 저장하며, 트랜잭션 대신 순차 저장.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { User, RefreshSession, Sanction, PlayerProfile, WalletBalance } from './types.js';
import type { AuthRepository, PlayerProfile as ProfileType, WalletBalance as WalletType } from './repository.js';
import { logger } from './shared/logger.js';

// ─── 데이터 파일 경로 ────────────────────────────────

const usersFile = process.env.DATA_FILE_USERS || join(process.cwd(), 'data-users.json');
const sessionsFile = process.env.DATA_FILE_SESSIONS || join(process.cwd(), 'data-sessions.json');
const sanctionsFile = process.env.DATA_FILE_SANCTIONS || join(process.cwd(), 'data-sanctions.json');
const profilesFile = process.env.DATA_FILE_PROFILES || join(process.cwd(), 'data-profiles.json');
const walletsFile = process.env.DATA_FILE_WALLETS || join(process.cwd(), 'data-wallets.json');

// ─── 인메모리 저장소 ─────────────────────────────────

let users = new Map<string, User>();
let sessions = new Map<string, RefreshSession>();
let sanctions = new Map<string, Sanction>();
let profiles = new Map<string, PlayerProfile>();
let wallets = new Map<string, WalletBalance>();
let _initialized = false;

// ─── 파일 I/O 헬퍼 ───────────────────────────────────

function loadMap<T extends { id: string }>(filePath: string, name: string): Map<string, T> {
  if (!existsSync(filePath)) return new Map();
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const arr: T[] = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('not an array');
    return new Map(arr.map((item) => [item.id, item]));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'load', file: filePath, name, err: msg }, `Failed to load ${name}, starting empty`);
    return new Map();
  }
}

function saveMap<T extends { id: string }>(map: Map<string, T>, filePath: string, name: string): void {
  const tmpFile = filePath + '.tmp';
  try {
    const json = JSON.stringify(Array.from(map.values()), null, 2);
    writeFileSync(tmpFile, json, 'utf-8');

    const raw = readFileSync(tmpFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('validation failed');

    const bakFile = filePath + '.bak';
    if (existsSync(filePath)) copyFileSync(filePath, bakFile);
    renameSync(tmpFile, filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ operation: 'save', file: filePath, name, err: msg }, `Failed to save ${name}`);
    try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch { /* best effort */ }
  }
}

function ensureLoaded(): void {
  if (!_initialized) {
    _initialized = true;
    users = loadMap<User>(usersFile, 'users');
    sessions = loadMap<RefreshSession>(sessionsFile, 'sessions');
    sanctions = loadMap<Sanction>(sanctionsFile, 'sanctions');
    profiles = loadMap<PlayerProfile>(profilesFile, 'profiles');
    wallets = loadMap<WalletBalance>(walletsFile, 'wallets');
  }
}

// ─── AuthRepository ────────────────────────────────

export const jsonAuthRepo: AuthRepository = {
  async createUser(user: User): Promise<User> {
    ensureLoaded();
    users.set(user.id, user);
    saveMap(users, usersFile, 'users');
    return user;
  },

  async createProfile(profile: ProfileType): Promise<ProfileType> {
    ensureLoaded();
    const p: PlayerProfile = { ...profile, highestStage: 1 };
    profiles.set(p.id, p);
    saveMap(profiles, profilesFile, 'profiles');
    return p;
  },

  async createWallet(wallet: WalletType): Promise<WalletType> {
    ensureLoaded();
    const w: WalletBalance = { ...wallet };
    wallets.set(w.id, w);
    saveMap(wallets, walletsFile, 'wallets');
    return w;
  },

  async findUserByEmail(email: string): Promise<User | undefined> {
    ensureLoaded();
    return Array.from(users.values()).find((u) => u.email === email);
  },

  async findUserById(id: string): Promise<User | undefined> {
    ensureLoaded();
    return users.get(id);
  },

  async findProfileByUserId(userId: string): Promise<PlayerProfile | undefined> {
    ensureLoaded();
    return Array.from(profiles.values()).find((p) => p.userId === userId);
  },

  async findActiveSanctions(userId: string): Promise<Sanction[]> {
    ensureLoaded();
    const now = new Date().toISOString();
    return Array.from(sanctions.values()).filter(
      (s) => s.userId === userId && s.status === 'active' && (!s.expiresAt || s.expiresAt > now),
    );
  },

  async createSession(session: RefreshSession): Promise<RefreshSession> {
    ensureLoaded();
    sessions.set(session.id, session);
    saveMap(sessions, sessionsFile, 'sessions');
    return session;
  },

  async findSessionByTokenHash(tokenHash: string): Promise<RefreshSession | undefined> {
    ensureLoaded();
    return Array.from(sessions.values()).find((s) => s.tokenHash === tokenHash);
  },

  async revokeSession(tokenHash: string): Promise<void> {
    ensureLoaded();
    const session = Array.from(sessions.values()).find((s) => s.tokenHash === tokenHash);
    if (session) {
      session.revokedAt = new Date().toISOString();
      sessions.set(session.id, session);
      saveMap(sessions, sessionsFile, 'sessions');
    }
  },
};

/** 테스트 전용: 모든 저장소 초기화 */
export function resetAuthStores(): void {
  users = new Map();
  sessions = new Map();
  sanctions = new Map();
  profiles = new Map();
  wallets = new Map();
  _initialized = false;
}
