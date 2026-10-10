import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of the SECRET a request sent. */
export function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
