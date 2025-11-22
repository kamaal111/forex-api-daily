import { describe, it, expect } from 'vitest';

describe('Network Request Blocking', () => {
  it('blocks external network requests', async () => {
    await expect(fetch('https://www.google.com')).rejects.toThrow(
      /Network request blocked in test: https:\/\/www\.google\.com/,
    );
  });

  it('blocks ECB website requests', async () => {
    await expect(fetch('https://www.ecb.europa.eu/home/html/rss.en.html')).rejects.toThrow(
      /Network request blocked in test.*ecb\.europa\.eu/,
    );
  });

  it('provides helpful error message on blocked requests', async () => {
    try {
      await fetch('https://example.com/api');
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).toContain('Network request blocked in test');
        expect(error.message).toContain('https://example.com/api');
        expect(error.message).toContain('Use fixtures or mocks instead');
      }
    }
  });

  it('blocks requests to IP addresses', async () => {
    await expect(fetch('http://8.8.8.8')).rejects.toThrow(/Network request blocked in test/);
  });

  it('blocks HTTPS requests', async () => {
    await expect(fetch('https://api.github.com')).rejects.toThrow(/Network request blocked in test/);
  });

  it('blocks requests with query parameters', async () => {
    await expect(fetch('https://example.com/api?key=value&other=test')).rejects.toThrow(
      /Network request blocked in test/,
    );
  });

  it('blocks requests using Request object', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(fetch(request)).rejects.toThrow(/Network request blocked in test.*example\.com/);
  });

  it('blocks different protocols', async () => {
    await expect(fetch('http://httpbin.org/get')).rejects.toThrow(/Network request blocked in test/);
    await expect(fetch('https://httpbin.org/get')).rejects.toThrow(/Network request blocked in test/);
  });
});


