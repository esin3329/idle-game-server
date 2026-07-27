/**
 * 플레이어 저장소 공통 인터페이스 (async)
 *
 * JSON 파일 구현체: store.ts
 * MySQL 구현체: db/mysql.repository.ts
 */
import type { Player } from './types.js';

export interface PlayerRepository {
  createPlayer(player: Player): Promise<Player>;
  getPlayer(id: string): Promise<Player | undefined>;
  getAllPlayers(): Promise<Player[]>;
  updatePlayer(id: string, updates: Partial<Player>): Promise<Player | undefined>;
  deletePlayer(id: string): Promise<boolean>;
}
