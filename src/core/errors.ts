import type { AnchorEntry } from './types.js';

/**
 * Thrown in replay mode (the CI default) when a selector neither resolves
 * nor has a committed heal in the cache file.
 */
export class AnchorReplayError extends Error {
  constructor(
    public readonly original: string,
    cacheFile: string,
    staleEntry?: AnchorEntry,
  ) {
    const stale = staleEntry
      ? `A committed heal exists ("${staleEntry.healed}") but it no longer resolves either. `
      : '';
    super(
      `[playwright-anchor] "${original}" did not resolve and replay mode never calls an LLM. ` +
        stale +
        `Run the test locally in heal mode (PLAYWRIGHT_ANCHOR_MODE=heal, with e.g. Ollama running), ` +
        `then review and commit ${cacheFile}.`,
    );
    this.name = 'AnchorReplayError';
  }
}

/** Thrown in heal mode when the LLM cannot produce a working selector. */
export class AnchorHealError extends Error {
  constructor(original: string, detail: string) {
    super(`[playwright-anchor] failed to heal "${original}": ${detail}`);
    this.name = 'AnchorHealError';
  }
}
