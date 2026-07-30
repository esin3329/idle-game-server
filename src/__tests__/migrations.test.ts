import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Drizzle migrations', () => {
  it('lists every committed migration in its journal', async () => {
    const journal = JSON.parse(
      await readFile(resolve('src/db/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(journal.entries.map(({ tag }) => tag)).toEqual([
      '0000_init',
      '0001_battle',
      '0002_remaining',
    ]);
  });

  it('separates SQL statements for the Drizzle migrator', async () => {
    for (const tag of ['0000_init', '0001_battle', '0002_remaining']) {
      const migration = await readFile(resolve(`src/db/migrations/${tag}.sql`), 'utf8');
      const stmtCount = (migration.match(/--> statement-breakpoint/g) ?? []).length;
      expect(stmtCount).toBeGreaterThanOrEqual(1);
    }
  });
});
