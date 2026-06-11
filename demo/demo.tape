# VHS tape for the README demo GIF (storyboard: docs/launch/playwright-anchor.md)
# Prereqs: brew install vhs && ollama pull llama3.2 && ollama serve (separate terminal)
# Run from the repo root: vhs demo/demo.tape

Output demo/demo.gif
Set FontSize 15
Set Width 1100
Set Height 640
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

# 1 — the locator is broken: plain Playwright fails
Type "PLAYWRIGHT_ANCHOR_MODE=off npx playwright test -c demo"
Enter
Sleep 11s

# 2 — a local model is all we need
Type "ollama list"
Enter
Sleep 2.5s

# 3 — heal once, locally
Type "npx playwright-anchor heal -c demo"
Enter
Sleep 14s

# 4 — the heal is a git diff (hero frame — thumbnail this)
# (CLI writes the cache at the repo root, lockfile-style)
Type "git add -N .playwright-anchors.json && git --no-pager diff -- .playwright-anchors.json"
Enter
Sleep 5s

# 5 — CI replays with zero LLM calls: green even with the LLM endpoint dead
Type "CI=1 PLAYWRIGHT_ANCHOR_CACHE=$PWD/.playwright-anchors.json PLAYWRIGHT_ANCHOR_LLM_URL=http://127.0.0.1:9/v1 npx playwright test -c demo"
Enter
Sleep 9s
Sleep 2s
