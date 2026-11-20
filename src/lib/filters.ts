import type { MenuReport, ReviewSummary } from "../../shared/api";
import { isLunchFriendly, isNewlyListed, placeBadges } from "../../shared/insights";
import { lunchPrice } from "../../shared/price";
import { estimateLunchTime } from "../../shared/time";
import type { BadgeType, CategoryKey, Place } from "../../shared/types";

export type SortKey = "distance" | "popular" | "buzz" | "inhouse" | "cheap" | "rating" | "news";
export type NewsFilter = "new" | "event" | "menu" | "lunch_special";

export const SORT_LABEL: Record<SortKey, string> = {
  distance: "가까운 순",
  popular: "블로그 리뷰 많은 순",
  buzz: "요즘 많이 언급되는 순",
  inhouse: "사내 평점 순",
  cheap: "가격 낮은 순",
  rating: "Google 평점 순",
  news: "새 소식 먼저",
};

export const NEWS_FILTERS: Array<{ key: NewsFilter; label: string; types: BadgeType[] }> = [
  { key: "new", label: "신규 오픈", types: ["new_open"] },
  { key: "event", label: "이벤트·할인", types: ["event", "discount"] },
  { key: "menu", label: "시즌·신메뉴", types: ["seasonal_menu", "new_menu"] },
  { key: "lunch_special", label: "점심 특선", types: ["lunch_special"] },
];

export interface Filters {
  walk: number; // 분, 0 = 전체
  /** 점심시간 한도 (왕복 + 식사 + 웨이팅, 분). 0 = 제한 없음 */
  timeBudget: number;
  lunchOnly: boolean;
  sort: SortKey;
  query: string;
  news: NewsFilter[];
  /** 1인 예산 (원). 0 = 제한 없음. 가격을 아는 곳 중 넘는 곳만 뺀다 */
  budget: number;
}

export const DEFAULT_FILTERS: Filters = { walk: 10, timeBudget: 0, lunchOnly: true, sort: "distance", query: "", news: [], budget: 0 };

export interface Ctx {
  today: string;
  baselineDate: string | null;
  /** 사내 평점 (가게 id → 요약) */
  reviews?: Record<string, ReviewSummary>;
  /** 직원이 올린 메뉴판 (가격 어림에 씀) */
  menus?: Record<string, MenuReport[]>;
  /** 1인 예산 (카드에 '한도 안/넘음' 표시) */
  budget?: number;
}

export function priceOf(p: Place, ctx: Ctx) {
  return lunchPrice(p, ctx.menus?.[p.id], ctx.today);
}

/** 사내 평점 순위 점수: 평가가 적으면 3.5점 쪽으로 당긴다 */
export function inhouseScore(p: Place, ctx: Ctx): number {
  const r = ctx.reviews?.[p.id];
  if (!r || r.count === 0) return -1;
  return (r.avg * r.count + 3.5 * 2) / (r.count + 2);
}

/** 사내 베스트셀러: 평가가 있는 곳 중 점수 높은 순 */
export function inhouseTop(places: Place[], ctx: Ctx, n = 5): Place[] {
  return places
    .filter((p) => (ctx.reviews?.[p.id]?.count ?? 0) > 0)
    .sort((a, b) => inhouseScore(b, ctx) - inhouseScore(a, ctx))
    .slice(0, n);
}

export function badgesOf(p: Place, ctx: Ctx) {
  return placeBadges(p, ctx.today);
}

export function newsScore(p: Place, ctx: Ctx): number {
  return badgesOf(p, ctx).filter((b) => b.type !== "lunch_special").length + (isNewlyListed(p, ctx.baselineDate, ctx.today) ? 1 : 0);
}

function matchesNews(p: Place, news: NewsFilter[], ctx: Ctx): boolean {
  if (news.length === 0) return true;
  const types = new Set(badgesOf(p, ctx).map((b) => b.type));
  return news.some((key) => {
    if (key === "new" && isNewlyListed(p, ctx.baselineDate, ctx.today)) return true;
    return NEWS_FILTERS.find((f) => f.key === key)!.types.some((t) => types.has(t));
  });
}

function matchesQuery(p: Place, q: string): boolean {
  if (!q) return true;
  const hay = [p.name, p.categoryPath, p.ai?.summary, ...(p.ai?.signatureMenus ?? []), ...(p.ai?.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** 분류 탭을 뺀 나머지 조건 (탭별 개수를 세는 데도 쓴다) */
export function applyFilters(places: Place[], f: Filters, ctx: Ctx): Place[] {
  return places.filter(
    (p) =>
      (f.walk === 0 || p.walkMin <= f.walk) &&
      (!f.timeBudget || estimateLunchTime(p).total <= f.timeBudget) &&
      (!f.lunchOnly || isLunchFriendly(p.lunch)) &&
      (!f.budget || (priceOf(p, ctx)?.price ?? 0) <= f.budget) &&
      matchesNews(p, f.news, ctx) &&
      matchesQuery(p, f.query.trim()),
  );
}

export function sortPlaces(places: Place[], sort: SortKey, ctx: Ctx): Place[] {
  const by = [...places];
  const dist = (a: Place, b: Place) => a.distance - b.distance;
  switch (sort) {
    case "distance":
      return by.sort(dist);
    case "popular":
      return by.sort((a, b) => (b.naver?.blogTotal ?? -1) - (a.naver?.blogTotal ?? -1) || dist(a, b));
    case "buzz":
      return by.sort(
        (a, b) =>
          (b.naver?.recentPosts ?? -1) - (a.naver?.recentPosts ?? -1) ||
          (b.naver?.blogTotal ?? -1) - (a.naver?.blogTotal ?? -1) ||
          dist(a, b),
      );
    case "inhouse":
      return by.sort((a, b) => inhouseScore(b, ctx) - inhouseScore(a, ctx) || dist(a, b));
    case "cheap":
      return by.sort((a, b) => (priceOf(a, ctx)?.price ?? Infinity) - (priceOf(b, ctx)?.price ?? Infinity) || dist(a, b));
    case "rating":
      return by.sort((a, b) => (b.google?.rating ?? -1) - (a.google?.rating ?? -1) || dist(a, b));
    case "news":
      return by.sort((a, b) => newsScore(b, ctx) - newsScore(a, ctx) || dist(a, b));
  }
}

export function countByCategory(places: Place[]): Map<CategoryKey | "all", number> {
  const m = new Map<CategoryKey | "all", number>([["all", places.length]]);
  for (const p of places) m.set(p.category, (m.get(p.category) ?? 0) + 1);
  return m;
}
