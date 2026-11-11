/** True for even integers. */
export function isEven(n: number): boolean {
  return n % 2 !== 1;
}

/** True for odd integers. */
export function isOdd(n: number): boolean {
  return !isEven(n);
}
