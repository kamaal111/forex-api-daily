const Firestore = require("@google-cloud/firestore");
const cheerio = require("cheerio");
const { parseStringPromise } = require("xml2js");

const BASE_FOREX_URL = "https://www.ecb.europa.eu";
const HOME_URL = `${BASE_FOREX_URL}/home/html/rss.en.html`;
const CURRENCIES = [
  "USD",
  "JPY",
  "BGN",
  "CYP",
  "CZK",
  "DKK",
  "EEK",
  "GBP",
  "HUF",
  "LTL",
  "LVL",
  "MTL",
  "PLN",
  "ROL",
  "RON",
  "SEK",
  "SIT",
  "SKK",
  "CHF",
  "ISK",
  "NOK",
  "HRK",
  // "RUB",
  "TRL",
  "TRY",
  "AUD",
  "BRL",
  "CAD",
  "CNY",
  "HKD",
  "IDR",
  "ILS",
  "INR",
  "KRW",
  "MXN",
  "MYR",
  "NZD",
  "PHP",
  "SGD",
  "THB",
  "ZAR",
];

async function main(...args) {
  console.log(`args='${args}'`);

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error("Failed to read GCP_PROJECT_ID environment variable");
  }

  const forexURLs = await getForexURLs();
  const fetchedExchangeRates = await fetchExchangeRates(forexURLs);

  const db = new Firestore({ projectId });
  await storeExchangeRates(db, fetchedExchangeRates);

  return 1; // to indicate success to cloud function
}

async function storeExchangeRates(db, exchangeRates) {
  const exchangeRatesCollection = db.collection("exchange_rates");

  let itemsToStore = [];
  for (const exchangeRate of Object.values(exchangeRates)) {
    if (exchangeRate.ratesAreEmpty) {
      continue;
    }

    const exchangeRateDocument = await exchangeRatesCollection
      .doc(exchangeRate.documentKey)
      .get();
    if (exchangeRateDocument.exists) {
      continue;
    }

    itemsToStore.push(exchangeRate);
    for (const calculatedRate of exchangeRate.calculateRates()) {
      if (calculatedRate.ratesAreEmpty) {
        continue;
      }

      itemsToStore.push(calculatedRate);
    }
  }

  if (itemsToStore.length === 0) {
    console.log("no new data found to save");
    return;
  }

  console.log(`saving ${itemsToStore.length} items to firestore in batch`);
  const batchOperations = db.batch();
  for (const itemToStore of itemsToStore) {
    const newDocument = exchangeRatesCollection.doc(itemToStore.documentKey);
    batchOperations.set(newDocument, itemToStore.toDocumentObject());
  }
  await batchOperations.commit();
}

async function fetchExchangeRates(urls) {
  const spreadExchangeRates = await Promise.all(
    urls.map(async (url) => {
      console.log(`getting data from url='${url}'`);
      const response = await fetch(url);
      const content = await response.text();
      const contentObject = await parseStringPromise(content);

      const exchangeRates = {};
      for (const contentItem of contentObject["rdf:RDF"]?.item ?? []) {
        const item = ForexItem.fromECBResponse(contentItem);
        if (!item) {
          continue;
        }

        if (!CURRENCIES.includes(item.rate.target)) {
          continue;
        }

        if (exchangeRates[item.date] == null) {
          exchangeRates[item.date] = new ExchangeRateRecord({
            date: item.date,
            base: item.rate.base,
            rates: {},
          });
        }

        exchangeRates[item.date].addRate(item.rate.target, item.rate.value);
      }

      return exchangeRates;
    })
  );

  const combinedExchangeRates = {};
  for (const exchangeRates of spreadExchangeRates) {
    for (const [key, exchangeRate] of Object.entries(exchangeRates)) {
      if (combinedExchangeRates[key] == null) {
        combinedExchangeRates[key] = exchangeRate;
      } else {
        combinedExchangeRates[key].rates = {
          ...combinedExchangeRates[key].rates,
          ...exchangeRate.rates,
        };
      }
    }
  }
  return combinedExchangeRates;
}

async function getForexURLs() {
  const response = await fetch(HOME_URL);
  const content = await response.text();

  let urls = [];
  cheerio
    .load(content)("a")
    .each((_index, element) => {
      const link = element.attribs.href;
      if (!link || !link.includes("/rss/fxref") || link.includes("eek")) {
        return;
      }
      urls.push(`${BASE_FOREX_URL}${link}`);
    });
  return urls;
}

class ExchangeRateRecord {
  constructor({ date, base, rates }) {
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
    return this.date.toISOString().split("T")[0];
  }

  addRate(currency, value) {
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
    let newExchangeRates = [];
    for (const newBaseCurrency of CURRENCIES) {
      if (newBaseCurrency === "EUR") {
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
        if (
          !ratesCurrencies.includes(currency) ||
          currency === newBaseCurrency
        ) {
          continue;
        }

        newExchangeRate.addRate(
          currency,
          this.rates[currency] / this.rates[newBaseCurrency]
        );
      }

      newExchangeRates.push(newExchangeRate);
    }

    return newExchangeRates;
  }
}

class ForexItem {
  constructor({ rate, date }) {
    this.rate = rate;
    this.date = date;
  }

  static fromECBResponse(response) {
    const rawDate = response["dc:date"]?.at(0);
    if (!rawDate) {
      return;
    }

    const date = new Date(rawDate);
    const dateTime = date.getTime();
    if (dateTime === 0 || Number.isNaN(dateTime)) {
      return;
    }

    const rawRate = response["cb:statistics"]
      ?.at(0)
      ?.["cb:exchangeRate"]?.at(0);
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
  constructor({ value, base, target }) {
    this.value = value;
    this.base = base;
    this.target = target;
  }

  static fromECBResponse(response) {
    const rawValue = response["cb:value"]?.at(0)?.["_"];
    if (!rawValue) {
      return;
    }

    const value = Number(rawValue);
    if (Number.isNaN(value)) {
      return;
    }

    const base = response["cb:baseCurrency"]?.at(0)?.["_"];
    if (!base) {
      return;
    }

    const target = response["cb:targetCurrency"]?.at(0);
    if (!target) {
      return;
    }

    return new ForexItemExchangeRate({ value, base, target });
  }
}

exports.main = main;
