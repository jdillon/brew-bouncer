/**
 * Run async tasks with a concurrency limit.
 * Calls onProgress after each task completes with (completed, total).
 */
export async function pool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<R[]> {
  const { concurrency = 8, onProgress } = opts;
  const total = items.length;
  const results: R[] = new Array(total);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < total) {
      const idx = next++;
      results[idx] = await fn(items[idx]!);
      done++;
      onProgress?.(done, total);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, total) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}
