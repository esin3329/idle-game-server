/**
 * 초기 운영자 시드
 *
 * 최초 운영자 계정 + 역할·권한 생성. 재실행 안전 (upsert).
 * 공개 회원가입 API로는 role='operator' 생성 불가.
 *
 * 실행: npx tsx src/db/seed-operator.ts
 * 환경변수: OPERATOR_EMAIL, OPERATOR_PASSWORD (미설정 시 기본값)
 */
import { hash } from 'bcryptjs';
import { getDb } from './connection.js';
import { users, operatorRoles, operatorPermissions, operatorRolePermissions } from './schema.js';
import { eq, and } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
type OperatorRole = InferSelectModel<typeof operatorRoles>;
type OperatorPermission = InferSelectModel<typeof operatorPermissions>;

const db = getDb();

const EMAIL = process.env.OPERATOR_EMAIL || 'admin@projectcoreforge.local';
const PASSWORD = process.env.OPERATOR_PASSWORD || 'admin-change-me-immediately';
const NICKNAME = '시스템운영자';

async function seedOperator() {
  const now = new Date();

  // ─── MVP 역할 seed ───
  const roles = [
    { code: 'admin', name: '최고 관리자', description: '모든 운영 권한 보유' },
    { code: 'operator', name: '운영자', description: '사용자 관리 및 제재, 일반 지급' },
    { code: 'viewer', name: '조회 전용', description: '사용자·전투·원장 조회만 가능' },
    { code: 'support', name: '고객 지원', description: '사용자 조회 및 로그 확인' },
    { code: 'game_master', name: '게임 마스터', description: '조회·제재·제한적 지급' },
    { code: 'administrator', name: '시스템 관리자', description: '운영 권한 관리 및 고위험 작업' },
  ];

  for (const r of roles) {
    const existing = await db.select().from(operatorRoles).where(eq(operatorRoles.code, r.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(operatorRoles).values({ id: crypto.randomUUID(), ...r, createdAt: now, updatedAt: now });
      console.log(`  [CREATED] Role: ${r.code}`);
    }
  }

  // ─── MVP 권한 seed ───
  const perms = [
    { code: 'admin.users.read', name: '사용자 조회', description: '사용자 목록·상세·원장·전투 조회' },
    { code: 'admin.wallets.read', name: '지갑 조회', description: '지갑 잔액·원장 조회' },
    { code: 'admin.inventories.read', name: '인벤토리 조회', description: '아이템·설계도·파츠 조회' },
    { code: 'admin.battles.read', name: '전투 조회', description: '전투 세션·결과·기록 조회' },
    { code: 'admin.users.write', name: '사용자 제재', description: '제재 생성·철회' },
    { code: 'admin.sanctions.read', name: '제재 조회', description: '제재 이력·상태 조회' },
    { code: 'admin.sanctions.write', name: '제재 관리', description: '제재 생성·철회·사유 변경' },
    { code: 'admin.grants.read', name: '지급 조회', description: '운영 지급 이력 조회' },
    { code: 'admin.grants.create', name: '지급 생성', description: '재화·아이템 지급 (한도 내)' },
    { code: 'admin.grants.low', name: '일반 지급', description: '10,000 미만 재화·아이템 지급' },
    { code: 'admin.grants.high', name: '고액 지급', description: '10,000 이상 재화·아이템 지급' },
    { code: 'admin.security.read', name: '보안 조회', description: '보안 이벤트·감사 로그 조회' },
    { code: 'admin.security.write', name: '보안 검토', description: '보안 이벤트 검토·해결·제재' },
    { code: 'admin.audit_logs.read', name: '감사 로그 조회', description: '운영 감사 로그·변경 이력 조회' },
    { code: 'admin.operators.read', name: '운영자 조회', description: '운영자 목록·권한 조회' },
    { code: 'admin.operators.manage', name: '운영자 관리', description: '운영자 생성·역할 변경' },
  ];

  for (const p of perms) {
    const existing = await db.select().from(operatorPermissions).where(eq(operatorPermissions.code, p.code)).limit(1);
    if (existing.length === 0) {
      await db.insert(operatorPermissions).values({ id: crypto.randomUUID(), ...p, createdAt: now });
      console.log(`  [CREATED] Permission: ${p.code}`);
    }
  }

  // ─── 역할-권한 매핑 seed ───
  const allRoles = await db.select().from(operatorRoles);
  const allPerms = await db.select().from(operatorPermissions);
  const rolePermMap: Record<string, string[]> = {
    admin: ['admin.users.read', 'admin.users.write', 'admin.grants.low', 'admin.grants.high', 'admin.security.read', 'admin.security.review', 'admin.operators.manage'],
    operator: ['admin.users.read', 'admin.users.write', 'admin.grants.low', 'admin.security.read', 'admin.security.review'],
    viewer: ['admin.users.read', 'admin.security.read'],
    support: ['admin.users.read', 'admin.security.read'],
    game_master: ['admin.users.read', 'admin.users.write', 'admin.grants.low', 'admin.security.read', 'admin.security.review'],
    administrator: ['admin.users.read', 'admin.users.write', 'admin.grants.low', 'admin.grants.high', 'admin.security.read', 'admin.security.review', 'admin.operators.manage'],
  };

  for (const [roleCode, permCodes] of Object.entries(rolePermMap)) {
    const role: OperatorRole | undefined = allRoles.find((r: OperatorRole) => r.code === roleCode);
    if (!role) continue;
    for (const pc of permCodes) {
      const perm: OperatorPermission | undefined = allPerms.find((p: OperatorPermission) => p.code === pc);
      if (!perm) continue;
      const existing = await db.select().from(operatorRolePermissions)
        .where(and(eq(operatorRolePermissions.roleId, role.id), eq(operatorRolePermissions.permissionId, perm.id))).limit(1);
      if (existing.length === 0) {
        await db.insert(operatorRolePermissions).values({ id: crypto.randomUUID(), roleId: role.id, permissionId: perm.id, createdAt: now });
      }
    }
  }
  console.log('  [OK] Role-permission mappings seeded');

  // ─── 최초 운영자 계정 ───
  const existing = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);

  const passwordHash = await hash(PASSWORD, 10);

  if (existing.length > 0) {
    await db.update(users).set({ passwordHash, role: 'admin', status: 'active', updatedAt: now }).where(eq(users.email, EMAIL));
    console.log(`[UPDATED] Operator: ${EMAIL} (role: admin)`);
  } else {
    await db.insert(users).values({
      id: crypto.randomUUID(), email: EMAIL, nickname: NICKNAME,
      passwordHash, role: 'admin', status: 'active', createdAt: now, updatedAt: now,
    });
    console.log(`[CREATED] Operator: ${EMAIL} (role: admin)`);
  }

  console.log('\n⚠️  IMPORTANT: Change the default password immediately.');
  console.log('   Set OPERATOR_EMAIL and OPERATOR_PASSWORD environment variables.\n');
  console.log('✅ Roles (3), Permissions (7), and operator account seeded.\n');
}

seedOperator().catch((err) => {
  console.error('Operator seed failed:', err);
  process.exit(1);
});
