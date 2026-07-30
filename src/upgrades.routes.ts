import { Hono } from 'hono';
import { ALL_UPGRADES, UPGRADE_GROUPS, getUpgrade, getUpgradesByGroup } from './data/upgrades.js';

const upgradesRoutes = new Hono();

// ─── GET /upgrades — 전체 강화 카탈로그 ──────────

upgradesRoutes.get('/upgrades', (c) => {
  return c.json({ upgrades: ALL_UPGRADES, groups: UPGRADE_GROUPS });
});

// ─── GET /upgrades/:id — 단일 강화 상세 ─────────

upgradesRoutes.get('/upgrades/:id', (c) => {
  const id = c.req.param('id')!;
  const upgrade = getUpgrade(id);
  if (!upgrade) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  return c.json(upgrade);
});

// ─── GET /upgrades/group/:groupId — 그룹별 강화 목록

upgradesRoutes.get('/upgrades/group/:groupId', (c) => {
  const groupId = c.req.param('groupId')!;
  const upgrades = getUpgradesByGroup(groupId);
  return c.json({ group: groupId, upgrades });
});

export default upgradesRoutes;
