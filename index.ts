import fs from 'node:fs/promises';
import path from 'node:path';

import * as functions from '@google-cloud/functions-framework';
import { Firestore } from '@google-cloud/firestore';
import { load as cheerioLoad } from 'cheerio';
import { parseStringPromise } from 'xml2js';
import v from 'valibot';
import { asserts } from '@kamaalio/kamaal';

export const TARGETS = {
  MAIN: 'main',
} as const;

const EXCHANGE_RATES_COLLECTION_KEY = 'exchange_rates';
const BASE_FOREX_URL = new URL('https://www.ecb.europa.eu');
const HOME_URL = new URL('/home/html/rss.en.html', BASE_FOREX_URL);
const BASE_CURRENCY = 'EUR';
const CURRENCIES = new Set([
  BASE_CURRENCY,
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
  'ILS',
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
] as const);
const SAMPLES_DIRECTORY = 'test/samples';
const SAMPLES_PAGE_CONTENT = path.join(SAMPLES_DIRECTORY, 'home');

type Currency = typeof CURRENCIES extends Set<infer T> ? T : never;

export type Target = (typeof TARGETS)[keyof typeof TARGETS];

const CoercedOptionalBooleanShape = v.nullish(v.pipe(v.unknown(), v.toBoolean()), undefined);

function SingleArrayItemOptionalShape<ItemSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  itemSchema: ItemSchema,
) {
  return v.nullish(v.pipe(v.array(itemSchema), v.minLength(1)));
}

const RequestBodySchema = v.object({
  testing: v.optional(CoercedOptionalBooleanShape, false),
  record: v.optional(CoercedOptionalBooleanShape, false),
});

export type RequestBody = v.InferOutput<typeof RequestBodySchema>;

const ForexItemExchangeRateECBResponseSchema = v.object({
  'cb:value': SingleArrayItemOptionalShape(v.object({ _: v.string() })),
  'cb:baseCurrency': SingleArrayItemOptionalShape(v.object({ _: v.string() })),
  'cb:targetCurrency': SingleArrayItemOptionalShape(v.string()),
});

export type ForexItemExchangeRateECBResponse = v.InferOutput<typeof ForexItemExchangeRateECBResponseSchema>;

const ForexItemECPResponseSchema = v.object({
  'dc:date': SingleArrayItemOptionalShape(v.string()),
  'cb:statistics': SingleArrayItemOptionalShape(
    v.object({ 'cb:exchangeRate': SingleArrayItemOptionalShape(ForexItemExchangeRateECBResponseSchema) }),
  ),
});

export type ForexItemECPResponse = v.InferOutput<typeof ForexItemECPResponseSchema>;

const ForexECPResponseSchema = v.object({
  'rdf:RDF': v.nullish(v.object({ item: v.nullish(v.array(ForexItemECPResponseSchema)) })),
});

const EnvSchema = v.object({ GCP_PROJECT_ID: v.pipe(v.string(), v.minLength(1)) });

functions.http(TARGETS.MAIN, async (req, res) => {
  const { GCP_PROJECT_ID } = await v.parseAsync(EnvSchema, process.env);
  const db = new Firestore({ projectId: GCP_PROJECT_ID });
  const exchangeRatesCollection = db.collection(EXCHANGE_RATES_COLLECTION_KEY);
  const batchOperations = db.batch();
  const body = await parseRequestBody(req);
  console.log(`request body: ${JSON.stringify(body)}`);
  const ratesStored = await fetchAndStoreExchangeRates(batchOperations, exchangeRatesCollection, body);
  const ratesRemoved = await cleanStaleRates(ratesStored, batchOperations, exchangeRatesCollection);
  if (ratesStored.length > 0 || (ratesRemoved?.size ?? 0) > 0) {
    await batchOperations.commit();
  }

  const message = `SUCCESS ${ratesStored.at(0)?.dateString ?? ''} ${ratesStored.length}-${ratesRemoved?.size ?? 0}`;
  console.log(message);
  res.status(200).send(message);
});

