import { z } from 'zod';
import type { Context, Next } from 'hono';
import { BadRequestError } from './errors.js';

// ─── UUID 검증 ──────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * :id 파라미터가 UUID 형식인지 검증하는 미들웨어
 */
export async function validatePlayerId(c: Context, next: Next) {
  const id = c.req.param('id');
  if (!UUID_REGEX.test(id)) {
    throw new BadRequestError('잘못된 플레이어 ID 형식입니다.');
  }
  await next();
}

// ─── Zod 스키마 ─────────────────────────────────────

export const createPlayerSchema = z.object({
  nickname: z
    .string()
    .min(2, '닉네임은 2자 이상이어야 합니다.')
    .max(20, '닉네임은 20자 이하여야 합니다.')
    .regex(/^[a-zA-Z0-9가-힣 _-]+$/, '허용되지 않는 문자가 포함되어 있습니다.'),
});

// ─── 제네릭 검증 미들웨어 ────────────────────────────

export function validateJson<T>(schema: z.ZodSchema<T>) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new BadRequestError('잘못된 JSON 형식입니다.');
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join(', ');
      throw new BadRequestError(message);
    }

    c.set('parsedBody', result.data);
    await next();
  };
}
