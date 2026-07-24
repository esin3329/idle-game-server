import type { Player } from './types.js';

const players = new Map<string, Player>();

export function createPlayer(player: Player): Player {
  players.set(player.id, player);
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
  return updated;
}

export function deletePlayer(id: string): boolean {
  return players.delete(id);
}