async function parseRequestBody(req: functions.Request): Promise<RequestBody> {
  const requestBody: unknown = req.body;
  let parsedBody: unknown;
  if (!requestBody) parsedBody = {};
  else if (typeof requestBody === 'string') parsedBody = JSON.parse(requestBody);
  else if (typeof requestBody === 'object') parsedBody = requestBody;
  else parsedBody = {};

  return v.parseAsync(RequestBodySchema, parsedBody);
}

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
  body: RequestBody,
) {
  const forexURLs = await getForexURLs(body);
  const fetchedExchangeRates = await fetchExchangeRates(forexURLs, body);
  if (!fetchedExchangeRates || fetchedExchangeRates.ratesAreEmpty) {
    return [];
  }

  return storeExchangeRates(fetchedExchangeRates, batchOperations, exchangeRatesCollection);
}

async function storeExchangeRates(
  exchangeRate: ExchangeRateRecord,
  batchOperations: FirebaseFirestore.WriteBatch,
  exchangeRatesCollection: FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>,
) {
  const itemsToStoreRecord = (
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
  ).reduce<Record<string, ExchangeRateRecord>>((acc, item) => {
    if (!item) {
      return acc;
    }
    return { ...acc, [item.documentKey]: item };
  }, {});
  const itemsToStore = Object.values(itemsToStoreRecord);
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

async function fetchExchangeRates(urls: URL[], body: RequestBody) {
  const spreadExchangeRatesResults = await Promise.allSettled(
    urls.map(async url => {
      const urlPart = url.toString().split('/').at(-1);
      if (!urlPart) {
        throw new Error('Invalid URL format');
      }

      const sampleUrl = path.join(SAMPLES_DIRECTORY, `${urlPart.split('.')[0]}.xml`);
      let content: Awaited<string | Buffer>;
      if (!body.testing) {
        let response: Response;
        try {
          response = await fetch(url);
        } catch (error) {
          console.error(`Failed to fetch exchange rates for '${url}'; error='${String(error)}'`);
          throw error;
        }
        content = await response.text();
      } else {
        content = await fs.readFile(sampleUrl);
      }
      if (body.record) {
        await fs.writeFile(sampleUrl, content);
      }

      const parsedContent: unknown = await parseStringPromise(content);
      const contentObject = await v.parseAsync(ForexECPResponseSchema, parsedContent);
      const exchangeRates: Record<string, ExchangeRateRecord> = {};
      for (const contentItem of contentObject['rdf:RDF']?.item ?? []) {
        const item = ForexItem.fromECBResponse(contentItem);
        if (!item) {
          continue;
        }

        if (!CURRENCIES.has(item.rate.target)) {
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
  for (const exchangeRatesResult of spreadExchangeRatesResults) {
    if (exchangeRatesResult.status === 'rejected') {
      console.warn(`Failed to get exchange rates;`, exchangeRatesResult.reason);
      continue;
    }

    const exchangeRates = exchangeRatesResult.value;
    for (const [key, exchangeRate] of Object.entries(exchangeRates)) {
      if (exchangeRate.date.getTime() > (latestDate?.getTime() ?? 0)) {
        latestDate = exchangeRate.date;
      }
      if (combinedExchangeRates[key] === undefined) {
        combinedExchangeRates[key] = exchangeRate;
      } else {
        combinedExchangeRates[key].setRates({
          ...combinedExchangeRates[key].rates,
          ...exchangeRate.rates,
        });
      }
    }
  }

  if (!latestDate) {
    return;
  }

  return combinedExchangeRates[latestDate.getTime().toString()];
}

async function getForexURLs(body: RequestBody): Promise<URL[]> {
  let content: Awaited<string | Buffer>;
  if (!body.testing) {
    const response = await fetch(HOME_URL);
    content = await response.text();
  } else {
    content = await fs.readFile(SAMPLES_PAGE_CONTENT);
  }
  if (body.record) {
    await fs.writeFile(SAMPLES_PAGE_CONTENT, content);
  }

  const urls: URL[] = [];
  cheerioLoad(content)('a').each((_index, element) => {
    const link = element.attribs.href;
    if (!link || !link.includes('/rss/fxref') || link.includes('eek')) {
      return;
    }
    urls.push(new URL(link, BASE_FOREX_URL));
  });
  return urls;
}

export function uniques<Element>(array: Element[]) {
  return [...new Set(array)];
}

function isCurrency(value: string): value is Currency {
  return CURRENCIES.has(value as Currency);
}

export class ExchangeRateRecord {
  readonly date: Date;
  readonly base: string;
  private _rates: Partial<Record<Currency, number>>;

  constructor({ date, base, rates }: { date: Date; base: string; rates: Partial<Record<Currency, number>> }) {
    this.date = date;
    this.base = base;
    this._rates = rates;
  }

  get rates(): Partial<Record<Currency, number>> {
    return this._rates;
  }

  get ratesAreEmpty(): boolean {
    return Object.keys(this.rates).length === 0;
  }

  get documentKey(): string {
    return `${this.base}-${this.dateString}`;
  }

  get dateString(): string {
    return this.date.toISOString().split('T')[0];
  }

  setRates(rates: Partial<Record<Currency, number>>): void {
    this._rates = rates;
  }

  addRate(currency: Currency, value: number): void {
    this.setRates({ ...this.rates, [currency]: value });
  }

  getRate(currency: Currency): number | undefined {
    return this.rates[currency];
  }

  toDocumentObject() {
    return {
      date: this.dateString,
      base: this.base,
      rates: this.rates,
    };
  }

  calculateRates(): ExchangeRateRecord[] {
    const ratesCurrencies = Object.keys(this.rates);
    const calculatedRates: ExchangeRateRecord[] = [];
    for (const newBaseCurrency of CURRENCIES) {
      if (newBaseCurrency === BASE_CURRENCY) {
        continue;
      }

      if (!ratesCurrencies.includes(newBaseCurrency)) {
        continue;
      }

      const newBaseCurrencyRate = this.getRate(newBaseCurrency);
      asserts.invariant(newBaseCurrencyRate != null);

      const newExchangeRate = new ExchangeRateRecord({
        date: this.date,
        base: newBaseCurrency,
        rates: { EUR: 1 / newBaseCurrencyRate },
      });
      for (const currency of CURRENCIES) {
        if (!ratesCurrencies.includes(currency) || currency === newBaseCurrency) {
          continue;
        }

        const currencyRate = this.getRate(currency);
        asserts.invariant(currencyRate != null);

        newExchangeRate.addRate(currency, currencyRate / newBaseCurrencyRate);
      }

      calculatedRates.push(newExchangeRate);
    }

    return calculatedRates;
  }
}

export class ForexItem {
  readonly rate: ForexItemExchangeRate;
  readonly date: Date;

  constructor({ rate, date }: { rate: ForexItemExchangeRate; date: Date }) {
    this.rate = rate;
    this.date = date;
  }

  static fromECBResponse(response: ForexItemECPResponse): ForexItem | null {
    const rawDate = response['dc:date']?.at(0);
    if (!rawDate) {
      return null;
    }

    const date = new Date(rawDate);
    const dateTime = date.getTime();
    if (dateTime === 0 || Number.isNaN(dateTime)) {
      return null;
    }

    const rawRate = response['cb:statistics']?.at(0)?.['cb:exchangeRate']?.at(0);
    if (!rawRate) {
      return null;
    }

    const rate = ForexItemExchangeRate.fromECBResponse(rawRate);
    if (!rate) {
      return null;
    }

    return new ForexItem({ rate, date });
  }
}

export class ForexItemExchangeRate {
  readonly value: number;
  readonly base: Currency;
  readonly target: Currency;

  constructor({ value, base, target }: { value: number; base: Currency; target: Currency }) {
    this.value = value;
    this.base = base;
    this.target = target;
  }

  static fromECBResponse(response: ForexItemExchangeRateECBResponse): ForexItemExchangeRate | null {
    const rawValue = response['cb:value']?.at(0)?._;
    if (!rawValue) {
      return null;
    }

    const value = Number(rawValue);
    if (Number.isNaN(value)) {
      return null;
    }

    const base = response['cb:baseCurrency']?.at(0)?._;
    if (!base || !isCurrency(base)) {
      return null;
    }

    const target = response['cb:targetCurrency']?.at(0);
    if (!target || !isCurrency(target)) {
      return null;
    }

    return new ForexItemExchangeRate({ value, base, target });
  }
}
