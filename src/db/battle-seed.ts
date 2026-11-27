/**
 * 전투 콘텐츠 시드 (PostgreSQL) — 스테이지 + 보상표
 *
 * 실행: npm run db:battle-seed
 */
import { pathToFileURL } from 'node:url';
import { eq, and } from 'drizzle-orm';
import { getDb, closePostgresPool } from './postgres-connection.js';
import { stages, stageRewards } from './postgres-schema.js';
import { STAGES } from '../data/stages.js';

interface RewardSeed {
  stageId: string;
  clearType: string;
  scrapMin: number;
  scrapMax: number;
  blueprintDropRate: number;
}

const REWARDS: RewardSeed[] = [
  { stageId: 'stage_01_ruins', clearType: 'partial', scrapMin: 30, scrapMax: 60, blueprintDropRate: 0 },
  { stageId: 'stage_01_ruins', clearType: 'normal', scrapMin: 80, scrapMax: 140, blueprintDropRate: 10 },
  { stageId: 'stage_01_ruins', clearType: 'first', scrapMin: 200, scrapMax: 350, blueprintDropRate: 100 },

  { stageId: 'stage_02_factory', clearType: 'partial', scrapMin: 60, scrapMax: 120, blueprintDropRate: 0 },
  { stageId: 'stage_02_factory', clearType: 'normal', scrapMin: 180, scrapMax: 300, blueprintDropRate: 15 },
  { stageId: 'stage_02_factory', clearType: 'first', scrapMin: 450, scrapMax: 700, blueprintDropRate: 100 },

  { stageId: 'stage_03_lab', clearType: 'partial', scrapMin: 100, scrapMax: 200, blueprintDropRate: 0 },
  { stageId: 'stage_03_lab', clearType: 'normal', scrapMin: 350, scrapMax: 550, blueprintDropRate: 20 },
  { stageId: 'stage_03_lab', clearType: 'first', scrapMin: 800, scrapMax: 1200, blueprintDropRate: 100 },

  { stageId: 'stage_04_core', clearType: 'partial', scrapMin: 150, scrapMax: 300, blueprintDropRate: 0 },
  { stageId: 'stage_04_core', clearType: 'normal', scrapMin: 600, scrapMax: 900, blueprintDropRate: 30 },
  { stageId: 'stage_04_core', clearType: 'first', scrapMin: 1500, scrapMax: 2200, blueprintDropRate: 100 },
];

export async function seed() {
  const db = getDb();
  console.log('Seeding battle content to PostgreSQL...\n');

  for (const s of STAGES) {
    const existing = await db.select().from(stages).where(eq(stages.id, s.id)).limit(1);
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
      corePerLevel: s.corePerLevel,
      corePerKill: s.corePerKill,
      scrapPerKill: s.scrapPerKill,
      contentVersion: s.contentVersion,
    };

    if (existing.length > 0) {
      // Operator-controlled flags (`unlocked`, `enabled`) are preserved on update.
      await db.update(stages).set(values).where(eq(stages.id, s.id));
      console.log(`  [UPDATED] Stage: ${s.id} (${s.name})`);
    } else {
      await db.insert(stages).values({
        id: s.id, ...values, unlocked: s.sequence === 1 ? 1 : 0, enabled: 1, createdAt: new Date(),
      });
      console.log(`  [CREATED] Stage: ${s.id} (${s.name})`);
    }
  }

  for (const r of REWARDS) {
    const existing = await db.select({ id: stageRewards.id }).from(stageRewards)
      .where(and(eq(stageRewards.stageId, r.stageId), eq(stageRewards.clearType, r.clearType)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(stageRewards).values({
        id: crypto.randomUUID(),
        stageId: r.stageId,
        clearType: r.clearType,
        scrapMin: r.scrapMin,
        scrapMax: r.scrapMax,
        blueprintDropRate: r.blueprintDropRate,
        createdAt: new Date(),
      });
    } else {
      await db.update(stageRewards)
        .set({ scrapMin: r.scrapMin, scrapMax: r.scrapMax, blueprintDropRate: r.blueprintDropRate })
        .where(eq(stageRewards.id, existing[0].id));
    }
  }

  console.log('\n✅ Battle content seeded (4 stages + 12 reward rows)');
}

async function main() {
  try {
    await seed();
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await closePostgresPool();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
