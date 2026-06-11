---
name: playwright-anchor-heal
description: Use when Playwright tests fail with locator/selector errors ("waiting for locator", TimeoutError, AnchorReplayError) in a project that uses playwright-anchor. Runs the one-time local heal, then presents the .playwright-anchors.json diff for human review. Never enables heal mode in CI.
---

# playwright-anchor: heal broken locators (dev-time only)

This project uses [playwright-anchor](https://github.com/mk668a/playwright-anchor):
broken locators are healed **once, locally**, by a model the user runs themselves;
the fix is committed to `.playwright-anchors.json`; CI replays it with zero LLM calls.

Your job is to run the heal step and hand the resulting **diff** to the user for
review. You are the workflow driver — the heal itself happens via the user's own
local model, and the committed artifact is what makes CI deterministic.

## Steps

1. Confirm the failing test actually uses `anchor()` (from `playwright-anchor`).
   If it uses plain `page.locator()`, either fix the selector manually or suggest
   wrapping the brittle selector with `anchor()` first.
2. Check a local model endpoint is reachable (default: Ollama at
   `http://127.0.0.1:11434/v1`). If not, ask the user to start one
   (`ollama serve`) or to set `PLAYWRIGHT_ANCHOR_LLM_URL` / `_LLM_MODEL` /
   `_LLM_API_KEY` to an endpoint they own. Do not pick a paid endpoint yourself.
3. Run the heal, scoped to the failing spec when possible:

   ```bash
   npx playwright-anchor heal -- <failing-spec-or-grep-args>
   ```

   (Equivalent: `PLAYWRIGHT_ANCHOR_MODE=heal npx playwright test ...`)
4. Show the user `git diff .playwright-anchors.json` and summarize each entry:
   original selector → healed selector, and whether the healed selector looks
   right for the element the test intends.
5. Verify determinism before handing off: `npx playwright-anchor replay` must
   pass with the LLM endpoint stopped or unset. This is exactly what CI will run.
6. Let the **user** review and commit the cache diff. If a healed selector looks
   wrong, remove it (`npx playwright-anchor rm "<original>"`) and fix the test
   manually instead.

## Hard rules

- **Never set `PLAYWRIGHT_ANCHOR_MODE=heal` in CI config.** CI must stay
  deterministic; a cache miss in CI must fail loudly.
- Never edit `.playwright-anchors.json` by hand to "make tests pass" — entries
  must come from a verified heal run.
- If the heal fails (`AnchorHealError`), the element is probably gone for real:
  treat it as a genuine test failure, not something to force through.
