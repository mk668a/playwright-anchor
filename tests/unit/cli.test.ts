import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  diffAnchors,
  formatHealSummary,
  formatList,
  removeEntry,
  snapshotAnchors,
} from '../../src/cli/commands.js';
import { AnchorStore } from '../../src/core/store.js';

let dir: string;
let cache: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anchor-cli-'));
  cache = join(dir, 'anchors.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entry = (healed: string) => ({ healed, healedAt: '2026-01-01T00:00:00.000Z', model: 'm' });

describe('snapshotAnchors', () => {
  it('returns {} for a missing cache file', () => {
    expect(snapshotAnchors(cache)).toEqual({});
  });

  it('maps original → healed', () => {
    new AnchorStore(cache).set('#a', entry('[data-testid="a"]'));
    expect(snapshotAnchors(cache)).toEqual({ '#a': '[data-testid="a"]' });
  });
});

describe('diffAnchors', () => {
  it('detects added and changed heals', () => {
    const diff = diffAnchors(
      { '#a': 'old-a', '#b': 'b' },
      { '#a': 'new-a', '#b': 'b', '#c': 'c' },
    );
    expect(diff).toEqual({ added: ['#c'], changed: ['#a'] });
  });
});

describe('formatHealSummary', () => {
  it('reports no-op runs', () => {
    expect(formatHealSummary(cache, {}, { added: [], changed: [] })).toEqual([
      '[playwright-anchor] no new heals.',
    ]);
  });

  it('lists healed selectors and the commit reminder', () => {
    const lines = formatHealSummary(
      cache,
      { '#a': '[data-testid="a"]', '#b': 'b2' },
      { added: ['#a'], changed: ['#b'] },
    );
    expect(lines[0]).toContain('2 selector(s) healed');
    expect(lines).toContainEqual('  "#a" → "[data-testid="a"]"');
    expect(lines).toContainEqual('  "#b" → "b2" (updated)');
    expect(lines.at(-1)).toContain(cache);
  });
});

describe('formatList', () => {
  it('handles an empty cache', () => {
    expect(formatList({ version: 1, anchors: {} })[0]).toContain('empty');
  });

  it('prints sorted entries with metadata', () => {
    const store = new AnchorStore(cache);
    store.set('#z', entry('zz'));
    store.set('#a', entry('aa'));
    const lines = formatList(store.read());
    expect(lines[0]).toContain('"#a" → "aa"');
    expect(lines[0]).toContain('[m, 2026-01-01');
    expect(lines[1]).toContain('"#z"');
  });
});

describe('removeEntry', () => {
  it('removes an existing heal and reports missing keys', () => {
    new AnchorStore(cache).set('#a', entry('aa'));
    expect(removeEntry(cache, '#a')).toBe(true);
    expect(snapshotAnchors(cache)).toEqual({});
    expect(removeEntry(cache, '#a')).toBe(false);
  });
});
