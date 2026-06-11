# playwright-anchor

> **Heal once. Replay forever. Zero LLM in CI.**

<p align="center">
  <img src="https://raw.githubusercontent.com/mk668a/playwright-anchor/main/demo/demo.gif" alt="A broken locator fails red, llama3.2 heals it once locally, the heal lands as a reviewable git diff, and CI replays it green with the LLM endpoint dead" width="100%">
</p>

When a Playwright locator breaks, `playwright-anchor` asks **your own local LLM** (Ollama, llama.cpp, LM Studio — anything OpenAI-compatible) to find the element **once**, derives a durable selector deterministically, and writes it to `.playwright-anchors.json` — a file you **review and commit like a lockfile**. Self-healing as a git diff, not a CI behavior:

```diff
--- a/.playwright-anchors.json
+++ b/.playwright-anchors.json
@@
+    "#old-buy-button": {
+      "healed": "[data-testid=\"buy-now\"]",
+      "healedAt": "2026-06-11T09:14:03.512Z",
+      "model": "llama3.2",
+      "reason": "same purchase button, renamed id",
+      "via": "ref"
+    }
```

From then on — locally, in CI, forever — the heal replays from the committed cache. **CI never talks to an LLM.** No API key, no Redis, no cloud service, no per-run nondeterminism.

## Why not runtime self-healing?

