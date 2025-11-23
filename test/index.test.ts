import { afterAll, beforeAll, it, expect } from 'vitest';
import { Firestore } from '@google-cloud/firestore';

import { httpInvocation, startFunctionFramework } from '../utils/functionFramework';
import { TARGETS, uniques } from '../index';

const PORT = 8083;
const TARGET = TARGETS.MAIN;

let functionFrameworkProcess: Awaited<ReturnType<typeof startFunctionFramework>> | undefined;
let gcpProjectID: string | undefined;

beforeAll(async () => {
  gcpProjectID = `forex-api-daily-${new Date().getTime()}`;
  functionFrameworkProcess = await startFunctionFramework(TARGET, gcpProjectID, PORT);
});

afterAll(() => {
  if (functionFrameworkProcess) {
    functionFrameworkProcess.kill();
  }
});

it('successfully saves all documents', async () => {
  const response = await httpInvocation(TARGET, PORT);

  const itemsStoredCount = 31;
  const itemsRemovedCount = 0;
  const dateSaved = '2025-11-21';

  expect(await response.text()).toEqual(`SUCCESS ${dateSaved} ${itemsStoredCount}-${itemsRemovedCount}`);
  expect(response.status).toEqual(200);

  const db = new Firestore({ projectId: gcpProjectID });
  const exchangeRates = await db.collection('exchange_rates').get();
  const exchangeRateObjects = exchangeRates.docs.map(doc => doc.data() as { date: string; base: string });
  expect(exchangeRates.size).toEqual(itemsStoredCount);
  expect(exchangeRateObjects.map(({ date }) => date)).toEqual([...Array<string>(exchangeRates.size)].fill(dateSaved));
  expect(uniques(exchangeRateObjects.map(({ base }) => base)).length).toEqual(itemsStoredCount);
});
