import { defineConfig } from 'vitest/config';

const ONE_SECOND_IN_MS = 1000;

export default defineConfig({
  test: {
    testTimeout: ONE_SECOND_IN_MS * 40,
    setupFiles: ['./test/setup.ts'],
  },
});