Every existing approach re-heals on every run, *inside* CI. That makes test results nondeterministic — the exact reason the Playwright team [declined to build self-healing into Playwright](https://github.com/microsoft/playwright/issues/10872) ("It is important for our customers to know if the test failed or passed").

`playwright-anchor` treats **healing as a code change.** It happens on your machine, with your model, and lands in your repo as a reviewable diff. CI just replays it.

|  | playwright-anchor | runtime self-healing tools | editor healing agents |
|---|---|---|---|
| When healing happens | once, locally, before commit | every run, inside CI | interactively, in your editor |
| LLM calls in CI | **0** | per broken locator | — |
| The fix is | a committed, reviewable JSON diff | runtime behavior | a patch to test source |
| Extra infrastructure | none | varies (cache stores, API keys) | an agent loop |

## Quick start

```bash
npm i -D playwright-anchor
ollama pull llama3.2        # or any model you like
```

Swap one import and use `anchor()` where locators tend to rot:

```ts
// before: import { test, expect } from '@playwright/test';
import { test, expect } from 'playwright-anchor';

test('checkout', async ({ page, anchor }) => {
  await page.goto('/shop');

  await anchor('#buy-button').click();          // actions work directly
  const status = await anchor('.order-status'); // `await` → genuine Locator
  await expect(status).toHaveText('purchased'); // web-first assertions work unchanged
});
```

That's it. While selectors keep working, `anchor()` behaves exactly like `page.locator()`. When one breaks:

1. **Locally** (heal mode): your local model gets an accessibility snapshot of the page, picks the element the broken selector meant, `playwright-anchor` derives a durable selector (test-id → id → stable attributes → CSS path, uniqueness-verified), saves it to `.playwright-anchors.json`, and the test proceeds. You review the diff and commit it.
2. **In CI** (replay mode, automatic when `CI` is set): the committed heal resolves instantly with zero LLM calls. A cache miss fails loudly with instructions — never silently, never nondeterministically.

## Modes

| Mode | When | Behavior |
|---|---|---|
| `heal` | default locally | broken selector → cache → local LLM (once) → commit |
| `replay` | default when `CI` env is set | broken selector → cache only. Miss = actionable failure. **Never calls an LLM.** |
| `off` | — | `anchor()` behaves like `page.locator()` |

## Configuration

Via `test.use()` (or per-project in `playwright.config.ts`):

```ts
test.use({
  anchorOptions: {
    mode: 'heal',                          // heal | replay | off
    cacheFile: '.playwright-anchors.json', // relative to Playwright rootDir
    resolveTimeout: 2000,                  // ms before a selector counts as broken
    testIdAttribute: 'data-testid',        // first choice for derived selectors
    llm: {
      baseURL: 'http://127.0.0.1:11434/v1', // any OpenAI-compatible endpoint
      model: 'llama3.2',
      // apiKey: only if your own endpoint needs one
    },
  },
});
```

Environment variables override options: `PLAYWRIGHT_ANCHOR_MODE`, `PLAYWRIGHT_ANCHOR_CACHE`, `PLAYWRIGHT_ANCHOR_LLM_URL`, `PLAYWRIGHT_ANCHOR_LLM_MODEL`, `PLAYWRIGHT_ANCHOR_LLM_API_KEY`.

## How healing works (and why small models are enough)

The LLM is never asked to *write* a selector. It receives Playwright's accessibility snapshot (`ariaSnapshot({ mode: 'ai' })`) where every element carries a `[ref=eN]` marker, and only has to **point at the right element**:

```json
{"ref": "e12", "reason": "same purchase button, renamed id"}
```

`playwright-anchor` then derives the committed selector **deterministically** in the browser — preferring your test-id attribute, then ids, then stable attributes, then a minimal CSS path — and verifies it resolves uniquely before saving. Picking one element from a labeled list is easy enough that 3–8B local models handle it well; the part that must be precise is never delegated to the model.

## CLI

```bash
npx playwright-anchor heal     # run tests in heal mode, then show what was healed
npx playwright-anchor replay   # verify locally what CI will do (zero LLM)
npx playwright-anchor list     # print committed heals
npx playwright-anchor rm "#old-selector"   # drop one heal (re-heals next run)
```

`heal`/`replay` pass any extra arguments through to `npx playwright test`.

## Using with Claude Code / coding agents

playwright-anchor is built for the "agent proposes, human reviews, CI replays" workflow — at **dev time only**. Ship the bundled skill to your repo and your agent will drive the heal step and hand you the diff:

```bash
cp -r node_modules/playwright-anchor/skills/playwright-anchor .claude/skills/
```

The skill makes the agent: run `npx playwright-anchor heal` against your local model, show you `git diff .playwright-anchors.json`, verify with `replay` (zero LLM — exactly what CI runs), and leave the commit decision to you.

## BYO model — your hardware, your keys, your choice

This tool is **bring-your-own-inference** by design:

- **No maintainer-provided API, no embedded keys, no telemetry.** Nobody pays per-token costs but you — and with a local model, you don't either.
- **Provider-agnostic.** Anything speaking the OpenAI chat-completions protocol works: Ollama, llama.cpp server, LM Studio, vLLM — or your own Anthropic/OpenAI key via their OpenAI-compatible endpoints. Swap with one env var.
- **Fully local / offline capable.** The default configuration (`http://127.0.0.1:11434/v1`) never leaves your machine.
- **CI needs no model at all.** Replay mode is pure JSON lookup.

## FAQ

**What if the original selector starts working again?**
The original always wins: cache entries are only consulted when the original fails. Stale entries are inert (and easy to spot in the JSON).

**What about dynamic pages where the element genuinely isn't there?**
Then the heal fails too — `anchor()` does not invent elements. You get an `AnchorHealError`/`AnchorReplayError` instead of a false green. Healing repairs *renamed/moved* elements, it does not paper over real regressions.

**Do I have to wrap every locator?**
No. Use `anchor()` for selectors that historically rot (deep CSS, generated ids); keep `page.getByRole()` and friends everywhere else.

**Does this replace good locators?**
No — it's a safety net plus a migration path: every heal upgrades a brittle selector to the most durable one available (ideally your test-id).

**Can I use this from Claude Code / Cursor / my agent loop?**
Yes — as the *heal step*, at dev time. Let your agent run `PLAYWRIGHT_ANCHOR_MODE=heal npx playwright test`, then review the `.playwright-anchors.json` diff like any other change it proposes. CI is unaffected either way: it only replays the committed cache.

## License

MIT
