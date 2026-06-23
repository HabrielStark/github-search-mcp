/**
 * Like `Promise.allSettled(items.map(fn))` but with a bounded number of
 * concurrent `fn` invocations. Used by the compare / find-alternatives fan-out
 * so a single tool call can't burst dozens of simultaneous GitHub requests and
 * trip secondary rate limits. Order of results matches `items`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  // Stryker disable next-line ArrayDeclaration: preallocation size is a perf detail only — every index is written by a worker and the returned length is determined by assignment, so `new Array()` is behaviorally equivalent.
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  // Clamp workers to [1, items.length]: a non-positive/NaN limit falls back to a
  // single worker (never 0 → never hangs), and we never spawn more than there are
  // items. >= 1 (not > 1) is deliberate: limit === 1 must mean one worker.
  // Stryker disable next-line EqualityOperator: `>= 1` vs `> 1` differ only at limit === 1, where both yield a single worker — equivalent.
  const safeLimit = limit >= 1 ? limit : 1;
  const workerCount = Math.min(safeLimit, items.length);
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
