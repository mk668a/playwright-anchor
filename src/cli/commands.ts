import { AnchorStore } from '../core/store.js';
import type { AnchorFile } from '../core/types.js';

/** original selector → healed selector, {} when the cache file is absent. */
export function snapshotAnchors(cacheFile: string): Record<string, string> {
  const file = new AnchorStore(cacheFile).read();
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(file.anchors)) {
    map[key] = entry.healed;
  }
  return map;
}

export interface AnchorDiff {
  added: string[];
  changed: string[];
}

export function diffAnchors(
  before: Record<string, string>,
  after: Record<string, string>,
): AnchorDiff {
  const added: string[] = [];
  const changed: string[] = [];
  for (const key of Object.keys(after).sort()) {
    if (!(key in before)) added.push(key);
    else if (before[key] !== after[key]) changed.push(key);
  }
  return { added, changed };
}

export function formatHealSummary(
  cacheFile: string,
  after: Record<string, string>,
  diff: AnchorDiff,
): string[] {
  const touched = [...diff.added, ...diff.changed];
  if (touched.length === 0) {
    return ['[playwright-anchor] no new heals.'];
  }
  const lines = [`[playwright-anchor] ${touched.length} selector(s) healed:`];
  for (const key of touched) {
    const mark = diff.changed.includes(key) ? ' (updated)' : '';
    lines.push(`  "${key}" → "${after[key]}"${mark}`);
  }
  lines.push(`Review and commit ${cacheFile}`);
  return lines;
}

export function formatList(file: AnchorFile): string[] {
  const keys = Object.keys(file.anchors).sort();
  if (keys.length === 0) return ['(empty — no healed selectors committed yet)'];
  return keys.map((key) => {
    const e = file.anchors[key]!;
    const meta = [e.model, e.healedAt].filter(Boolean).join(', ');
    return `"${key}" → "${e.healed}"${meta ? `  [${meta}]` : ''}`;
  });
}

/** Returns false when the key was not present. */
export function removeEntry(cacheFile: string, key: string): boolean {
  const store = new AnchorStore(cacheFile);
  if (!store.get(key)) return false;
  store.delete(key);
  return true;
}
