import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Drizzle migrations', () => {
  it('lists every committed migration in its journal', async () => {
    const journal = JSON.parse(
      await readFile(resolve('src/db/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(journal.entries.map(({ tag }) => tag)).toEqual(['0000_init', '0001_battle']);
  });
});
