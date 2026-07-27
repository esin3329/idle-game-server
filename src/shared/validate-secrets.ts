import { logger } from './logger.js';

const REQUIRED_IN_PRODUCTION: { name: string; defaultHint: string }[] = [
  { name: 'JWT_ACCESS_SECRET', defaultHint: 'dev-secret-change-in-production' },
  { name: 'JWT_REFRESH_SECRET', defaultHint: 'dev-secret-change-in-production' },
  { name: 'DB_PASSWORD', defaultHint: 'changeme' },
  { name: 'MYSQL_ROOT_PASSWORD', defaultHint: 'changeme' },
];

export function validateProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];

  for (const { name, defaultHint } of REQUIRED_IN_PRODUCTION) {
    const value = process.env[name];
    if (!value || value === defaultHint || value === '') {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    logger.error({ missing }, 'Production secrets not configured. Server will not start.');
    throw new Error(`Missing or default production secrets: ${missing.join(', ')}. Set them in .env or environment.`);
  }

  logger.info('Production secrets validated');
}
