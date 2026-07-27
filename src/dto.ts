import type { Player } from './types.js';

// ─── 공개 응답 DTO ─────────────────────────────────

/** 플레이어 공개 정보 — 저장 모델과 독립된 DTO */
export interface PublicPlayer {
  id: string;
  nickname: string;
  electricity: number;
  electricityPerSecond: number;
  createdAt: string;
}

export interface ClaimResponse {
  player: PublicPlayer;
  claimed: number;
  elapsedSeconds: number;
  maxCapped: boolean;
}

export interface UpgradeResponse {
  player: PublicPlayer;
  cost: number;
  newElectricityPerSecond: number;
}

export interface BattleResponse {
  player: PublicPlayer;
  won: boolean;
  reward: number;
  enemyName: string;
  enemyPower: number;
  playerPower: number;
}

// ─── 변환 함수 ─────────────────────────────────────

/**
 * 저장 모델(Player) → 공개 응답 DTO(PublicPlayer)
 * 명시적 필드 선택으로 새 필드 추가 시 자동 누출 방지
 */
export function toPublicPlayerDto(p: Player): PublicPlayer {
  return {
    id: p.id,
    nickname: p.nickname,
    electricity: p.electricity,
    electricityPerSecond: p.electricityPerSecond,
    createdAt: p.createdAt,
  };
}
