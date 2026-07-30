import { Hono } from 'hono';
import { getBattleRepo } from './provider.js';
import { STAGES, getStageBosses } from './data/stages.js';

const stagesRoutes = new Hono<{ Variables: { userId: string } }>();

// ─── GET /stages — 스테이지 목록 + 플레이어 진행도 (JWT 있으면) ──

stagesRoutes.get('/stages', async (c) => {
  const authHeader = c.req.header('Authorization');
  let playerId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const jwt = await import('jsonwebtoken');
      const payload = jwt.default.verify(authHeader.slice(7), process.env.JWT_ACCESS_SECRET || 'dev-secret-change-in-production') as any;
      playerId = payload.sub;
    } catch { /* ignore */ }
  }

  const repo = await getBattleRepo();
  const dbStages = await repo.getStages();

  // data/stages.ts의 스테이지와 DB 스테이지 병합 (JSON 모드에서는 data/stages.ts만 사용)
  const stages = dbStages.length > 0 ? dbStages : STAGES;

  const result = await Promise.all(stages.map(async (s: any) => {
    const bosses = getStageBosses(s.id);
    let progress = null;
    if (playerId) {
      progress = await repo.getPlayerStageProgress(playerId, s.id).catch(() => null);
    }
    return {
      id: s.id, name: s.name, description: s.description,
      sequence: s.sequence, durationSeconds: s.durationSeconds,
      recommendedPower: s.recommendedPower, enemySet: s.enemySet,
      bossTimings: s.bossTimings, maxKills: s.maxKills,
      scrapPerKill: s.scrapPerKill,
      bosses: bosses.map((b) => ({
        code: b.code, name: b.name, description: b.description,
        hp: b.hp, attackPower: b.attackPower, patterns: b.patterns,
        scrapBonus: b.scrapBonus,
      })),
      unlocked: progress ? true : s.sequence === 1,
      progress: progress ? {
        clearCount: progress.clearCount || 0,
        bestClearTimeMs: progress.bestClearTimeMs,
        highestBossSequence: progress.highestBossSequence || 0,
      } : null,
    };
  }));

  return c.json(result);
});

// ─── GET /stages/:id — 단일 스테이지 상세 ────────

stagesRoutes.get('/stages/:id', async (c) => {
  const stageId = c.req.param('id')!;
  const repo = await getBattleRepo();
  const stages = await repo.getStages();
  const stage = stages.find((s: any) => s.id === stageId) || STAGES.find((s) => s.id === stageId);
  if (!stage) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  const bosses = getStageBosses(stageId);
  return c.json({
    ...stage,
    bosses: bosses.map((b) => ({
      code: b.code, name: b.name, description: b.description,
      hp: b.hp, attackPower: b.attackPower, patterns: b.patterns,
      scrapBonus: b.scrapBonus,
    })),
  });
});

// ─── GET /stages/:id/bosses — 스테이지 보스 목록 ──

stagesRoutes.get('/stages/:id/bosses', (c) => {
  const stageId = c.req.param('id')!;
  const bosses = getStageBosses(stageId);
  return c.json(bosses);
});

export default stagesRoutes;
