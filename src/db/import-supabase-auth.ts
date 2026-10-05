import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const accountsSchema = z.array(z.object({
  id: z.uuid(), email: z.email(), passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/),
}));

const input = process.argv[2];
if (!input || input.startsWith('--')) throw new Error('Usage: tsx src/db/import-supabase-auth.ts users.json [--apply --target https://PROJECT.supabase.co]');
const accounts = accountsSchema.parse(JSON.parse(await readFile(input, 'utf8')));
if (new Set(accounts.map(account => account.id)).size !== accounts.length ||
    new Set(accounts.map(account => account.email.toLowerCase())).size !== accounts.length) {
  throw new Error('Duplicate IDs or emails in import input');
}
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'dry-run', accounts: accounts.length, uuidAndBcryptValidated: true }));
} else {
  const targetIndex = process.argv.indexOf('--target');
  const target = targetIndex < 0 ? undefined : process.argv[targetIndex + 1];
  const configured = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!target || target !== configured || !key || new URL(target).protocol !== 'https:') {
    throw new Error('--target must match SUPABASE_URL (HTTPS); SUPABASE_SERVICE_ROLE_KEY is required');
  }
  for (const account of accounts) {
    const response = await fetch(`${target}/auth/v1/admin/users`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: account.id, email: account.email, password_hash: account.passwordHash, email_confirm: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Import stopped at user ${account.id}: HTTP ${response.status}. Inspect target before retrying.`);
    const imported = z.object({ id: z.uuid() }).parse(await response.json());
    if (imported.id !== account.id) throw new Error(`Imported identity mismatch for ${account.id}`);
    console.log(JSON.stringify({ importedUserId: imported.id }));
  }
}
