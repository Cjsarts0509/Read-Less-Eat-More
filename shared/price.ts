/**
 * 점심 1인 가격 어림: 블로그 · 웹 · 메뉴판 사진에서 모은 메뉴 가격 → AI 가 정리한 가격대 → 웹 조사 대표 메뉴 순.
 * 1인 식사로 보기 어려운 값(4천원 미만 · 3만원 넘음)은 빼고, 여러 메뉴 중 아래쪽 30% 값을 쓴다.
 */
import { daysBetween } from "./insights";
import type { Place } from "./types";

export interface LunchPrice {
  price: number;
  source: "menu" | "hint" | "web" | "photo";
}

const MIN = 4000;
const MAX = 30000;

/** 아래쪽 30% 지점 값: 수육 · 전골처럼 나눠 먹는 비싼 메뉴에 끌려가지 않게 */
const typical = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * 0.3)]!;
};

/** "9천원대" · "1만~1.5만원" · "8,000원" · "1만원대" · "9,900원" → 대표값 */
export function parsePriceHint(hint: string | null | undefined): number | null {
  if (!hint) return null;
  const nums: number[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(만|천)?/g;
  for (const m of hint.replace(/\s+/g, "").matchAll(re)) {
    let v = Number(m[1]!.replace(/,/g, ""));
    if (m[2] === "만") v *= 10000;
    else if (m[2] === "천") v *= 1000;
    else if (v < 100 && /만/.test(hint)) v *= 10000;
    nums.push(v);
  }
  const vals = nums.filter((v) => v >= 1000 && v <= 200000);
  if (!vals.length) return null;
  let v = vals.length >= 2 ? (vals[0]! + vals[1]!) / 2 : vals[0]!;
  // "9천원대" → 9,500원쯤 · "1만원대" → 12,000원쯤
  if (vals.length === 1 && /대/.test(hint)) v += v >= 10000 ? 2000 : 500;
  return Math.round(v / 100) * 100;
}

export function lunchPrice(
  place: Pick<Place, "priceHistory" | "ai" | "web">,
  reports?: Array<{ items: Array<{ price: number | null }> }>,
  today = new Date().toISOString().slice(0, 10),
): LunchPrice | null {
  const fresh = (place.priceHistory ?? []).filter(
    (p) => p.price >= MIN && p.price <= MAX && (!p.date || daysBetween(p.date, today) <= 365),
  );
  if (fresh.length) {
    // 메뉴마다 가장 최근 가격, 최근 메뉴 5개의 가운데 값
    const seen = new Set<string>();
    const latest = fresh.filter((p) => (seen.has(p.item) ? false : (seen.add(p.item), true))).slice(0, 5);
    return { price: typical(latest.map((p) => p.price)), source: latest.some((p) => p.source === "photo") ? "photo" : "menu" };
  }
  const photo = (reports ?? []).flatMap((r) => r.items.map((i) => i.price)).filter((p): p is number => p !== null && p >= MIN && p <= MAX);
  if (photo.length) return { price: typical(photo), source: "photo" };
  const hint = parsePriceHint(place.ai?.priceHint);
  if (hint && hint >= MIN && hint <= MAX) return { price: hint, source: "hint" };
  const w = place.web?.menuPrice?.price;
  if (w && w >= MIN && w <= MAX) return { price: w, source: "web" };
  return null;
}

export const PRICE_SOURCE_LABEL: Record<LunchPrice["source"], string> = {
  menu: "후기 속 메뉴 가격",
  hint: "AI 가 정리한 가격대",
  web: "웹 조사 대표 메뉴",
  photo: "직원이 올린 메뉴판",
};
