/**
 * 전투 콘텐츠 시드 — 스테이지 + 보상표
 *
 * 4개 스테이지. 각 스테이지는 1~3개 보스 웨이브 포함.
 * 실행: npx tsx src/db/battle-seed.ts
 *       npm run db:battle-seed
 */

import { getDb } from './connection.js';
import { stages, stageRewards } from './schema.js';
import { eq } from 'drizzle-orm';

const db = getDb();

// ═══════════════════════════════════════════════════════
interface StageSeed {
  id: string;
  name: string;
  description: string;
  sequence: number;
  durationSeconds: number;
  entryRequirement: string;
  recommendedPower: number;
  enemySet: string[];
  bossTimings: number[];
  maxKills: number;
  maxCoreEnergy: number;
  scrapPerKill: number;
  unlocked: number;
  enabled: number;
  contentVersion: string;
}

const STAGES: StageSeed[] = [
  {
    id: 'stage_01_ruins',
    name: '폐허 진입',
    description: '버려진 도시 외곽. 약한 적들과 첫 보스가 등장한다.',
    sequence: 1,
    durationSeconds: 300,
    entryRequirement: 'none',
    recommendedPower: 10,
    enemySet: ['drone_scout', 'drone_warrior'],
    bossTimings: [180],
    maxKills: 150,
    maxCoreEnergy: 200,
    scrapPerKill: 1,
    unlocked: 1,
    enabled: 1,
    contentVersion: '1.0.0',
  },
  {
    id: 'stage_02_canyon',
    name: '강철 협곡',
    description: '협곡을 따라 진격. 두 번의 보스 웨이브를 견뎌야 한다.',
    sequence: 2,
    durationSeconds: 420,
    entryRequirement: 'clear_stage_01_ruins',
    recommendedPower: 50,
    enemySet: ['drone_scout', 'drone_warrior', 'turret_mk1'],
    bossTimings: [180, 360],
    maxKills: 250,
    maxCoreEnergy: 350,
    scrapPerKill: 2,
    unlocked: 1,
    enabled: 1,
    contentVersion: '1.0.0',
  },
  {
    id: 'stage_03_furnace',
    name: '용광로 심장부',
    description: '거대한 용광로 내부. 세 번의 보스 웨이브가 기다린다.',
    sequence: 3,
    durationSeconds: 540,
    entryRequirement: 'clear_stage_02_canyon',
    recommendedPower: 150,
    enemySet: ['drone_warrior', 'turret_mk1', 'heavy_mech'],
    bossTimings: [180, 360, 480],
    maxKills: 350,
    maxCoreEnergy: 500,
    scrapPerKill: 3,
    unlocked: 0,
    enabled: 1,
    contentVersion: '1.0.0',
  },
  {
    id: 'stage_04_fortress',
    name: '코어 요새',
    description: '적의 최종 방어선. 모든 보스를 처치해야 클리어된다.',
    sequence: 4,
    durationSeconds: 600,
    entryRequirement: 'clear_stage_03_furnace',
    recommendedPower: 350,
    enemySet: ['turret_mk1', 'turret_mk2', 'heavy_mech', 'elite_guard'],
    bossTimings: [180, 360, 540],
    maxKills: 450,
    maxCoreEnergy: 650,
    scrapPerKill: 5,
    unlocked: 0,
    enabled: 1,
    contentVersion: '1.0.0',
  },
];

// ═══════════════════════════════════════════════════════
interface RewardSeed {
  stageId: string;
  clearType: string;
  scrapMin: number;
  scrapMax: number;
  blueprintDropRate: number;
}

const REWARDS: RewardSeed[] = [
  // Stage 1
  { stageId: 'stage_01_ruins', clearType: 'partial', scrapMin: 30, scrapMax: 60, blueprintDropRate: 0 },
  { stageId: 'stage_01_ruins', clearType: 'normal', scrapMin: 80, scrapMax: 140, blueprintDropRate: 10 },
  { stageId: 'stage_01_ruins', clearType: 'first', scrapMin: 200, scrapMax: 350, blueprintDropRate: 100 },

  // Stage 2
  { stageId: 'stage_02_canyon', clearType: 'partial', scrapMin: 60, scrapMax: 120, blueprintDropRate: 0 },
  { stageId: 'stage_02_canyon', clearType: 'normal', scrapMin: 180, scrapMax: 300, blueprintDropRate: 15 },
  { stageId: 'stage_02_canyon', clearType: 'first', scrapMin: 450, scrapMax: 700, blueprintDropRate: 100 },

  // Stage 3
  { stageId: 'stage_03_furnace', clearType: 'partial', scrapMin: 100, scrapMax: 200, blueprintDropRate: 0 },
  { stageId: 'stage_03_furnace', clearType: 'normal', scrapMin: 350, scrapMax: 550, blueprintDropRate: 20 },
  { stageId: 'stage_03_furnace', clearType: 'first', scrapMin: 800, scrapMax: 1200, blueprintDropRate: 100 },

  // Stage 4
  { stageId: 'stage_04_fortress', clearType: 'partial', scrapMin: 150, scrapMax: 300, blueprintDropRate: 0 },
  { stageId: 'stage_04_fortress', clearType: 'normal', scrapMin: 600, scrapMax: 900, blueprintDropRate: 30 },
  { stageId: 'stage_04_fortress', clearType: 'first', scrapMin: 1500, scrapMax: 2200, blueprintDropRate: 100 },
];

// ═══════════════════════════════════════════════════════
async function seed() {
  console.log('Seeding battle content...\n');

  for (const s of STAGES) {
    const existing = await db.select().from(stages).where(eq(stages.id, s.id)).limit(1);
    const now = new Date();

    const values = {
      name: s.name,
      description: s.description,
      sequence: s.sequence,
      durationSeconds: s.durationSeconds,
      entryRequirement: s.entryRequirement,
      recommendedPower: s.recommendedPower,
      enemySet: JSON.stringify(s.enemySet),
      bossTimings: JSON.stringify(s.bossTimings),
      maxKills: s.maxKills,
      maxCoreEnergy: s.maxCoreEnergy,
      scrapPerKill: s.scrapPerKill,
      unlocked: s.unlocked,
      enabled: s.enabled,
      contentVersion: s.contentVersion,
    };

    if (existing.length > 0) {
      await db.update(stages).set(values).where(eq(stages.id, s.id));
      console.log(`  [UPDATED] Stage: ${s.name}`);
    } else {
      await db.insert(stages).values({ id: s.id, ...values, createdAt: now });
      console.log(`  [CREATED] ${s.name} (${s.durationSeconds}s, ${s.bossTimings.length} bosses, enemies: ${s.enemySet.join(',')})`);
    }
  }

  console.log('');

  for (const r of REWARDS) {
    const now = new Date();
    await db.insert(stageRewards).values({
      id: crypto.randomUUID(),
      stageId: r.stageId,
      clearType: r.clearType,
      scrapMin: r.scrapMin,
      scrapMax: r.scrapMax,
      blueprintDropRate: r.blueprintDropRate,
      createdAt: now,
    }).catch(() => { /* 중복 skip */ });
    console.log(`  [OK] Reward: ${r.stageId}/${r.clearType} → scrap ${r.scrapMin}~${r.scrapMax}, bp ${r.blueprintDropRate}%`);
  }

  console.log('\n✅ Battle content seeded (4 stages + 12 reward rows)');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
