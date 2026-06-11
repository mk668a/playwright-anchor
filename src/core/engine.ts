import { AnchorHealError, AnchorReplayError } from './errors.js';
import type { AnchorStore } from './store.js';
import type {
  AnchorAdapter,
  AnchorEntry,
  AnchorMode,
  Healer,
  ResolveResult,
} from './types.js';

export interface EngineOptions {
  mode: AnchorMode;
  /** How many LLM proposals to try before giving up. */
  maxAttempts: number;
  log: (message: string) => void;
}

/**
 * The resolve → cache → replay loop. Domain-agnostic: everything
 * browser-specific is behind {@link AnchorAdapter}, everything
 * model-specific behind {@link Healer}.
 */
export class AnchorEngine {
  constructor(
    private readonly store: AnchorStore,
    private readonly healer: Healer | null,
    private readonly opts: EngineOptions,
  ) {}

  async resolve(original: string, adapter: AnchorAdapter): Promise<ResolveResult> {
    if (this.opts.mode === 'off') {
      return { selector: original, source: 'original' };
    }

    // The original selector always wins while it still works.
    if (await adapter.tryResolve(original)) {
      return { selector: original, source: 'original' };
    }

    const entry = this.store.get(original);
    if (entry && (await adapter.tryResolve(entry.healed))) {
      return { selector: entry.healed, source: 'cache', entry };
    }

    if (this.opts.mode === 'replay') {
      throw new AnchorReplayError(original, this.store.filePath, entry);
    }

    if (!this.healer) {
      throw new AnchorHealError(
        original,
        'heal mode is active but no healer is configured.',
      );
    }

    let previousFailure: string | undefined;
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      const snapshot = await adapter.capture();
      const proposal = await this.healer.propose({
        original,
        snapshot,
        attempt,
        previousFailure,
      });
      const durable = await adapter.materialize(proposal);
      if (durable) {
        const healedEntry: AnchorEntry = {
          healed: durable,
          healedAt: new Date().toISOString(),
          model: this.healer.describe(),
          reason: proposal.reason,
          via: proposal.ref ? 'ref' : 'selector',
        };
        this.store.set(original, healedEntry);
        this.opts.log(
          `[playwright-anchor] healed "${original}" → "${durable}" (${healedEntry.model}) — ` +
            `review and commit ${this.store.filePath}`,
        );
        return { selector: durable, source: 'healed', entry: healedEntry };
      }
      previousFailure = `proposal ${JSON.stringify(proposal)} did not resolve to a unique element`;
    }

    throw new AnchorHealError(
      original,
      `no working selector after ${this.opts.maxAttempts} attempt(s). Last failure: ${previousFailure}`,
    );
  }
}
