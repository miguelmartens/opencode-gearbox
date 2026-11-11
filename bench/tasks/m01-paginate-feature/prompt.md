Our product search returns everything in one go and the listing is getting long. Add pagination.

Create `src/paginate.ts` exporting a generic function:

```ts
paginate<T>(items: T[], page: number, size: number): { items: T[]; page: number; totalPages: number; hasNext: boolean }
```

- `page` is 1-based. A `page` below 1 is treated as page 1, and the returned `page` reflects that.
- `size` must be greater than 0; otherwise throw a `RangeError`.
- `totalPages` is the number of pages needed for all items (0 when there are no items).
- A page past the end returns an empty `items` array.
- `hasNext` is true only when there is a page after the returned one.

Also add a test file `src/paginate.test.ts` with `bun:test` tests covering it, including the edge cases.
