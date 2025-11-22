import { describe, it, expect } from 'vitest';
import { ExchangeRateRecord } from '../index';

describe('ExchangeRateRecord', () => {
  describe('constructor and basic properties', () => {
    it('creates a record with valid data', () => {
      const date = new Date('2023-02-17');
      const record = new ExchangeRateRecord({
        date,
        base: 'EUR',
        rates: { USD: 1.0625, GBP: 0.8845 },
      });

      expect(record.date).toEqual(date);
      expect(record.base).toBe('EUR');
      expect(record.rates).toEqual({ USD: 1.0625, GBP: 0.8845 });
    });

    it('creates a record with empty rates', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {},
      });

      expect(record.rates).toEqual({});
    });
  });

  describe('ratesAreEmpty', () => {
    it('returns false when rates object is empty', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {},
      });

      expect(record.ratesAreEmpty).toBe(false);
    });

    it('returns false when rates object has entries', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: { USD: 1.0625 },
      });

      expect(record.ratesAreEmpty).toBe(false);
    });
  });

  describe('documentKey', () => {
    it('generates correct document key for EUR base', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {},
      });

      expect(record.documentKey).toBe('EUR-2023-02-17');
    });

    it('generates correct document key for USD base', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-12-25'),
        base: 'USD',
        rates: {},
      });

      expect(record.documentKey).toBe('USD-2023-12-25');
    });

    it('generates correct document key with timezone consideration', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17T14:15:00+01:00'),
        base: 'EUR',
        rates: {},
      });

      expect(record.documentKey).toBe('EUR-2023-02-17');
    });
  });

  describe('dateString', () => {
    it('formats date correctly', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {},
      });

      expect(record.dateString).toBe('2023-02-17');
    });

    it('formats date with single digit month and day', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-01-05'),
        base: 'EUR',
        rates: {},
      });

      expect(record.dateString).toBe('2023-01-05');
    });
  });

  describe('addRate', () => {
    it('adds a new rate', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {},
      });

      record.addRate('USD', 1.0625);

      expect(record.rates).toEqual({ USD: 1.0625 });
    });

    it('adds multiple rates', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {},
      });

      record.addRate('USD', 1.0625);
      record.addRate('GBP', 0.8845);
      record.addRate('JPY', 140.25);

      expect(record.rates).toEqual({
        USD: 1.0625,
        GBP: 0.8845,
        JPY: 140.25,
      });
    });

    it('overwrites existing rate', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: { USD: 1.0625 },
      });

      record.addRate('USD', 1.0700);

      expect(record.rates).toEqual({ USD: 1.0700 });
    });
  });

  describe('toDocumentObject', () => {
    it('converts to document object format', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: { USD: 1.0625, GBP: 0.8845 },
      });

      const doc = record.toDocumentObject();

      expect(doc).toEqual({
        date: '2023-02-17',
        base: 'EUR',
        rates: { USD: 1.0625, GBP: 0.8845 },
      });
    });

    it('converts empty rates correctly', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'USD',
        rates: {},
      });

      const doc = record.toDocumentObject();

      expect(doc).toEqual({
        date: '2023-02-17',
        base: 'USD',
        rates: {},
      });
    });
  });

  describe('calculateRates', () => {
    it('calculates cross rates for USD base', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 1.0625,
          GBP: 0.8845,
          JPY: 140.25,
        },
      });

      const crossRates = eurRecord.calculateRates();

      const usdRecord = crossRates.find(r => r.base === 'USD');
      expect(usdRecord).toBeDefined();
      expect(usdRecord?.base).toBe('USD');
      expect(usdRecord?.rates.EUR).toBeCloseTo(1 / 1.0625, 10);
      expect(usdRecord?.rates.GBP).toBeCloseTo(0.8845 / 1.0625, 10);
      expect(usdRecord?.rates.JPY).toBeCloseTo(140.25 / 1.0625, 10);
    });

    it('calculates cross rates for all currencies', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 1.0625,
          GBP: 0.8845,
          JPY: 140.25,
        },
      });

      const crossRates = eurRecord.calculateRates();

      expect(crossRates.length).toBe(3);
      expect(crossRates.map(r => r.base).sort()).toEqual(['GBP', 'JPY', 'USD']);
    });

    it('does not include EUR as a cross rate base', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 1.0625,
          GBP: 0.8845,
        },
      });

      const crossRates = eurRecord.calculateRates();

      expect(crossRates.every(r => r.base !== 'EUR')).toBe(true);
    });

    it('does not include self-reference in cross rates', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 1.0625,
          GBP: 0.8845,
        },
      });

      const crossRates = eurRecord.calculateRates();
      const usdRecord = crossRates.find(r => r.base === 'USD');

      expect(usdRecord?.rates.USD).toBeUndefined();
    });

    it('includes EUR in cross rate rates', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 1.0625,
          GBP: 0.8845,
        },
      });

      const crossRates = eurRecord.calculateRates();

      expect(crossRates.every(r => r.rates.EUR)).toBe(true);
    });

    it('returns empty array when no rates available', () => {
      const record = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {},
      });

      const crossRates = record.calculateRates();

      expect(crossRates).toEqual([]);
    });

    it('skips currencies not in CURRENCIES list', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 1.0625,
          GBP: 0.8845,
        },
      });

      const crossRates = eurRecord.calculateRates();

      expect(crossRates.every(r => ['USD', 'GBP'].includes(r.base))).toBe(true);
    });

    it('preserves date in cross rates', () => {
      const date = new Date('2023-02-17');
      const eurRecord = new ExchangeRateRecord({
        date,
        base: 'EUR',
        rates: {
          USD: 1.0625,
          GBP: 0.8845,
        },
      });

      const crossRates = eurRecord.calculateRates();

      expect(crossRates.every(r => r.date.getTime() === date.getTime())).toBe(true);
    });

    it('calculates correct inverse rate for EUR', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 2.0,
        },
      });

      const crossRates = eurRecord.calculateRates();
      const usdRecord = crossRates.find(r => r.base === 'USD');

      expect(usdRecord?.rates.EUR).toBe(0.5);
    });

    it('calculates correct cross rates between non-EUR currencies', () => {
      const eurRecord = new ExchangeRateRecord({
        date: new Date('2023-02-17'),
        base: 'EUR',
        rates: {
          USD: 2.0,
          GBP: 4.0,
        },
      });

      const crossRates = eurRecord.calculateRates();
      const usdRecord = crossRates.find(r => r.base === 'USD');

      expect(usdRecord?.rates.GBP).toBe(2.0);
    });
  });
});
