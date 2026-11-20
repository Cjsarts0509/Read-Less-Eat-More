import { activeBadges, isLunchFriendly, isNewlyListed } from "../../shared/insights";
import type { BadgeType, CategoryKey, Place } from "../../shared/types";

export type SortKey = "distance" | "popular" | "buzz" | "rating" | "news";
export type NewsFilter = "new" | "event" | "menu" | "lunch_special";

export const SORT_LABEL: Record<SortKey, string> = {
  distance: "가까운 순",
  popular: "블로그 리뷰 많은 순",
  buzz: "요즘 많이 언급되는 순",
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
  lunchOnly: boolean;
  sort: SortKey;
  query: string;
  news: NewsFilter[];
}

export const DEFAULT_FILTERS: Filters = { walk: 10, lunchOnly: true, sort: "distance", query: "", news: [] };

export interface Ctx {
  today: string;
  baselineDate: string | null;
}

export function badgesOf(p: Place, ctx: Ctx) {
  return activeBadges(p.ai?.badges, ctx.today);
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
      (!f.lunchOnly || isLunchFriendly(p.lunch)) &&
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
