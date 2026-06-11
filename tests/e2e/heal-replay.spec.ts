/**
 * Full-loop e2e: a broken selector is healed once via a fake OpenAI-compatible
 * LLM server, the durable selector lands in the cache file, and replay mode
 * then resolves it with zero LLM calls.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { test, expect } from '../../src/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.tmp', 'anchors.json');

const PAGE = `<!DOCTYPE html>
<html>
  <body>
    <header><h1>Shop</h1></header>
    <main>
      <a href="/cart">Cart</a>
      <button data-testid="buy-now">Buy now</button>
      <output id="status"></output>
    </main>
    <script>
      document.querySelector('[data-testid="buy-now"]').addEventListener('click', () => {
        document.getElementById('status').textContent = 'purchased';
      });
    </script>
  </body>
</html>`;

let server: http.Server;
let llmCalls = 0;

test.beforeAll(async () => {
  fs.rmSync(path.dirname(CACHE), { recursive: true, force: true });

  // Fake OpenAI-compatible endpoint: finds the "Buy now" button's [ref=eN]
  // marker in the aria snapshot we are sent and answers with that ref.
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      llmCalls++;
      const payload = JSON.parse(body) as { messages: Array<{ content: string }> };
      const user = payload.messages[1]?.content ?? '';
      const ref = user.match(/button "Buy now" \[ref=(e\d+)\]/)?.[1] ?? null;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ ref, reason: 'same purchase button, renamed id' }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.PLAYWRIGHT_ANCHOR_LLM_URL = `http://127.0.0.1:${port}/v1`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

test.describe('heal mode', () => {
  test.use({
    anchorOptions: {
      mode: 'heal',
      cacheFile: CACHE,
      resolveTimeout: 250,
      llm: { model: 'fake-model' },
      quiet: true,
    },
  });

  test('heals a broken selector once and commits a durable selector', async ({ page, anchor }) => {
    await page.setContent(PAGE);

    await anchor('#old-buy-button').click();
    await expect(page.locator('#status')).toHaveText('purchased');
    expect(llmCalls).toBe(1);

    const file = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    expect(file.anchors['#old-buy-button']).toMatchObject({
      healed: '[data-testid="buy-now"]',
      model: 'fake-model',
      via: 'ref',
    });
  });

  test('later runs hit the cache without calling the LLM again', async ({ page, anchor }) => {
    await page.setContent(PAGE);

    await anchor('#old-buy-button').click();
    await expect(page.locator('#status')).toHaveText('purchased');
    expect(llmCalls).toBe(1);
  });

  test('await anchor() yields a genuine Locator usable with expect()', async ({ page, anchor }) => {
    await page.setContent(PAGE);

    const button = await anchor('#old-buy-button');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Buy now');
    expect(llmCalls).toBe(1);
  });

  test('selectors that still resolve are passed through untouched', async ({ page, anchor }) => {
    await page.setContent(PAGE);

    await anchor('[data-testid="buy-now"]').click();
    await expect(page.locator('#status')).toHaveText('purchased');
    expect(llmCalls).toBe(1);
  });
});

test.describe('replay mode (the CI default)', () => {
  test.use({
    anchorOptions: {
      mode: 'replay',
      cacheFile: CACHE,
      resolveTimeout: 250,
      quiet: true,
    },
  });

  test('replays the committed heal with zero LLM calls', async ({ page, anchor }) => {
    await page.setContent(PAGE);

    await anchor('#old-buy-button').click();
    await expect(page.locator('#status')).toHaveText('purchased');
    expect(llmCalls).toBe(1);
  });

  test('cache miss fails with an actionable error instead of healing', async ({ page, anchor }) => {
    await page.setContent(PAGE);

    await expect(anchor('#never-existed').click()).rejects.toThrow(/playwright-anchor/);
    await expect(anchor('#never-existed').click()).rejects.toThrow(/heal mode/);
    expect(llmCalls).toBe(1);
  });
});
