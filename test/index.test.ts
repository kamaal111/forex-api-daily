import { afterAll, beforeAll, it, expect } from 'vitest';
import { Firestore } from '@google-cloud/firestore';

import { httpInvocation, startFunctionFramework } from './utils/functionFramework';
import { uniques } from '../index';

const PORT = 8083;

let functionFrameworkProcess: Awaited<ReturnType<typeof startFunctionFramework>> | undefined;
let gcpProjectID: string | undefined;

beforeAll(async () => {
  gcpProjectID = `forex-api-daily-${new Date().getTime()}`;
  functionFrameworkProcess = await startFunctionFramework('main', gcpProjectID, PORT);
});

afterAll(() => {
  if (functionFrameworkProcess) {
    functionFrameworkProcess.kill();
  }
});

it('successfully saves all documents', async () => {
  const response = await httpInvocation('main', PORT);

  const itemsStoredCount = 30;
  const itemsRemovedCount = 0;
  const dateSaved = '2023-02-17';

  expect(await response.text()).toEqual(`SUCCESS ${dateSaved} ${itemsStoredCount}-${itemsRemovedCount}`);
  expect(response.status).toEqual(200);

  const db = new Firestore({ projectId: gcpProjectID });
  const exchangeRates = await db.collection('exchange_rates').get();
  const exchangeRateObjects = exchangeRates.docs.map(doc => doc.data() as { date: string; base: string });
  expect(exchangeRates.size).toEqual(itemsStoredCount);
  expect(exchangeRateObjects.map(({ date }) => date)).toEqual([...Array<string>(exchangeRates.size)].fill(dateSaved));
  expect(uniques(exchangeRateObjects.map(({ base }) => base)).length).toEqual(itemsStoredCount);
});
