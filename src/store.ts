import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Player } from './types.js';

const DATA_FILE = join(process.cwd(), 'data.json');

// 서버 시작 시 파일에서 데이터 복원
const players = new Map<string, Player>();
if (existsSync(DATA_FILE)) {
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const data: Player[] = JSON.parse(raw);
    for (const player of data) {
      players.set(player.id, player);
    }
  } catch {
    console.error('Failed to load data.json, starting with empty store');
  }
}

function saveToFile() {
  try {
    const data = Array.from(players.values());
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist data:', err);
  }
}

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
  const updated = { ...player, ...updates, updatedAt: new Date().toISOString() };
  players.set(id, updated);
  saveToFile();
  return updated;
}

export function deletePlayer(id: string): boolean {
  const result = players.delete(id);
  if (result) saveToFile();
  return result;
}
