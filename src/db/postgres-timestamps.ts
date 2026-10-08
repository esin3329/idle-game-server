export function toPostgresDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid PostgreSQL timestamp');
  return date;
}

export function postgresTimestampToIso(value: Date | string): string {
  return toPostgresDate(value).toISOString();
}
