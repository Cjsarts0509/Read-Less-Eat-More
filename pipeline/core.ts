/**
 * 지점 하나의 식당 목록을 만든다. 외부 API 는 deps 로 주입받아 테스트할 수 있게 했다.
 *
 * 순서: 카카오(장소 목록) → 네이버 블로그(인기·최신 글) → Google(선택: 별점·영업시간)
 *      → Claude(신규 오픈·이벤트·시즌 메뉴·점심 정보) → 점심 영업 판정
 */
import { categorize } from "../shared/categories";
import { haversine, walkMinutes } from "../shared/geo";
import { computeLunch, daysBetween } from "../shared/insights";
import type { Branch, BranchPlaces, GoogleInfo, Place } from "../shared/types";
import { mapLimit } from "./http";
import type { KakaoPlace } from "./sources/kakao";
import type { BlogSearchResult } from "./sources/naver";
import { buildQuery } from "./sources/naver";
import type { Analyzer, InsightInput } from "./sources/claude";

export interface CollectConfig {
  radius: number;
  maxPlaces: number;
  naverRefreshDays: number;
  googleMaxPerBranch: number;
  googleRefreshDays: number;
  aiBatchSize: number;
  aiConcurrency: number;
}

export const DEFAULT_CONFIG: CollectConfig = {
  radius: 1000,
  maxPlaces: 400,
  naverRefreshDays: 3,
  googleMaxPerBranch: 0,
  googleRefreshDays: 30,
  aiBatchSize: 8,
  aiConcurrency: 2,
};

export interface Deps {
  today: string;
  nowIso: string;
  kakao: (branch: Branch) => Promise<KakaoPlace[]>;
  naver: ((query: string) => Promise<BlogSearchResult>) | null;
  google: ((place: Place) => Promise<GoogleInfo | null>) | null;
  analyzer: Analyzer | null;
  log?: (msg: string) => void;
}

export interface Budget {
  naver: number;
  google: number;
  ai: number;
}

export interface BranchStats {
  kakao: number;
  kept: number;
  naverCalls: number;
  googleCalls: number;
  aiAnalyzed: number;
  aiPending: number;
  errors: number;
}

/** 새 글 중 이 단어가 있으면 바로 다시 분석한다 */
const NEWS_KEYWORDS = /오픈|신메뉴|새 메뉴|이벤트|행사|할인|시즌|한정|출시|개시|런치|점심\s?특선|리뉴얼|증정|기념|신상/;

export function needsAnalysis(place: Place, posts: BlogSearchResult["posts"], today: string): boolean {
  if (posts.length === 0) return false;
  if (!place.ai) return true;
  const since = place.ai.sourceLatestPost;
  const fresh = since ? posts.filter((p) => p.date && p.date > since) : posts;
  if (fresh.length === 0) return false;
  if (fresh.some((p) => NEWS_KEYWORDS.test(`${p.title} ${p.snippet}`))) return true;
  return fresh.length >= 5 && daysBetween(place.ai.analyzedAt, today) >= 30;
}

export function toPlace(doc: KakaoPlace, branch: Branch, prev: Place | undefined, today: string): Place {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  const distance = Math.round(haversine({ lat: branch.lat, lng: branch.lng }, { lat, lng }));
  const { key, path } = categorize(doc.category_name);
  return {
    id: doc.id,
    name: doc.place_name,
    category: key,
    categoryPath: path,
    address: doc.road_address_name || doc.address_name,
    phone: doc.phone || null,
    lat,
    lng,
    distance,
    walkMin: walkMinutes(distance),
    kakaoUrl: doc.place_url,
    firstSeen: prev?.firstSeen ?? today,
    naver: prev?.naver ?? null,
    google: prev?.google ?? null,
    ai: prev?.ai ?? null,
    lunch: "unknown",
    lunchReason: "",
    aiPending: prev?.aiPending || undefined,
  };
}

function popularity(p: Place): number {
  return p.naver?.blogTotal ?? -1;
}

