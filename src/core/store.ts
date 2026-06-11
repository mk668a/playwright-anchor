import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AnchorEntry, AnchorFile } from './types.js';

const EMPTY: AnchorFile = { version: 1, anchors: {} };

/**
 * Persistence for `.playwright-anchors.json`.
 *
 * Playwright workers are separate OS processes, so every write re-reads the
 * file (merge) and lands via tmp-file + rename (atomic). Keys are sorted so
 * the committed file produces stable, reviewable git diffs.
 */
export class AnchorStore {
  constructor(public readonly filePath: string) {}

  read(): AnchorFile {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, anchors: { ...EMPTY.anchors } };
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `[playwright-anchor] cache file ${this.filePath} is not valid JSON — ` +
          `fix or delete it. (${(err as Error).message})`,
      );
    }
    const file = parsed as AnchorFile;
    if (!file || typeof file !== 'object' || typeof file.anchors !== 'object' || file.anchors === null) {
      throw new Error(
        `[playwright-anchor] cache file ${this.filePath} has an unexpected shape — ` +
          `expected {"version":1,"anchors":{...}}.`,
      );
    }
    return file;
  }

  get(key: string): AnchorEntry | undefined {
    return this.read().anchors[key];
  }

  set(key: string, entry: AnchorEntry): void {
    const file = this.read();
    file.anchors[key] = entry;
    this.write(file);
  }

  delete(key: string): void {
    const file = this.read();
    if (!(key in file.anchors)) return;
    delete file.anchors[key];
    this.write(file);
  }

  private write(file: AnchorFile): void {
    const sorted: AnchorFile = { version: 1, anchors: {} };
    for (const key of Object.keys(file.anchors).sort()) {
      sorted.anchors[key] = file.anchors[key]!;
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
    renameSync(tmp, this.filePath);
  }
}
