import {Firestore} from '@google-cloud/firestore';

import {
  httpInvocation,
  startFunctionFramework,
} from './utils/functionFramework';
import uniques from './utils/uniques';

jest.setTimeout(20_000);

describe('main', () => {
  const PORT = 8081;

  let functionFrameworkProcess:
    | Awaited<ReturnType<typeof startFunctionFramework>>
    | undefined;
  let gcpProjectID: string | undefined;

  beforeAll(async () => {
    gcpProjectID = `forex-api-daily-${new Date().getTime()}`;
    functionFrameworkProcess = await startFunctionFramework(
      'main',
      gcpProjectID,
      PORT
    );
  });

  afterAll(() => {
    functionFrameworkProcess!.kill();
  });

  it('successfully saves all documents', async () => {
    const response = await httpInvocation('main', PORT);

    const itemsStoredCount = 30;
    const itemsRemovedCount = 0;
    expect(await response.text()).toEqual(
      `SUCCESS ${itemsStoredCount}-${itemsRemovedCount}`
    );
    expect(response.status).toEqual(200);

    const db = new Firestore({projectId: gcpProjectID});
    const exchangeRates = await db.collection('exchange_rates').get();
    const exchangeRateObjects = exchangeRates.docs.map(doc => doc.data());
    expect(exchangeRates.size).toEqual(itemsStoredCount);
    expect(exchangeRateObjects.map(({date}) => date)).toEqual(
      [...Array(exchangeRates.size)].fill('2023-02-17')
    );
    expect(uniques(exchangeRateObjects.map(({base}) => base)).length).toEqual(
      itemsStoredCount
    );
  });
});
