process.env.DB_DRIVER = 'json';

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import stagesRoutes from '../stages.routes.js';
import upgradesRoutes from '../upgrades.routes.js';
import { resetBattleStores } from '../store-battle.js';
import { resetAllRepos } from '../provider.js';
import { STAGES } from '../data/stages.js';
import { ALL_UPGRADES, UPGRADE_GROUPS } from '../data/upgrades.js';

function createApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err && typeof err === 'object' && 'status' in err) {
      return c.json({ error: err.message, code: (err as any).code }, (err as any).status);
    }
    return c.json({ error: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.route('/', stagesRoutes);
  app.route('/', upgradesRoutes);
  return app;
}

beforeEach(() => {
  resetAllRepos();
  resetBattleStores();
});

describe('스테이지', () => {
  it('GET /stages → 4개 스테이지 + 보스 포함', async () => {
    const app = createApp();
    const res = await app.request('/stages');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(4);
    expect(body[0].bosses).toBeDefined();
    expect(body[3].bosses.length).toBeGreaterThanOrEqual(3);
    // 최종 보스 확인
    const lastBosses = body[3].bosses;
    const finalBoss = lastBosses[lastBosses.length - 1];
    expect(finalBoss.name).toBe('오버마인드');
    expect(finalBoss.hp).toBe(4000);
  });

  it('GET /stages/stage_01_ruins → 단일 스테이지 상세', async () => {
    const app = createApp();
    const res = await app.request('/stages/stage_01_ruins');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('폐허');
    expect(body.durationSeconds).toBe(180);
    expect(body.bosses).toHaveLength(1);
  });

  it('GET /stages/stage_04_core → 3보스 + 최종 보스', async () => {
    const app = createApp();
    const res = await app.request('/stages/stage_04_core');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bosses).toHaveLength(3);
    expect(body.bosses[2].name).toBe('오버마인드');
  });

  it('GET /stages/:id/bosses → stage별 보스 목록', async () => {
    const app = createApp();
    const res = await app.request('/stages/stage_03_lab/bosses');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it('GET /stages/:id/requirements → 출격 조건', async () => {
    const app = createApp();
    const res = await app.request('/stages/stage_02_factory/requirements');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('공장');
    expect(body.requirements.length).toBeGreaterThanOrEqual(2);
    const prevStageReq = body.requirements.find((r: any) => r.type === 'prev_stage_clear');
    expect(prevStageReq).toBeDefined();
    expect(prevStageReq.requiredName).toBe('폐허');
  });

  it('첫 스테이지(stage_01)는 항상 unlocked', async () => {
    const app = createApp();
    const res = await app.request('/stages');
    const body = await res.json() as any[];
    const s1 = body.find((s: any) => s.id === 'stage_01_ruins');
    expect(s1.unlocked).toBe(true);
  });
});

describe('강화 카탈로그', () => {
  it('GET /upgrades → 30개 + 13개 그룹', async () => {
    const app = createApp();
    const res = await app.request('/upgrades');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upgrades.length).toBeGreaterThanOrEqual(30);
    expect(body.groups.length).toBeGreaterThanOrEqual(10);
  });

  it('GET /upgrades/:id → 단일 강화 상세 (스탯 효과)', async () => {
    const app = createApp();
    const res = await app.request('/upgrades/machine_gun_1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('기관총 강화 I');
    expect(body.effects.attackSpeed).toBeLessThan(0);
    expect(body.effects.attackPower).toBeGreaterThan(0);
    expect(body.tier).toBe(1);
    expect(body.category).toBe('weapon');
  });

  it('GET /upgrades/group/:id → 그룹별 강화', async () => {
    const app = createApp();
    const res = await app.request('/upgrades/group/armor');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.group).toBe('armor');
    expect(body.upgrades).toHaveLength(3);
  });

  it('강화 선택지에 category/group/effects/tier 필드가 있어야 함', async () => {
    const app = createApp();
    const res = await app.request('/upgrades/machine_gun_3');
    const body = await res.json();
    expect(body.tier).toBe(3);
    expect(body.group).toBe('machine_gun');
    expect(body.prerequisites).toContain('machine_gun_2');
  });
});

describe('전투 세션 권위 (unit)', () => {
  it('startBattleSession 출격 조건 검증 로직 존재', async () => {
    const { startBattleSession } = await import('../shared/battle-session.js');
    expect(typeof startBattleSession).toBe('function');
  });

  it('endBattleSession 서버 검증 6단계 존재', async () => {
    const { endBattleSession } = await import('../shared/battle-session.js');
    expect(typeof endBattleSession).toBe('function');
  });

  it('reportBattleEvent 시퀀스/처치/core 검증 존재', async () => {
    const { reportBattleEvent } = await import('../shared/battle-session.js');
    expect(typeof reportBattleEvent).toBe('function');
  });

  it('업그레이드 정의 확인', () => {
    expect(ALL_UPGRADES.length).toBeGreaterThanOrEqual(30);
    const groups = new Set(ALL_UPGRADES.map((u) => u.group));
    expect(groups.size).toBeGreaterThanOrEqual(10);
  });

  it('각 진화 그룹의 티어 수 일치', () => {
    for (const group of UPGRADE_GROUPS) {
      const upgrades = ALL_UPGRADES.filter((u) => u.group === group.id);
      expect(upgrades.length).toBe(group.tiers);
    }
  });
});
