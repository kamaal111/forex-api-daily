import { describe, it, expect } from 'vitest';
import {
  ForexItem,
  type ForexItemECPResponse,
  ForexItemExchangeRate,
  type ForexItemExchangeRateECBResponse,
} from '../index';

describe('ForexItemExchangeRate', () => {
  describe('constructor', () => {
    it('creates exchange rate with valid data', () => {
      const rate = new ForexItemExchangeRate({
        value: 1.0625,
        base: 'EUR',
        target: 'USD',
      });

      expect(rate.value).toBe(1.0625);
      expect(rate.base).toBe('EUR');
      expect(rate.target).toBe('USD');
    });

    it('accepts zero value', () => {
      const rate = new ForexItemExchangeRate({
        value: 0,
        base: 'EUR',
        target: 'USD',
      });

      expect(rate.value).toBe(0);
    });

    it('accepts negative value', () => {
      const rate = new ForexItemExchangeRate({
        value: -1.0625,
        base: 'EUR',
        target: 'USD',
      });

      expect(rate.value).toBe(-1.0625);
    });
  });

  describe('fromECBResponse', () => {
    it('parses valid ECB response', () => {
      const response: ForexItemExchangeRateECBResponse = {
        'cb:value': [{ _: '1.0625' }],
        'cb:baseCurrency': [{ _: 'EUR' }],
        'cb:targetCurrency': ['USD'],
      };

      const rate = ForexItemExchangeRate.fromECBResponse(response);

      expect(rate).toBeDefined();
      expect(rate?.value).toBe(1.0625);
      expect(rate?.base).toBe('EUR');
      expect(rate?.target).toBe('USD');
    });

    it('returns undefined when value._ is missing', () => {
      const response: ForexItemExchangeRateECBResponse = {
        'cb:value': [{ _: undefined }] as unknown as [{ _: string }],
        'cb:baseCurrency': [{ _: 'EUR' }],
        'cb:targetCurrency': ['USD'],
      };

      const rate = ForexItemExchangeRate.fromECBResponse(response);

      expect(rate).toBeUndefined();
    });

    it('returns undefined when value is NaN', () => {
      const response: ForexItemExchangeRateECBResponse = {
        'cb:value': [{ _: 'invalid' }],
        'cb:baseCurrency': [{ _: 'EUR' }],
        'cb:targetCurrency': ['USD'],
      };

      const rate = ForexItemExchangeRate.fromECBResponse(response);

      expect(rate).toBeUndefined();
    });

    it('returns undefined when base currency._ is missing', () => {
      const response: ForexItemExchangeRateECBResponse = {
        'cb:value': [{ _: '1.0625' }],
        'cb:baseCurrency': [{ _: undefined }] as unknown as [{ _: string }],
        'cb:targetCurrency': ['USD'],
      };

      const rate = ForexItemExchangeRate.fromECBResponse(response);

      expect(rate).toBeUndefined();
    });

    it('parses decimal values correctly', () => {
      const response: ForexItemExchangeRateECBResponse = {
        'cb:value': [{ _: '140.2567' }],
        'cb:baseCurrency': [{ _: 'EUR' }],
        'cb:targetCurrency': ['JPY'],
      };

      const rate = ForexItemExchangeRate.fromECBResponse(response);

      expect(rate?.value).toBe(140.2567);
    });

    it('parses zero value', () => {
      const response: ForexItemExchangeRateECBResponse = {
        'cb:value': [{ _: '0' }],
        'cb:baseCurrency': [{ _: 'EUR' }],
        'cb:targetCurrency': ['USD'],
      };

      const rate = ForexItemExchangeRate.fromECBResponse(response);

      expect(rate?.value).toBe(0);
    });
  });
});

describe('ForexItem', () => {
  describe('constructor', () => {
    it('creates forex item with valid data', () => {
      const rate = new ForexItemExchangeRate({
        value: 1.0625,
        base: 'EUR',
        target: 'USD',
      });
      const date = new Date('2023-02-17T14:15:00+01:00');

      const item = new ForexItem({ rate, date });

      expect(item.rate).toBe(rate);
      expect(item.date).toBe(date);
    });
  });

  describe('fromECBResponse', () => {
    it('parses valid ECB response', () => {
      const response: ForexItemECPResponse = {
        'dc:date': ['2023-02-17T14:15:00+01:00'],
        'cb:statistics': [
          {
            'cb:exchangeRate': [
              {
                'cb:value': [{ _: '1.0625' }],
                'cb:baseCurrency': [{ _: 'EUR' }],
                'cb:targetCurrency': ['USD'],
              },
            ],
          },
        ],
      };

      const item = ForexItem.fromECBResponse(response);

      expect(item).toBeDefined();
      expect(item?.date).toEqual(new Date('2023-02-17T14:15:00+01:00'));
      expect(item?.rate.value).toBe(1.0625);
      expect(item?.rate.base).toBe('EUR');
      expect(item?.rate.target).toBe('USD');
    });

    it('returns undefined when date is invalid', () => {
      const response: ForexItemECPResponse = {
        'dc:date': ['invalid-date'],
        'cb:statistics': [
          {
            'cb:exchangeRate': [
              {
                'cb:value': [{ _: '1.0625' }],
                'cb:baseCurrency': [{ _: 'EUR' }],
                'cb:targetCurrency': ['USD'],
              },
            ],
          },
        ],
      };

      const item = ForexItem.fromECBResponse(response);

      expect(item).toBeUndefined();
    });

    it('returns undefined when rate parsing fails', () => {
      const response: ForexItemECPResponse = {
        'dc:date': ['2023-02-17T14:15:00+01:00'],
        'cb:statistics': [
          {
            'cb:exchangeRate': [
              {
                'cb:value': [{ _: 'invalid' }],
                'cb:baseCurrency': [{ _: 'EUR' }],
                'cb:targetCurrency': ['USD'],
              },
            ],
          },
        ],
      };

      const item = ForexItem.fromECBResponse(response);

      expect(item).toBeUndefined();
    });

    it('parses multiple date formats', () => {
      const response: ForexItemECPResponse = {
        'dc:date': ['2023-02-17'],
        'cb:statistics': [
          {
            'cb:exchangeRate': [
              {
                'cb:value': [{ _: '1.0625' }],
                'cb:baseCurrency': [{ _: 'EUR' }],
                'cb:targetCurrency': ['USD'],
              },
            ],
          },
        ],
      };

      const item = ForexItem.fromECBResponse(response);

      expect(item).toBeDefined();
      expect(item?.date).toEqual(new Date('2023-02-17'));
    });

    it('handles different currencies', () => {
      const response: ForexItemECPResponse = {
        'dc:date': ['2023-02-17T14:15:00+01:00'],
        'cb:statistics': [
          {
            'cb:exchangeRate': [
              {
                'cb:value': [{ _: '140.25' }],
                'cb:baseCurrency': [{ _: 'EUR' }],
                'cb:targetCurrency': ['JPY'],
              },
            ],
          },
        ],
      };

      const item = ForexItem.fromECBResponse(response);

      expect(item?.rate.target).toBe('JPY');
      expect(item?.rate.value).toBe(140.25);
    });
  });
});
