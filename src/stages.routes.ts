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
    let unlocked = s.sequence === 1; // 첫 스테이지는 항상 해금
    if (playerId) {
      progress = await repo.getPlayerStageProgress(playerId, s.id).catch(() => null);
      // entryRequirement 기반 해금 확인
      if (s.entryRequirement && s.entryRequirement !== 'none') {
        const prevProgress = await repo.getPlayerStageProgress(playerId, s.entryRequirement).catch(() => null);
        const prevRecord = await repo.getPlayerRecord(playerId, s.entryRequirement).catch(() => null);
        unlocked = !!(prevProgress?.firstClearedAt || (prevRecord?.totalClears || 0) > 0);
      }
    }
    return {
      id: s.id, name: s.name, description: s.description,
      sequence: s.sequence, durationSeconds: s.durationSeconds,
      recommendedPower: s.recommendedPower, enemySet: s.enemySet,
      bossTimings: s.bossTimings, maxKills: s.maxKills,
      scrapPerKill: s.scrapPerKill,
      entryRequirement: s.entryRequirement,
      bosses: bosses.map((b) => ({
        code: b.code, name: b.name, description: b.description,
        hp: b.hp, attackPower: b.attackPower, patterns: b.patterns,
        scrapBonus: b.scrapBonus,
      })),
      unlocked,
      progress: progress ? {
        firstClearedAt: progress.firstClearedAt,
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

// ─── GET /stages/:id/requirements — 출격 조건 ──

stagesRoutes.get('/stages/:id/requirements', async (c) => {
  const stageId = c.req.param('id')!;
  const repo = await getBattleRepo();
  const stages = await repo.getStages();
  const stage = stages.find((s: any) => s.id === stageId) || STAGES.find((s) => s.id === stageId);
  if (!stage) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  const requirements: Record<string, unknown>[] = [];

  // 1. 이전 스테이지 클리어 조건
  if (stage.entryRequirement && stage.entryRequirement !== 'none') {
    const prevStage = stages.find((s: any) => s.id === stage.entryRequirement) || STAGES.find((s) => s.id === stage.entryRequirement);
    requirements.push({
      type: 'prev_stage_clear',
      label: `이전 스테이지 클리어`,
      required: stage.entryRequirement,
      requiredName: prevStage?.name || stage.entryRequirement,
    });
  }

  // 2. 권장 전투력
  if (stage.recommendedPower) {
    requirements.push({
      type: 'recommended_power',
      label: '권장 전투력',
      required: stage.recommendedPower,
    });
  }

  // 3. 장비 장착 (옵션)
  requirements.push({
    type: 'equip',
    label: '프레임/무기/코어/모듈 장착',
    optional: true,
  });

  return c.json({ stageId: stage.id, name: stage.name, requirements });
});