export async function collectBranch(
  branch: Branch,
  prev: BranchPlaces | null,
  cfg: CollectConfig,
  deps: Deps,
  budget: Budget,
): Promise<{ data: BranchPlaces; stats: BranchStats }> {
  const log = deps.log ?? (() => {});
  const { today } = deps;
  const stats: BranchStats = { kakao: 0, kept: 0, naverCalls: 0, googleCalls: 0, aiAnalyzed: 0, aiPending: 0, errors: 0 };
  const prevMap = new Map((prev?.places ?? []).map((p) => [p.id, p]));

  // 1) 카카오: 반경 안 음식점
  const docs = await deps.kakao(branch);
  stats.kakao = docs.length;
  let places = docs
    .map((d) => toPlace(d, branch, prevMap.get(d.id), today))
    .filter((p) => Number.isFinite(p.distance) && p.distance <= cfg.radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, cfg.maxPlaces);

  // 2) 네이버 블로그: 오래된 것부터 갱신 (AI 대기 중인 곳 우선)
  const freshPosts = new Map<string, BlogSearchResult["posts"]>();
  if (deps.naver) {
    const naver = deps.naver;
    const stale = places
      .filter((p) => p.aiPending || !p.naver || daysBetween(p.naver.checkedAt, today) >= cfg.naverRefreshDays)
      .sort((a, b) => {
        const pa = a.aiPending ? 0 : 1;
        const pb = b.aiPending ? 0 : 1;
        return pa - pb || (a.naver?.checkedAt ?? "").localeCompare(b.naver?.checkedAt ?? "");
      });
    const targets = stale.slice(0, Math.max(0, budget.naver));
    budget.naver -= targets.length;
    await mapLimit(targets, 4, async (p) => {
      const query = buildQuery(p.name, docs.find((d) => d.id === p.id)?.address_name ?? "", p.address);
      try {
        stats.naverCalls++;
        const res = await naver(query);
        const recent = res.posts.filter((post) => post.date && daysBetween(post.date, today) <= 30).length;
        p.naver = {
          blogTotal: res.total,
          recentPosts: recent,
          latestPostDate: res.posts.find((post) => post.date)?.date ?? null,
          posts: res.posts.slice(0, 3).map(({ title, link, date }) => ({ title, link, date })),
          query,
          checkedAt: today,
        };
        freshPosts.set(p.id, res.posts);
      } catch (err) {
        stats.errors++;
        log(`  네이버 실패 ${p.name}: ${(err as Error).message}`);
      }
    });
  }

  // 3) Google (선택): 인기 상위 N곳의 별점·영업시간
  if (deps.google && cfg.googleMaxPerBranch > 0) {
    const google = deps.google;
    const top = [...places].sort((a, b) => popularity(b) - popularity(a)).slice(0, cfg.googleMaxPerBranch);
    const due = top.filter((p) => !p.google || daysBetween(p.google.checkedAt, today) >= cfg.googleRefreshDays);
    const targets = due.slice(0, Math.max(0, budget.google));
    budget.google -= targets.length;
    await mapLimit(targets, 4, async (p) => {
      try {
        stats.googleCalls++;
        p.google = (await google(p)) ?? {
          rating: null,
          ratingCount: null,
          openAtLunch: null,
          hoursText: null,
          mapsUrl: null,
          businessStatus: null,
          checkedAt: today,
        };
      } catch (err) {
        stats.errors++;
        log(`  Google 실패 ${p.name}: ${(err as Error).message}`);
      }
    });
    // 폐업한 곳은 뺀다
    places = places.filter((p) => p.google?.businessStatus !== "CLOSED_PERMANENTLY");
  }

  // 4) Claude: 새 소식이 있는 곳만 분석 (인기순)
  const candidates = places
    .filter((p) => needsAnalysis(p, freshPosts.get(p.id) ?? [], today))
    .sort((a, b) => popularity(b) - popularity(a));
  for (const p of places) if (!candidates.includes(p) && freshPosts.has(p.id)) p.aiPending = undefined;

  if (deps.analyzer && candidates.length) {
    const analyzer = deps.analyzer;
    const allowed = candidates.slice(0, Math.max(0, budget.ai));
    budget.ai -= allowed.length;
    for (const p of candidates.slice(allowed.length)) p.aiPending = true;

    const batches: Place[][] = [];
    for (let i = 0; i < allowed.length; i += cfg.aiBatchSize) batches.push(allowed.slice(i, i + cfg.aiBatchSize));

    await mapLimit(batches, cfg.aiConcurrency, async (batch) => {
      const inputs: InsightInput[] = batch.map((p) => ({
        id: p.id,
        name: p.name,
        categoryPath: p.categoryPath,
        address: p.address,
        posts: (freshPosts.get(p.id) ?? []).map(({ date, title, snippet }) => ({ date, title, snippet })),
      }));
      try {
        const results = await analyzer.analyze(today, inputs);
        for (const p of batch) {
          const r = results.get(p.id);
          if (!r) {
            p.aiPending = true;
            continue;
          }
          const posts = freshPosts.get(p.id) ?? [];
          p.ai = {
            summary: r.summary,
            signatureMenus: r.signatureMenus,
            priceHint: r.priceHint,
            badges: r.badges,
            lunch: r.lunch,
            lunchNote: r.lunchNote,
            tags: r.tags,
            analyzedAt: today,
            model: analyzer.model,
            sourceLatestPost: posts.map((x) => x.date).filter(Boolean).sort().at(-1) ?? null,
          };
          p.aiPending = undefined;
          stats.aiAnalyzed++;
        }
      } catch (err) {
        stats.errors++;
        for (const p of batch) p.aiPending = true;
        log(`  Claude 실패 (${batch.length}곳): ${(err as Error).message}`);
      }
    });
  } else if (!deps.analyzer) {
    // AI 키가 없으면 대기 표시를 남기지 않는다
    for (const p of places) p.aiPending = undefined;
  }
  stats.aiPending = places.filter((p) => p.aiPending).length;

  // 5) 점심 영업 판정
  for (const p of places) {
    const { status, reason } = computeLunch(p);
    p.lunch = status;
    p.lunchReason = reason;
  }

  stats.kept = places.length;
  const sources = ["kakao"];
  if (deps.naver) sources.push("naver-blog");
  if (deps.google && cfg.googleMaxPerBranch > 0) sources.push("google-places");
  if (deps.analyzer) sources.push(`claude:${deps.analyzer.model}`);

  return {
    data: { branch: branch.code, generatedAt: deps.nowIso, radius: cfg.radius, sources, places },
    stats,
  };
}

/** 장소 하나당 한 줄로 써서 git diff 가 읽기 쉽게 한다 */
export function serializeBranchPlaces(data: BranchPlaces): string {
  const { places, ...meta } = data;
  const head = JSON.stringify(meta).slice(0, -1);
  const body = places.map((p) => JSON.stringify(p)).join(",\n");
  return `${head},"places":[\n${body}\n]}\n`;
}
