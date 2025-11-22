import fs from 'node:fs/promises';

import * as functions from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { load as cheerioLoad } from 'cheerio';
import { parseStringPromise } from 'xml2js';

const EXCHANGE_RATES_COLLECTION_KEY = 'exchange_rates';
const BASE_FOREX_URL = 'https://www.ecb.europa.eu';
const HOME_URL = `${BASE_FOREX_URL}/home/html/rss.en.html`;
const CURRENCIES = [
  'USD',
  'JPY',
  'BGN',
  'CYP',
  'CZK',
  'DKK',
  'EEK',
  'GBP',
  'HUF',
  'LTL',
  'LVL',
  'MTL',
  'PLN',
  'ROL',
  'RON',
  'SEK',
  'SIT',
  'SKK',
  'CHF',
  'ISK',
  'NOK',
  'HRK',
  'RUB',
  'TRL',
  'TRY',
  'AUD',
  'BRL',
  'CAD',
  'CNY',
  'HKD',
  'IDR',
  'ILS',
  'INR',
  'KRW',
  'MXN',
  'MYR',
  'NZD',
  'PHP',
  'SGD',
  'THB',
  'ZAR',
];

interface ForexItemExchangeRateECBResponse {
  'cb:value': [{ _: string }];
  'cb:baseCurrency': [{ _: string }];
  'cb:targetCurrency': [string];
}

interface ForexItemECPResponse {
  'dc:date': [string];
  'cb:statistics': [
    {
      'cb:exchangeRate': [ForexItemExchangeRateECBResponse];
    },
  ];
}

functions.http('main', async (_req, res) => {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error('Failed to read GCP_PROJECT_ID environment variable');
  }

  const db = new Firestore({ projectId });
  const batchOperations = db.batch();
  const exchangeRatesCollection = db.collection(EXCHANGE_RATES_COLLECTION_KEY);
  const ratesStored = await fetchAndStoreExchangeRates(batchOperations, exchangeRatesCollection);
  const ratesRemoved = await cleanStaleRates(ratesStored, batchOperations, exchangeRatesCollection);

  if (ratesStored.length > 0 || (ratesRemoved?.size ?? 0) > 0) {
    await batchOperations.commit();
  }

  const message = `SUCCESS ${ratesStored.at(0)?.dateString ?? ''} ${ratesStored.length}-${ratesRemoved?.size ?? 0}`;
  console.log(message);
  res.status(200).send(message);
});

async function cleanStaleRates(
  ratesStored: ExchangeRateRecord[],
  batchOperations: FirebaseFirestore.WriteBatch,
  exchangeRatesCollection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>,
) {
  if (ratesStored.length === 0) {
    return null;
  }

  const previouslyStoredItems = await exchangeRatesCollection
    .where('date', 'not-in', uniques(ratesStored.map(rate => rate.dateString)).splice(0, 4))
    .limit(100)
    .get();

  for (const itemToDelete of previouslyStoredItems.docs) {
    batchOperations.delete(itemToDelete.ref);
  }

  return previouslyStoredItems;
}

async function fetchAndStoreExchangeRates(
  batchOperations: FirebaseFirestore.WriteBatch,
  exchangeRatesCollection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>,
) {
  const forexURLs = await getForexURLs();
  const fetchedExchangeRates = await fetchExchangeRates(forexURLs);
  if (!fetchedExchangeRates || fetchedExchangeRates.ratesAreEmpty) {
    return [];
  }

  const ratesStored = await storeExchangeRates(fetchedExchangeRates, batchOperations, exchangeRatesCollection);
  return ratesStored;
}

async function storeExchangeRates(
  exchangeRate: ExchangeRateRecord,
  batchOperations: FirebaseFirestore.WriteBatch,
  exchangeRatesCollection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>,
) {
  const itemsToStore = (
    await Promise.all(
      exchangeRate
        .calculateRates()
        .concat([exchangeRate])
        .map(async calculatedRate => {
          if (calculatedRate.ratesAreEmpty) {
            return;
          }

          const calculatedRateDocument = await exchangeRatesCollection.doc(calculatedRate.documentKey).get();
          if (calculatedRateDocument.exists) {
            return;
          }

          return calculatedRate;
        }),
    )
  ).filter(rate => rate) as ExchangeRateRecord[];

  if (itemsToStore.length === 0) {
    console.log('no new data found to save');
    return [];
  }

  console.log(`saving ${itemsToStore.length} items to firestore in batch`);
  for (const itemToStore of itemsToStore) {
    const newDocument = exchangeRatesCollection.doc(itemToStore.documentKey);
    batchOperations.set(newDocument, itemToStore.toDocumentObject());
  }

  return itemsToStore;
}

