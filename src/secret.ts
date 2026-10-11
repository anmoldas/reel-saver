import { timingSafeEqual } from 'node:crypto';

// Your SECRET is the password that every request to the app must include, so only you can add to your sheet.

/**
 * Does the secret a request sent match yours? timingSafeEqual takes the same time whether the first
 * or last character is wrong, so nobody can guess the secret by timing the answers.
 */
export function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
