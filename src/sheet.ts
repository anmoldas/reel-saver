import { errorMessage, withRetry } from './errors.js';
import type { Env, Row } from './types.js';

// Apps Script now and then answers with an error page instead of JSON; a retry usually works.
// Writes are safe to repeat: the script skips a save that is already in the sheet.
function call(env: Env, payload: Record<string, unknown>): Promise<any> {
  return withRetry(() => callOnce(env, payload), (err) => /^Sheet endpoint returned non-JSON \((404|429|5\d\d)\)/.test(errorMessage(err)));
}

async function callOnce(env: Env, payload: Record<string, unknown>): Promise<any> {
  // Apps Script answers POSTs with a redirect to the result; fetch follows it.
  const res = await fetch(env.SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.SECRET, ...payload }),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Sheet endpoint returned non-JSON (${res.status}). Check SHEET_URL and the web app's access setting`);
  }
  if (!data.ok) throw new Error(`Sheet: ${data.error ?? 'unknown error'}`);
  return data;
}

/** Is this URL already saved (ignoring failed rows)? Also returns the Topics and Place types tabs. */
export async function findExisting(
  env: Env,
  sourceUrl: string,
): Promise<{ exists: boolean; title?: string; type?: string; topics?: string[]; place_types?: string[] }> {
  return call(env, { action: 'check', source_url: sourceUrl });
}

/** Appends rows. Replaces earlier "failed" rows for the same URL. */
export async function writeRows(env: Env, sourceUrl: string, rows: Row[]): Promise<{ written: number; duplicate?: boolean }> {
  return call(env, { action: 'write', source_url: sourceUrl, rows });
}
