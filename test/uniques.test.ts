import { describe, it, expect } from 'vitest';
import { uniques } from '../index';

describe('uniques', () => {
  it('returns unique values from array of strings', () => {
    const input = ['a', 'b', 'a', 'c', 'b'];
    const result = uniques(input);

    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns unique values from array of numbers', () => {
    const input = [1, 2, 1, 3, 2, 4];
    const result = uniques(input);

    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('returns empty array for empty input', () => {
    const result = uniques([]);

    expect(result).toEqual([]);
  });

  it('returns same array when all values are unique', () => {
    const input = ['a', 'b', 'c'];
    const result = uniques(input);

    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns single element when all values are same', () => {
    const input = ['a', 'a', 'a'];
    const result = uniques(input);

    expect(result).toEqual(['a']);
  });

  it('preserves order of first occurrence', () => {
    const input = ['c', 'b', 'a', 'b', 'c'];
    const result = uniques(input);

    expect(result).toEqual(['c', 'b', 'a']);
  });

  it('works with date strings', () => {
    const input = ['2023-02-17', '2023-02-16', '2023-02-17', '2023-02-15'];
    const result = uniques(input);

    expect(result).toEqual(['2023-02-17', '2023-02-16', '2023-02-15']);
  });

  it('works with mixed case strings', () => {
    const input = ['USD', 'EUR', 'usd', 'GBP', 'eur'];
    const result = uniques(input);

    expect(result).toEqual(['USD', 'EUR', 'usd', 'GBP', 'eur']);
  });

  it('handles null and undefined distinctly', () => {
    const input = [null, undefined, null, undefined];
    const result = uniques(input);

    expect(result).toEqual([null, undefined]);
  });

  it('handles boolean values', () => {
    const input = [true, false, true, false, true];
    const result = uniques(input);

    expect(result).toEqual([true, false]);
  });

  it('handles objects by reference', () => {
    const obj1 = { id: 1 };
    const obj2 = { id: 2 };
    const obj3 = { id: 1 };
    const input = [obj1, obj2, obj1, obj3];
    const result = uniques(input);

    expect(result).toEqual([obj1, obj2, obj3]);
  });

  it('returns new array, not mutating original', () => {
    const input = ['a', 'b', 'a'];
    const result = uniques(input);

    expect(result).not.toBe(input);
    expect(input).toEqual(['a', 'b', 'a']);
  });
});
