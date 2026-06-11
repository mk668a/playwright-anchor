import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchorEngine } from '../../src/core/engine.js';
import { AnchorHealError, AnchorReplayError } from '../../src/core/errors.js';
import { AnchorStore } from '../../src/core/store.js';
import type { AnchorAdapter, HealContext, Healer, HealProposal } from '../../src/core/types.js';

let dir: string;
let store: AnchorStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anchor-engine-'));
  store = new AnchorStore(join(dir, 'anchors.json'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

class FakeAdapter implements AnchorAdapter {
  tryResolveCalls: string[] = [];
  constructor(
    private resolvable: Set<string>,
    /** maps "ref:eN" or a proposed selector to the durable selector it materializes into */
    private materializeMap: Record<string, string | null> = {},
  ) {}
  async tryResolve(selector: string): Promise<boolean> {
    this.tryResolveCalls.push(selector);
    return this.resolvable.has(selector);
  }
  async capture(): Promise<string> {
    return '- button "Buy now" [ref=e2]';
  }
  async materialize(p: HealProposal): Promise<string | null> {
    const key = p.ref ? `ref:${p.ref}` : (p.selector ?? '');
    return this.materializeMap[key] ?? null;
  }
}

class FakeHealer implements Healer {
  calls: HealContext[] = [];
  constructor(private proposals: HealProposal[]) {}
  async propose(ctx: HealContext): Promise<HealProposal> {
    this.calls.push(ctx);
    const p = this.proposals.shift();
    if (!p) throw new Error('FakeHealer exhausted');
    return p;
  }
  describe(): string {
    return 'fake-model';
  }
}

const engineWith = (healer: Healer | null, mode: 'heal' | 'replay' | 'off', maxAttempts = 2) =>
  new AnchorEngine(store, healer, { mode, maxAttempts, log: vi.fn() });

describe('AnchorEngine', () => {
  it('mode=off passes the selector through without probing', async () => {
    const adapter = new FakeAdapter(new Set());
    const result = await engineWith(null, 'off').resolve('#x', adapter);
    expect(result).toEqual({ selector: '#x', source: 'original' });
    expect(adapter.tryResolveCalls).toEqual([]);
  });

  it('prefers the original selector while it still resolves', async () => {
    const healer = new FakeHealer([]);
    const adapter = new FakeAdapter(new Set(['#x']));
    const result = await engineWith(healer, 'heal').resolve('#x', adapter);
    expect(result.source).toBe('original');
    expect(healer.calls).toHaveLength(0);
  });

  it('uses a committed heal when the original is broken', async () => {
    store.set('#old', { healed: '[data-testid="new"]', healedAt: 'x' });
    const healer = new FakeHealer([]);
    const adapter = new FakeAdapter(new Set(['[data-testid="new"]']));
    const result = await engineWith(healer, 'heal').resolve('#old', adapter);
    expect(result).toMatchObject({ selector: '[data-testid="new"]', source: 'cache' });
    expect(healer.calls).toHaveLength(0);
  });

  it('replay mode throws an actionable error on cache miss and never heals', async () => {
    const adapter = new FakeAdapter(new Set());
    await expect(engineWith(null, 'replay').resolve('#gone', adapter)).rejects.toThrow(
      AnchorReplayError,
    );
    await expect(engineWith(null, 'replay').resolve('#gone', adapter)).rejects.toThrow(
      /heal mode/,
    );
  });

  it('replay mode mentions a stale committed heal that stopped resolving', async () => {
    store.set('#old', { healed: '#also-gone', healedAt: 'x' });
    const adapter = new FakeAdapter(new Set());
    await expect(engineWith(null, 'replay').resolve('#old', adapter)).rejects.toThrow(
      /no longer resolves/,
    );
  });

  it('heals once, persists the entry, and reports source=healed', async () => {
    const healer = new FakeHealer([{ ref: 'e2', reason: 'same button' }]);
    const adapter = new FakeAdapter(new Set(), { 'ref:e2': '[data-testid="buy"]' });
    const result = await engineWith(healer, 'heal').resolve('#old-buy', adapter);
    expect(result).toMatchObject({ selector: '[data-testid="buy"]', source: 'healed' });
    expect(healer.calls).toHaveLength(1);
    const saved = store.get('#old-buy');
    expect(saved).toMatchObject({
      healed: '[data-testid="buy"]',
      model: 'fake-model',
      via: 'ref',
      reason: 'same button',
    });
  });

  it('retries with failure feedback when the first proposal does not materialize', async () => {
    const healer = new FakeHealer([
      { ref: 'e99', reason: 'bad guess' },
      { ref: 'e2', reason: 'second try' },
    ]);
    const adapter = new FakeAdapter(new Set(), { 'ref:e2': '[data-testid="buy"]' });
    const result = await engineWith(healer, 'heal').resolve('#old', adapter);
    expect(result.selector).toBe('[data-testid="buy"]');
    expect(healer.calls).toHaveLength(2);
    expect(healer.calls[1]?.previousFailure).toMatch(/e99/);
  });

  it('throws AnchorHealError when all attempts fail', async () => {
    const healer = new FakeHealer([
      { ref: 'e99' },
      { ref: null, reason: 'nothing matches' },
    ]);
    const adapter = new FakeAdapter(new Set());
    await expect(engineWith(healer, 'heal').resolve('#old', adapter)).rejects.toThrow(
      AnchorHealError,
    );
  });

  it('throws when heal mode has no healer configured', async () => {
    const adapter = new FakeAdapter(new Set());
    await expect(engineWith(null, 'heal').resolve('#old', adapter)).rejects.toThrow(
      /no healer/,
    );
  });
});
