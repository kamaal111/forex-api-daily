import { beforeAll, afterAll } from 'vitest';

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : 'unknown';

    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return originalFetch(...args);
    }

    throw new Error(
      `Network request blocked in test: ${url}\n` +
        'Tests should not make real network requests. Use fixtures or mocks instead.',
    );
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
