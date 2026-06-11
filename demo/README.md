# Demo recording kit

One-command recording of the README GIF, doubling as the real-Ollama smoke test
(storyboard rationale: `docs/launch/playwright-anchor.md` in the parent workspace —
"show the diff, not the browser").

## Prereqs

```sh
brew install vhs ollama
ollama pull llama3.2
ollama serve   # keep running in another terminal
npm run build  # the CLI in the tape resolves via the package bin
```

## Record

```sh
rm -f .playwright-anchors.json   # start from an unhealed state (CLI writes at repo root)
vhs demo/demo.tape               # writes demo/demo.gif
```

> Note: the `heal` CLI resolves the cache at the repo root (lockfile-style), while the
> bare fixture resolves relative paths against the Playwright rootDir (`demo/`). The tape
> pins `PLAYWRIGHT_ANCHOR_CACHE=$PWD/.playwright-anchors.json` (absolute) on the CI step
> so both commands use the same file — verified working 2026-06-11 with a fake LLM.
> Worth unifying the default upstream before launch (UX papercut for real users too).

## What the tape shows

1. `PLAYWRIGHT_ANCHOR_MODE=off` — plain Playwright, `#old-buy-button` not found → red
2. `ollama list` — the only model involved is yours
3. `npx playwright-anchor heal -c demo` — one LLM call, durable selector derived → green
4. `git diff demo/.playwright-anchors.json` — **the heal is a reviewable diff** (thumbnail frame)
5. `CI=1` with the LLM URL pointed at a dead port — still green = zero LLM in CI, proven

If step 3 heals to anything other than `[data-testid="buy-now"]`, that's a real
smoke-test failure — investigate before publishing the GIF.