async function fetchExchangeRates(urls: string[]) {
  const spreadExchangeRates = await Promise.all(
    urls.map(async url => {
      let content: Awaited<string | Buffer>;
      if (!process.env.TEST) {
        const response = await fetch(url);
        content = await response.text();
      } else {
        const urlPart = url.split('/').at(-1);
        if (!urlPart) {
          throw new Error('Invalid URL format');
        }
        content = await fs.readFile(`test/samples/${urlPart.split('.')[0]}.xml`);
      }
      const contentObject = (await parseStringPromise(content)) as { 'rdf:RDF'?: { item?: ForexItemECPResponse[] } };

      const exchangeRates: Record<string, ExchangeRateRecord> = {};
      for (const contentItem of contentObject['rdf:RDF']?.item ?? []) {
        const item = ForexItem.fromECBResponse(contentItem);
        if (!item) {
          continue;
        }

        if (!CURRENCIES.includes(item.rate.target)) {
          continue;
        }

        const dateKey = item.date.getTime().toString();
        if (exchangeRates[dateKey] === undefined) {
          exchangeRates[dateKey] = new ExchangeRateRecord({
            date: item.date,
            base: item.rate.base,
            rates: {},
          });
        }

        exchangeRates[dateKey].addRate(item.rate.target, item.rate.value);
      }

      return exchangeRates;
    }),
  );

  let latestDate: Date | undefined;
  const combinedExchangeRates: Record<string, ExchangeRateRecord> = {};
  for (const exchangeRates of spreadExchangeRates) {
    for (const [key, exchangeRate] of Object.entries(exchangeRates)) {
      if (exchangeRate.date.getTime() > (latestDate?.getTime() ?? 0)) {
        latestDate = exchangeRate.date;
      }
      if (combinedExchangeRates[key] === undefined) {
        combinedExchangeRates[key] = exchangeRate;
      } else {
        combinedExchangeRates[key].rates = {
          ...combinedExchangeRates[key].rates,
          ...exchangeRate.rates,
        };
      }
    }
  }

  if (!latestDate) {
    return;
  }

  return combinedExchangeRates[latestDate.getTime().toString()];
}

async function getForexURLs() {
  let content: Awaited<string | Buffer>;
  if (!process.env.TEST) {
    const response = await fetch(HOME_URL);
    content = await response.text();
  } else {
    content = await fs.readFile('test/samples/home');
  }

  const urls: string[] = [];
  cheerioLoad(content)('a').each((_index, element) => {
    const link = element.attribs.href;
    if (!link || !link.includes('/rss/fxref') || link.includes('eek')) {
      return;
    }
    urls.push(`${BASE_FOREX_URL}${link}`);
  });
  return urls;
}

export function uniques<Element>(array: Element[]) {
  return [...new Set(array)];
}
class ExchangeRateRecord {
  date: Date;
  base: string;
  rates: Record<string, number>;

  constructor({ date, base, rates }: { date: Date; base: string; rates: Record<string, number> }) {
    this.date = date;
    this.base = base;
    this.rates = rates;
  }

  get ratesAreEmpty() {
    return this.rates.length === 0;
  }

  get documentKey() {
    return `${this.base}-${this.dateString}`;
  }

  get dateString() {
    return this.date.toISOString().split('T')[0];
  }

  addRate(currency: string, value: number) {
    this.rates[currency] = value;
  }

  toDocumentObject() {
    return {
      date: this.dateString,
      base: this.base,
      rates: this.rates,
    };
  }

  calculateRates() {
    const newExchangeRates: ExchangeRateRecord[] = [];
    for (const newBaseCurrency of CURRENCIES) {
      if (newBaseCurrency === 'EUR') {
        continue;
      }

      const ratesCurrencies = Object.keys(this.rates);
      if (!ratesCurrencies.includes(newBaseCurrency)) {
        continue;
      }

      const newExchangeRate = new ExchangeRateRecord({
        date: this.date,
        base: newBaseCurrency,
        rates: { EUR: 1 / this.rates[newBaseCurrency] },
      });
      for (const currency of CURRENCIES) {
        if (!ratesCurrencies.includes(currency) || currency === newBaseCurrency) {
          continue;
        }

        newExchangeRate.addRate(currency, this.rates[currency] / this.rates[newBaseCurrency]);
      }

      newExchangeRates.push(newExchangeRate);
    }

    return newExchangeRates;
  }
}

class ForexItem {
  rate: ForexItemExchangeRate;
  date: Date;

  constructor({ rate, date }: { rate: ForexItemExchangeRate; date: Date }) {
    this.rate = rate;
    this.date = date;
  }

  static fromECBResponse(response: ForexItemECPResponse) {
    const rawDate = response['dc:date']?.at(0);
    if (!rawDate) {
      return;
    }

    const date = new Date(rawDate);
    const dateTime = date.getTime();
    if (dateTime === 0 || Number.isNaN(dateTime)) {
      return;
    }

    const rawRate = response['cb:statistics']?.at(0)?.['cb:exchangeRate']?.at(0);
    if (!rawRate) {
      return;
    }

    const rate = ForexItemExchangeRate.fromECBResponse(rawRate);
    if (!rate) {
      return;
    }

    return new ForexItem({ rate, date });
  }
}

class ForexItemExchangeRate {
  value: number;
  base: string;
  target: string;

  constructor({ value, base, target }: { value: number; base: string; target: string }) {
    this.value = value;
    this.base = base;
    this.target = target;
  }

  static fromECBResponse(response: ForexItemExchangeRateECBResponse) {
    const rawValue = response['cb:value']?.at(0)?.['_'];
    if (!rawValue) {
      return;
    }

    const value = Number(rawValue);
    if (Number.isNaN(value)) {
      return;
    }

    const base = response['cb:baseCurrency']?.at(0)?.['_'];
    if (!base) {
      return;
    }

    const target = response['cb:targetCurrency']?.at(0);
    if (!target) {
      return;
    }

    return new ForexItemExchangeRate({ value, base, target });
  }
}
