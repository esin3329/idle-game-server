/** 저장소 모델: 데이터 저장/조회 전용 */
export interface Player {
  id: string;
  nickname: string;
  apiKey: string;
  electricity: number;
  electricityPerSecond: number;
  lastClaimedAt: string;
  createdAt: string;
  updatedAt: string;
}
