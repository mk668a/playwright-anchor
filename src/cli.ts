#!/usr/bin/env node
/**
 * playwright-anchor CLI — the dev-time entry point for humans and coding
 * agents alike. `heal`/`replay` wrap `npx playwright test` with the right
 * mode and report what changed in the cache; `list`/`rm` manage the cache.
 * There is intentionally no server and no CI mode beyond `replay`.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { AnchorStore } from './core/store.js';
import {
  diffAnchors,
  formatHealSummary,
  formatList,
  removeEntry,
  snapshotAnchors,
} from './cli/commands.js';

const HELP = `playwright-anchor — heal once, replay forever, zero LLM in CI

Usage:
  playwright-anchor heal   [--cache <file>] [playwright test args...]
  playwright-anchor replay [--cache <file>] [playwright test args...]
  playwright-anchor list   [--cache <file>]
  playwright-anchor rm <original-selector> [--cache <file>]

Commands:
  heal     Run \`npx playwright test\` in heal mode (local LLM allowed),
           then print which selectors were healed. Review & commit the diff.
  replay   Run \`npx playwright test\` in replay mode (zero LLM) — verify
           locally that CI will pass before pushing.
  list     Print committed heals.
  rm       Remove one committed heal (forces a fresh heal next run).

Options:
  --cache <file>   Cache file (default: .playwright-anchors.json in cwd)

Environment (heal mode): PLAYWRIGHT_ANCHOR_LLM_URL (default Ollama,
http://127.0.0.1:11434/v1), PLAYWRIGHT_ANCHOR_LLM_MODEL, PLAYWRIGHT_ANCHOR_LLM_API_KEY
`;

function extractCacheFlag(args: string[]): { cache: string; rest: string[] } {
  const rest: string[] = [];
  let cache = '.playwright-anchors.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cache' && args[i + 1]) {
      cache = args[++i]!;
    } else {
      rest.push(args[i]!);
    }
  }
  return { cache: resolve(cache), rest };
}

function runPlaywright(mode: 'heal' | 'replay', cache: string, args: string[]): Promise<number> {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return new Promise((resolvePromise) => {
    const child = spawn(npx, ['playwright', 'test', ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_ANCHOR_MODE: mode,
        PLAYWRIGHT_ANCHOR_CACHE: cache,
      },
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
    child.on('error', (err) => {
      console.error(`[playwright-anchor] failed to run npx playwright test: ${err.message}`);
      resolvePromise(1);
    });
  });
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'heal':
    case 'replay': {
      const { cache, rest } = extractCacheFlag(args);
      const before = snapshotAnchors(cache);
      const code = await runPlaywright(command, cache, rest);
      if (command === 'heal') {
        const after = snapshotAnchors(cache);
        for (const line of formatHealSummary(cache, after, diffAnchors(before, after))) {
          console.log(line);
        }
      }
      return code;
    }
    case 'list': {
      const { cache } = extractCacheFlag(args);
      for (const line of formatList(new AnchorStore(cache).read())) console.log(line);
      return 0;
    }
    case 'rm': {
      const { cache, rest } = extractCacheFlag(args);
      const key = rest[0];
      if (!key) {
        console.error('usage: playwright-anchor rm <original-selector> [--cache <file>]');
        return 1;
      }
      if (!removeEntry(cache, key)) {
        console.error(`[playwright-anchor] no committed heal for "${key}"`);
        return 1;
      }
      console.log(`[playwright-anchor] removed heal for "${key}" — next heal run will re-resolve it`);
      return 0;
    }
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(HELP);
      return command === undefined ? 1 : 0;
    default:
      console.error(`[playwright-anchor] unknown command "${command}"\n`);
      console.log(HELP);
      return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
