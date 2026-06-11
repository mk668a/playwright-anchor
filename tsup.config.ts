import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: { entry: { index: 'src/index.ts' } },
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  clean: true,
  external: ['@playwright/test'],
});
