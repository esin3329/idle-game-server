/**
 * 운영자 비밀번호 재설정 (PostgreSQL, 로컬 인증 전용)
 *
 * 기존 운영자의 password_hash/updated_at만 바꾼다. role·status는 절대 변경하지 않는다.
 * (db:seed-operator는 초기 admin 시드 전용이며 계정을 role=admin/status=active로 덮어쓴다.)
 *
 * 실행: npm run db:reset-operator-password
 * 환경변수: DATABASE_URL, OPERATOR_EMAIL, OPERATOR_NEW_PASSWORD (기본값 없음)
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, withPostgresTransaction, closePostgresPool } from './postgres-connection.js';
import { users, operatorAuditLogs } from './postgres-schema.js';
import { usesSupabaseAuth } from '../shared/supabase-auth.js';

const OPERATOR_ROLES: readonly string[] = ['operator', 'admin', 'administrator', 'viewer', 'support', 'game_master'];
const MIN_PASSWORD_LENGTH = 8;

export async function resetOperatorPassword(email: string, newPassword: string): Promise<void> {
  if (usesSupabaseAuth()) {
    throw new Error('AUTH_PROVIDER=supabase에서는 Supabase Auth에서 비밀번호를 재설정해야 합니다.');
  }
  const targetEmail = email.trim();
  if (!targetEmail) throw new Error('운영자 이메일이 필요합니다.');
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  }
  const passwordHash = await hash(newPassword, 10);

  await withPostgresTransaction(async () => {
    const db = getDb();
    const rows = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, targetEmail)).limit(1).for('update');
    if (rows.length === 0) throw new Error(`사용자를 찾을 수 없습니다: ${targetEmail}`);
    if (!OPERATOR_ROLES.includes(rows[0].role)) throw new Error(`운영자 계정이 아닙니다: ${targetEmail}`);

    const now = new Date();
    await db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, rows[0].id));
    await db.insert(operatorAuditLogs).values({
      id: crypto.randomUUID(),
      operatorId: 'cli',
      action: 'operator_password_reset',
      targetType: 'user',
      targetId: rows[0].id,
      reasonCode: 'password_reset',
      reasonText: 'Password reset via CLI',
      beforeSummary: '{}',
      afterSummary: JSON.stringify({ role: rows[0].role }),
      result: 'success',
      createdAt: now,
    });
  });
}

async function main(): Promise<void> {
  try {
    await resetOperatorPassword(process.env.OPERATOR_EMAIL ?? '', process.env.OPERATOR_NEW_PASSWORD ?? '');
    console.log(`[OK] Operator password reset: ${(process.env.OPERATOR_EMAIL ?? '').trim()} (role/status unchanged)`);
  } catch (err) {
    console.error('Operator password reset failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await closePostgresPool();
  }
}

// 직접 실행할 때만 동작 (integration check 등에서 import 시 풀을 닫지 않는다)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
