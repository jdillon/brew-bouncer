/*
 * Copyright 2026 Jason Dillon
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
