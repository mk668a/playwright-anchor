export type AnchorMode = 'heal' | 'replay' | 'off';

/** One healed selector, as persisted in the cache file. */
export interface AnchorEntry {
  /** The durable selector that replaced the broken one. */
  healed: string;
  /** ISO timestamp of when the heal happened. */
  healedAt: string;
  /** Model identifier that proposed the heal (informational). */
  model?: string;
  /** One-line justification from the model (informational). */
  reason?: string;
  /** Whether the model picked an aria ref or wrote a selector directly. */
  via?: 'ref' | 'selector';
}

/** Shape of `.playwright-anchors.json`. */
export interface AnchorFile {
  version: 1;
  anchors: Record<string, AnchorEntry>;
}

/** What the LLM proposes for a broken selector. */
export interface HealProposal {
  /** Element reference from the aria snapshot, e.g. "e12". */
  ref?: string | null;
  /** Alternatively, a selector string proposed directly. */
  selector?: string | null;
  reason?: string;
}

export interface HealContext {
  original: string;
  /** Page snapshot with element refs, fed to the model. */
  snapshot: string;
  /** 1-based attempt counter. */
  attempt: number;
  /** Why the previous attempt was rejected, if any. */
  previousFailure?: string;
}

/**
 * Domain adapter. The core engine knows nothing about Playwright;
 * everything browser-specific goes through this interface.
 */
export interface AnchorAdapter {
  /** Whether the selector currently resolves to at least one element. */
  tryResolve(selector: string): Promise<boolean>;
  /** Compact snapshot of the current state, with refs, for the model. */
  capture(): Promise<string>;
  /**
   * Turn a proposal into a durable, verified selector.
   * Returns null when the proposal does not resolve to anything usable.
   */
  materialize(proposal: HealProposal): Promise<string | null>;
}

export interface Healer {
  propose(ctx: HealContext): Promise<HealProposal>;
  /** Identifier stored in cache metadata, e.g. "ollama/llama3.2". */
  describe(): string;
}

export interface ResolveResult {
  selector: string;
  source: 'original' | 'cache' | 'healed';
  entry?: AnchorEntry;
}
