import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '../src/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOP = pathToFileURL(path.join(HERE, 'shop.html')).href;

test('buy flow', async ({ page, anchor }) => {
  await page.goto(SHOP);

  // This selector broke when the button lost its id in a refactor.
  await anchor('#old-buy-button').click();

  await expect(page.locator('#status')).toHaveText('purchased');
});
