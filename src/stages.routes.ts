import { Hono } from 'hono';
import { jwtAuth } from './shared/jwt-auth.js';
import { playerIdForUser } from './shared/player-identity.js';
import { getBattleRepo } from './provider.js';
import { STAGES, getStageBosses, parseStageJsonArray, requiredStageIdFor } from './data/stages.js';

const stagesRoutes = new Hono<{ Variables: { userId: string } }>();

async function getProgressWithLegacyFallback(repo: any, playerId: string, userId: string, stageId: string) {
  const byPlayer = await repo.getPlayerStageProgress(playerId, stageId).catch(() => null);
  if (byPlayer || playerId === userId) return byPlayer;
  return repo.getPlayerStageProgress(userId, stageId).catch(() => null);
}

async function getRecordWithLegacyFallback(repo: any, playerId: string, userId: string, stageId: string) {
  const byPlayer = await repo.getPlayerRecord(playerId, stageId).catch(() => null);
  if (byPlayer || playerId === userId) return byPlayer;
  return repo.getPlayerRecord(userId, stageId).catch(() => null);
}

// ─── GET /stages — 스테이지 목록 + 플레이어 진행도 (JWT 있으면) ──

stagesRoutes.get('/stages', async (c) => {
  const authHeader = c.req.header('Authorization');
  let userId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      await jwtAuth(c, async () => { userId = c.get('userId'); });
    } catch { /* ignore */ }
  }

  const playerId = userId ? await playerIdForUser(userId) : null;
  const repo = await getBattleRepo();
  const dbStages = await repo.getStages();

  // data/stages.ts의 스테이지와 DB 스테이지 병합 (JSON 모드에서는 data/stages.ts만 사용)
  const rawStages = dbStages.length > 0 ? dbStages : STAGES;
  const stages = [...rawStages].sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const result = await Promise.all(stages.map(async (s: any) => {
    const staticStage = STAGES.find((item) => item.id === s.id);
    const bosses = getStageBosses(s.id);
    const requiredStageId = requiredStageIdFor(s.entryRequirement);
    const enabled = s.enabled === undefined ? true : Boolean(s.enabled);

    let progress = null;
    let unlocked = !requiredStageId || s.sequence === 1;
    if (playerId && userId) {
      progress = await getProgressWithLegacyFallback(repo, playerId, userId, s.id);
      if (!unlocked && requiredStageId) {
        const [prevProgress, prevRecord] = await Promise.all([
          getProgressWithLegacyFallback(repo, playerId, userId, requiredStageId),
          getRecordWithLegacyFallback(repo, playerId, userId, requiredStageId),
        ]);
        unlocked = Boolean(progress?.unlockedAt)
          || Boolean(prevProgress?.firstClearedAt)
          || (prevRecord?.totalClears || 0) > 0;
      }
    }

    return {
      id: s.id, name: s.name, description: s.description,
      sequence: s.sequence, durationSeconds: s.durationSeconds,
      recommendedPower: s.recommendedPower,
      enemySet: parseStageJsonArray<string>(s.enemySet, staticStage?.enemySet ?? []),
      bossTimings: parseStageJsonArray<number>(s.bossTimings, staticStage?.bossTimings ?? []),
      maxKills: s.maxKills ?? staticStage?.maxKills ?? 300,
      maxCoreEnergy: s.maxCoreEnergy ?? staticStage?.maxCoreEnergy ?? 300,
      corePerKill: s.corePerKill ?? staticStage?.corePerKill ?? 5,
      scrapPerKill: s.scrapPerKill ?? staticStage?.scrapPerKill ?? 1,
      entryRequirement: s.entryRequirement,
      enabled,
      bosses: bosses.map((b) => ({
        code: b.code, name: b.name, description: b.description,
        hp: b.hp, attackPower: b.attackPower, patterns: b.patterns,
        scrapBonus: b.scrapBonus,
      })),
      unlocked,
      canEnter: enabled && unlocked,
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

  const staticStage = STAGES.find((item) => item.id === stageId);
  const bosses = getStageBosses(stageId);
  return c.json({
    ...stage,
    enemySet: parseStageJsonArray<string>(stage.enemySet, staticStage?.enemySet ?? []),
    bossTimings: parseStageJsonArray<number>(stage.bossTimings, staticStage?.bossTimings ?? []),
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

// ─── GET /stages/:id/requirements — 출격 조건 ──

stagesRoutes.get('/stages/:id/requirements', async (c) => {
  const stageId = c.req.param('id')!;
  const repo = await getBattleRepo();
  const stages = await repo.getStages();
  const stage = stages.find((s: any) => s.id === stageId) || STAGES.find((s) => s.id === stageId);
  if (!stage) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  const requirements: Record<string, unknown>[] = [];

  // 1. 이전 스테이지 클리어 조건
  const requiredStageId = requiredStageIdFor(stage.entryRequirement);
  if (requiredStageId) {
    const prevStage = stages.find((s: any) => s.id === requiredStageId) || STAGES.find((s) => s.id === requiredStageId);
    requirements.push({
      type: 'prev_stage_clear',
      label: `이전 스테이지 클리어`,
      required: requiredStageId,
      requiredName: prevStage?.name || requiredStageId,
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

export default stagesRoutes;
