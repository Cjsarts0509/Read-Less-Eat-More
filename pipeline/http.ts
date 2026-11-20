export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string,
  ) {
    super(`HTTP ${status} ${url.split("?")[0]}: ${body.slice(0, 200)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 · 5xx · 네트워크 오류는 지수 백오프로 재시도 */
export async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
  { retries = 3, baseDelayMs = 800 }: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (res.ok) return (await res.json()) as T;
      const body = await res.text();
      const err = new HttpError(res.status, url, body);
      if (res.status !== 429 && res.status < 500) throw err;
      lastErr = err;
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      lastErr = err;
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt + Math.random() * 200);
  }
  throw lastErr;
}

/** 동시에 n개까지만 실행 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
