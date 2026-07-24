/**
 * 개발용 시드 데이터 생성
 * 실행: npx tsx src/db/seed.ts
 */
import { createPlayer } from '../store.js';

const NICKNAMES = [
  '전기왕', '번개', '발전소', '솔라', '아톰',
  '에너자이저', '볼트', '와트', '쥴', '스파크',
  '뉴클리어', '테슬라', '에디슨', '맥스웰', '패러데이',
  '암페어', '옴', '헤르츠', '쿨롱', '가우스',
];

const now = new Date().toISOString();

for (let i = 0; i < NICKNAMES.length; i++) {
  const player = createPlayer({
    id: crypto.randomUUID(),
    nickname: NICKNAMES[i],
    apiKey: crypto.randomUUID(),
    electricity: Math.floor(Math.random() * 10000),
    electricityPerSecond: Math.floor(Math.random() * 50) + 1,
    lastClaimedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`Created: ${player.nickname} (${player.electricity}⚡, ${player.electricityPerSecond}/s)`);
}

console.log(`\nDone! ${NICKNAMES.length} players seeded.`);
