/** 문자열 → 32비트 시드 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 시드가 같으면 같은 순서로 나오는 난수 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedPick<T>(items: T[], weight: (item: T) => number, rng: () => number = Math.random): T | null {
  if (items.length === 0) return null;
  const weights = items.map((it) => Math.max(0, weight(it)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)] ?? null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
