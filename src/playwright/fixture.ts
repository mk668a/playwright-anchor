import { test as base, expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { isAbsolute, join } from 'node:path';
import { AnchorEngine } from '../core/engine.js';
import { LlmHealer } from '../core/llm.js';
import { AnchorStore } from '../core/store.js';
import type { AnchorMode } from '../core/types.js';
import { PlaywrightAdapter } from './adapter.js';

export interface AnchorLlmOptions {
  /** OpenAI-compatible base URL. Default: http://127.0.0.1:11434/v1 (Ollama). */
  baseURL?: string;
  /** Model name. Default: llama3.2 */
  model?: string;
  /** Only needed for endpoints you own that require a key. */
  apiKey?: string;
  requestTimeoutMs?: number;
}

export interface AnchorOptions {
  /**
   * heal   — broken selectors are repaired via your local LLM (default locally)
   * replay — cache only, never calls an LLM (default when CI env var is set)
   * off    — anchor() behaves like page.locator()
   */
  mode?: AnchorMode;
  /** Cache file path. Default: <playwright rootDir>/.playwright-anchors.json */
  cacheFile?: string;
  /** ms to wait before declaring a selector broken. Default: 2000 */
  resolveTimeout?: number;
  /** LLM proposals to try per heal. Default: 2 */
  maxAttempts?: number;
  /** First-choice attribute for derived selectors. Default: data-testid */
  testIdAttribute?: string;
  /** Suppress the one-line heal log. */
  quiet?: boolean;
  llm?: AnchorLlmOptions;
}

/** Locator methods forwarded by the thenable anchor wrapper. */
const FORWARDED = [
  'click', 'dblclick', 'fill', 'press', 'pressSequentially', 'check', 'uncheck',
  'setChecked', 'selectOption', 'hover', 'focus', 'blur', 'tap', 'clear',
  'setInputFiles', 'waitFor', 'textContent', 'innerText', 'innerHTML',
  'getAttribute', 'inputValue', 'isVisible', 'isHidden', 'isEnabled',
  'isDisabled', 'isEditable', 'isChecked', 'count', 'allTextContents',
  'allInnerTexts', 'boundingBox', 'screenshot', 'scrollIntoViewIfNeeded',
  'selectText', 'highlight', 'dispatchEvent', 'ariaSnapshot', 'dragTo',
  'evaluate', 'evaluateAll',
] as const;

type ForwardedMethod = (typeof FORWARDED)[number];

/**
 * Thenable locator: action methods resolve the anchor first, then forward.
 * `await anchor('#x')` yields a genuine Playwright Locator, so
 * `expect(await anchor('#x')).toBeVisible()` works unchanged.
 */
export type AnchorLocator = PromiseLike<Locator> & {
  [K in ForwardedMethod]: Locator[K];
};

export type AnchorFn = ((selector: string) => AnchorLocator) & {
  /** Resolve to a genuine Locator (same as `await anchor(sel)`). */
  resolve(selector: string): Promise<Locator>;
};

interface ResolvedConfig {
  mode: AnchorMode;
  cacheFile: string;
  resolveTimeout: number;
  maxAttempts: number;
  testIdAttribute: string;
  quiet: boolean;
  llm: Required<Pick<AnchorLlmOptions, 'baseURL' | 'model'>> &
    Pick<AnchorLlmOptions, 'apiKey' | 'requestTimeoutMs'>;
}

/** Precedence: env > test.use options > defaults. */
function resolveConfig(options: AnchorOptions, testInfo: TestInfo): ResolvedConfig {
  const env = process.env;
  const mode = (env.PLAYWRIGHT_ANCHOR_MODE as AnchorMode | undefined) ??
    options.mode ??
    (env.CI ? 'replay' : 'heal');
  if (mode !== 'heal' && mode !== 'replay' && mode !== 'off') {
    throw new Error(`[playwright-anchor] unknown mode "${mode}" (expected heal|replay|off)`);
  }
  const rawCache = env.PLAYWRIGHT_ANCHOR_CACHE ?? options.cacheFile ?? '.playwright-anchors.json';
  const cacheFile = isAbsolute(rawCache) ? rawCache : join(testInfo.config.rootDir, rawCache);
  return {
    mode,
    cacheFile,
    resolveTimeout: options.resolveTimeout ?? 2000,
    maxAttempts: options.maxAttempts ?? 2,
    testIdAttribute: options.testIdAttribute ?? 'data-testid',
    quiet: options.quiet ?? false,
    llm: {
      baseURL: env.PLAYWRIGHT_ANCHOR_LLM_URL ?? options.llm?.baseURL ?? 'http://127.0.0.1:11434/v1',
      model: env.PLAYWRIGHT_ANCHOR_LLM_MODEL ?? options.llm?.model ?? 'llama3.2',
      apiKey: env.PLAYWRIGHT_ANCHOR_LLM_API_KEY ?? options.llm?.apiKey,
      requestTimeoutMs: options.llm?.requestTimeoutMs,
    },
  };
}

function makeAnchorLocator(resolve: () => Promise<Locator>): AnchorLocator {
  let memo: Promise<Locator> | undefined;
  const resolved = () => (memo ??= resolve());
  const target: Record<string, unknown> = {
    then: (
      onFulfilled?: ((value: Locator) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => resolved().then(onFulfilled, onRejected),
  };
  for (const name of FORWARDED) {
    target[name] = (...args: unknown[]) =>
      resolved().then((loc) => (loc[name] as (...a: unknown[]) => unknown)(...args));
  }
  return target as unknown as AnchorLocator;
}

export function createAnchor(page: Page, options: AnchorOptions, testInfo: TestInfo): AnchorFn {
  const cfg = resolveConfig(options, testInfo);
  const store = new AnchorStore(cfg.cacheFile);
  const healer = cfg.mode === 'heal' ? new LlmHealer(cfg.llm) : null;
  const engine = new AnchorEngine(store, healer, {
    mode: cfg.mode,
    maxAttempts: cfg.maxAttempts,
    // eslint-disable-next-line no-console
    log: cfg.quiet ? () => {} : (message) => console.log(message),
  });
  const adapter = new PlaywrightAdapter(page, {
    resolveTimeout: cfg.resolveTimeout,
    testIdAttribute: cfg.testIdAttribute,
  });

  // Per-test memo: a broken original selector is only probed once per test.
  const memo = new Map<string, Promise<Locator>>();
  const resolveLocator = (selector: string): Promise<Locator> => {
    let p = memo.get(selector);
    if (!p) {
      p = engine.resolve(selector, adapter).then((r) => page.locator(r.selector));
      p.catch(() => memo.delete(selector));
      memo.set(selector, p);
    }
    return p;
  };

  const fn = ((selector: string) => makeAnchorLocator(() => resolveLocator(selector))) as AnchorFn;
  fn.resolve = resolveLocator;
  return fn;
}

export interface AnchorFixtures {
  anchorOptions: AnchorOptions;
  anchor: AnchorFn;
}

export const test = base.extend<AnchorFixtures>({
  anchorOptions: [{}, { option: true }],
  anchor: async ({ page, anchorOptions }, use, testInfo) => {
    await use(createAnchor(page, anchorOptions, testInfo));
  },
});

export { expect };
