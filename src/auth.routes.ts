import { Hono } from 'hono';
import { z } from 'zod';
import { validateJson } from './shared/validator.js';
import { idempotencyGuard } from './shared/idempotency.js';
import { registerUser, loginUser, refreshTokens, revokeRefreshToken } from './shared/auth-service.js';

const authRoutes = new Hono<{ Variables: { parsedBody: { email?: string; password?: string; nickname?: string; refreshToken?: string }; idempotencyKey: string } }>();

const registerSchema = z.object({
  email: z.string().email('올바른 이메일을 입력하세요.'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
  nickname: z.string().min(2).max(20).regex(/^[a-zA-Z0-9가-힣 _-]+$/, '허용되지 않는 문자가 포함되어 있습니다.'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const tokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── POST /auth/register ────────────────────────────

authRoutes.post('/auth/register', idempotencyGuard, validateJson(registerSchema), async (c) => {
  const { email, password, nickname } = c.get('parsedBody') as z.infer<typeof registerSchema>;
  const result = await registerUser(email, password, nickname);
  return c.json(result, 201);
});

// ─── POST /auth/login ───────────────────────────────

authRoutes.post('/auth/login', validateJson(loginSchema), async (c) => {
  const { email, password } = c.get('parsedBody') as z.infer<typeof loginSchema>;
  const result = await loginUser(email, password);
  return c.json(result);
});

// ─── POST /auth/refresh ─────────────────────────────

authRoutes.post('/auth/refresh', validateJson(tokenSchema), async (c) => {
  const { refreshToken } = c.get('parsedBody') as z.infer<typeof tokenSchema>;
  const tokens = await refreshTokens(refreshToken);
  return c.json(tokens);
});

// ─── POST /auth/logout ──────────────────────────────

authRoutes.post('/auth/logout', validateJson(tokenSchema), async (c) => {
  const { refreshToken } = c.get('parsedBody') as z.infer<typeof tokenSchema>;
  await revokeRefreshToken(refreshToken);
  return c.json({ status: 'ok' });
});

export default authRoutes;
