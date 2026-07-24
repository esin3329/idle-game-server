export interface Player {
  id: string;
  nickname: string;
  electricity: number;
  electricityPerSecond: number;
  lastClaimedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlayerRequest {
  nickname: string;
}

export interface ClaimResponse {
  player: Player;
  claimed: number;
  elapsedSeconds: number;
  maxCapped: boolean;
}

export interface UpgradeResponse {
  player: Player;
  cost: number;
  newElectricityPerSecond: number;
}

export interface BattleResponse {
  player: Player;
  won: boolean;
  reward: number;
  enemyName: string;
  enemyPower: number;
  playerPower: number;
}
