import { isEven, isOdd } from './parity.ts';

export function evens(values: number[]): number[] {
  return values.filter(isEven);
}

export function odds(values: number[]): number[] {
  return values.filter(isOdd);
}
