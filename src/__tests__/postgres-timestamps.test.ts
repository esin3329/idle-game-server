import { describe, expect, it } from 'vitest';
import { postgresTimestampToIso, toPostgresDate } from '../db/postgres-timestamps.js';

describe('PostgreSQL timestamp boundary', () => {
  it('preserves Date inputs and normalizes ISO string inputs to the same instant', () => {
    const expected = '2026-10-05T08:34:56.789Z';
    const date = new Date(expected);

    expect(toPostgresDate(date)).toBe(date);
    expect(toPostgresDate(expected).getTime()).toBe(date.getTime());
    expect(postgresTimestampToIso(expected)).toBe(expected);
    expect(postgresTimestampToIso(date)).toBe(expected);
  });

  it('rejects invalid timestamp values at the repository boundary', () => {
    expect(() => toPostgresDate('not-a-timestamp')).toThrow(TypeError);
  });
});
