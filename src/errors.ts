/** A failure that retrying will not fix (private post, deleted post, bad link). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

/** Waits before each retry of a temporary failure. Tests set these to 0. */
export const retryDelaysMs = [2000, 6000];

/**
 * Runs `attempt` again after a short wait while `isTemporary` says the failure will likely pass
 * (Gemini "high demand", a Sheet hiccup). Gives up with the last error after the retries.
 */
export async function withRetry<T>(attempt: () => Promise<T>, isTemporary: (err: unknown) => boolean): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (i >= retryDelaysMs.length || !isTemporary(err)) throw err;
      await new Promise((r) => setTimeout(r, retryDelaysMs[i]));
    }
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
