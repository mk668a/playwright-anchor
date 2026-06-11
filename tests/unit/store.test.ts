import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnchorStore } from '../../src/core/store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anchor-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry = (healed: string) => ({ healed, healedAt: '2026-01-01T00:00:00.000Z' });

describe('AnchorStore', () => {
  it('reads an empty file shape when the cache does not exist', () => {
    const store = new AnchorStore(join(dir, 'anchors.json'));
    expect(store.read()).toEqual({ version: 1, anchors: {} });
    expect(store.get('#x')).toBeUndefined();
  });

  it('round-trips entries', () => {
    const store = new AnchorStore(join(dir, 'anchors.json'));
    store.set('#old', entry('[data-testid="new"]'));
    expect(store.get('#old')?.healed).toBe('[data-testid="new"]');
  });

  it('writes sorted keys for stable git diffs', () => {
    const store = new AnchorStore(join(dir, 'anchors.json'));
    store.set('#zebra', entry('z'));
    store.set('#alpha', entry('a'));
    const raw = readFileSync(join(dir, 'anchors.json'), 'utf8');
    expect(raw.indexOf('#alpha')).toBeLessThan(raw.indexOf('#zebra'));
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('merges with what is on disk at write time (multi-process safety)', () => {
    const file = join(dir, 'anchors.json');
    const storeA = new AnchorStore(file);
    const storeB = new AnchorStore(file);
    storeA.set('#a', entry('a'));
    storeB.set('#b', entry('b'));
    expect(Object.keys(storeA.read().anchors).sort()).toEqual(['#a', '#b']);
  });

  it('throws a clear error on corrupted JSON instead of silently resetting', () => {
    const file = join(dir, 'anchors.json');
    writeFileSync(file, '{not json', 'utf8');
    const store = new AnchorStore(file);
    expect(() => store.read()).toThrow(/not valid JSON/);
  });

  it('deletes entries', () => {
    const store = new AnchorStore(join(dir, 'anchors.json'));
    store.set('#a', entry('a'));
    store.delete('#a');
    expect(store.get('#a')).toBeUndefined();
  });
});
