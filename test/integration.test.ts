import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';
import { Firestore } from '@google-cloud/firestore';

import { httpInvocation, startFunctionFramework } from '../utils/functionFramework';
import { TARGETS } from '..';

const PORT = 8084;
const TARGET = TARGETS.MAIN;

let functionFrameworkProcess: Awaited<ReturnType<typeof startFunctionFramework>> | undefined;
let gcpProjectID: string | undefined;
let db: Firestore;

beforeAll(async () => {
  gcpProjectID = `forex-api-daily-integration-${new Date().getTime()}`;
  db = new Firestore({ projectId: gcpProjectID });
  functionFrameworkProcess = await startFunctionFramework(TARGET, gcpProjectID, PORT);
});

afterEach(async () => {
  const collection = db.collection('exchange_rates');
  const snapshot = await collection.get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  if (snapshot.size > 0) {
    await batch.commit();
  }
});

afterAll(() => {
  if (functionFrameworkProcess) {
    functionFrameworkProcess.kill();
  }
});

describe('Cloud Function Integration Tests', () => {
  describe('First run - fresh database', () => {
    it('stores all exchange rates on first run', async () => {
      const response = await httpInvocation(TARGET, PORT);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toMatch(/^SUCCESS 2025-11-21 31-0$/);

      const exchangeRates = await db.collection('exchange_rates').get();
      expect(exchangeRates.size).toBe(31);
    });

    it('stores EUR-based rates', async () => {
      await httpInvocation(TARGET, PORT);

      const eurDoc = await db.collection('exchange_rates').doc('EUR-2025-11-21').get();
      expect(eurDoc.exists).toBe(true);

      const data = eurDoc.data() as { base: string; date: string; rates: Record<string, number> };
      expect(data.base).toBe('EUR');
      expect(data.date).toBe('2025-11-21');
      expect(data.rates).toBeDefined();
      expect(Object.keys(data.rates).length).toBeGreaterThan(0);
    });

    it('stores cross rates for USD', async () => {
      await httpInvocation(TARGET, PORT);

      const usdDoc = await db.collection('exchange_rates').doc('USD-2025-11-21').get();
      expect(usdDoc.exists).toBe(true);

      const data = usdDoc.data() as { base: string; rates: Record<string, number> };
      expect(data.base).toBe('USD');
      expect(data.rates.EUR).toBeDefined();
      expect(data.rates.EUR).toBeCloseTo(1 / 1.152, 10);
    });

    it('stores rates for all major currencies', async () => {
      await httpInvocation(TARGET, PORT);

      const currencies = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'];
      const docs = await Promise.all(
        currencies.map(currency => db.collection('exchange_rates').doc(`${currency}-2025-11-21`).get()),
      );

      expect(docs.every(doc => doc.exists)).toBe(true);
    });
  });

  describe('Second run - data already exists', () => {
    it('does not duplicate existing data', async () => {
      const response1 = await httpInvocation(TARGET, PORT);
      const text1 = await response1.text();
      expect(text1).toMatch(/^SUCCESS 2025-11-21 31-0$/);

      const response2 = await httpInvocation(TARGET, PORT);
      const text2 = await response2.text();
      expect(text2).toMatch(/^SUCCESS {2}0-0$/);

      const exchangeRates = await db.collection('exchange_rates').get();
      expect(exchangeRates.size).toBe(31);
    });

    it('returns success even when no new data', async () => {
      await httpInvocation(TARGET, PORT);

      const response = await httpInvocation(TARGET, PORT);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('SUCCESS');
    });
  });

  describe('Stale data cleanup', () => {
    it('removes old dates when new data arrives', async () => {
      const oldDate = '2025-11-20';
      const collection = db.collection('exchange_rates');
      const batch = db.batch();

      batch.set(collection.doc(`EUR-${oldDate}`), {
        date: oldDate,
        base: 'EUR',
        rates: { USD: 1.07 },
      });
      batch.set(collection.doc(`USD-${oldDate}`), {
        date: oldDate,
        base: 'USD',
        rates: { EUR: 0.9346 },
      });

      await batch.commit();

      const beforeCount = (await collection.get()).size;
      expect(beforeCount).toBe(2);

      await httpInvocation(TARGET, PORT);

      const afterSnapshot = await collection.get();
      const dates = afterSnapshot.docs.map(doc => {
        const data = doc.data() as { date: string };
        return data.date;
      });

      expect(dates.every((date: string) => date === '2025-11-21')).toBe(true);
      expect(dates.includes(oldDate)).toBe(false);
    });

    it('limits cleanup to 100 documents per run', async () => {
      const oldDate = '2025-11-19';
      const collection = db.collection('exchange_rates');
      const batch = db.batch();

      for (let i = 0; i < 110; i++) {
        batch.set(collection.doc(`TEST${i}-${oldDate}`), {
          date: oldDate,
          base: `TEST${i}`,
          rates: {},
        });
      }

      await batch.commit();

      await httpInvocation(TARGET, PORT);

      const afterSnapshot = await collection.where('date', '==', oldDate).get();
      expect(afterSnapshot.size).toBe(10);
    });
  });

  describe('Data integrity', () => {
    it('stores consistent cross-rate calculations', async () => {
      await httpInvocation(TARGET, PORT);

      const eurDoc = await db.collection('exchange_rates').doc('EUR-2025-11-21').get();
      const usdDoc = await db.collection('exchange_rates').doc('USD-2025-11-21').get();

      const eurData = eurDoc.data() as { rates: Record<string, number> };
      const usdData = usdDoc.data() as { rates: Record<string, number> };

      const eurToUsd = eurData.rates.USD;
      const usdToEur = usdData.rates.EUR;

      expect(eurToUsd * usdToEur).toBeCloseTo(1, 10);
    });

    it('stores all rates with same date', async () => {
      await httpInvocation(TARGET, PORT);

      const exchangeRates = await db.collection('exchange_rates').get();
      const dates = exchangeRates.docs.map(doc => {
        const data = doc.data() as { date: string };
        return data.date;
      });

      expect(dates.every((date: string) => date === '2025-11-21')).toBe(true);
    });

    it('stores valid numeric rates', async () => {
      await httpInvocation(TARGET, PORT);

      const exchangeRates = await db.collection('exchange_rates').get();
      const allRates = exchangeRates.docs.flatMap(doc => {
        const data = doc.data() as { rates: Record<string, number> };
        return Object.values(data.rates);
      });

      expect(allRates.every(rate => typeof rate === 'number' && !Number.isNaN(rate))).toBe(true);
      expect(allRates.every(rate => rate > 0)).toBe(true);
    });

    it('stores unique document keys', async () => {
      await httpInvocation(TARGET, PORT);

      const exchangeRates = await db.collection('exchange_rates').get();
      const ids = exchangeRates.docs.map(doc => doc.id);

      expect(ids.length).toBe(new Set(ids).size);
    });
  });

  describe('Response format', () => {
    it('returns correct response format on success', async () => {
      const response = await httpInvocation(TARGET, PORT);
      const text = await response.text();

      expect(text).toMatch(/^SUCCESS \d{4}-\d{2}-\d{2} \d+-\d+$/);
    });

    it('includes date in response', async () => {
      const response = await httpInvocation(TARGET, PORT);
      const text = await response.text();

      expect(text).toContain('2025-11-21');
    });

    it('includes items stored count in response', async () => {
      const response = await httpInvocation(TARGET, PORT);
      const text = await response.text();

      expect(text).toContain('31-');
    });

    it('includes items removed count in response', async () => {
      const response = await httpInvocation(TARGET, PORT);
      const text = await response.text();

      expect(text).toMatch(/-\d+$/);
    });
  });
});
