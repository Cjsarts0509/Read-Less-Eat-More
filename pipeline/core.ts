/**
 * 지점 하나의 식당 목록을 만든다. 외부 API 는 deps 로 주입받아 테스트할 수 있게 했다.
 *
 * 순서: 카카오(장소 목록) → 네이버 블로그(인기·최신 글) → Google(선택: 별점·영업시간)
 *      → Claude(신규 오픈·이벤트·시즌 메뉴·점심 정보) → 점심 영업 판정
 */
import { categorize } from "../shared/categories";
import { haversine, walkMinutes } from "../shared/geo";
import { pickHours } from "../shared/hours";
import { computeLunch, computePriceChange, daysBetween, isDeliveryOnly, mergePriceHistory, resolveHours, SPONSORED_RE } from "../shared/insights";
import type { Branch, BranchPlaces, GoogleInfo, Place, WebInfo } from "../shared/types";
import { mapLimit } from "./http";
import type { KakaoPlace } from "./sources/kakao";
import type { BlogSearchResult, SearchOptions } from "./sources/naver";
import { blogQuery, hoursQuery, isAmbiguousName, isRelevantPost, isStrictRelevantPost, rankReviewPosts } from "./sources/naver";

/**
 * NaverInfo 형식 버전 — 올리면 다음 수집 때 모두 다시 조회한다
 * 3: 최신순 10개 → 정확도순 100개 (이름만 스쳐 간 글 대신 실제 후기)
 */
const NAVER_FORMAT = 3;
/** 블로그 검색에서 받을 글 수 (정확도순) */
const NAVER_DISPLAY = 100;
import type { Analyzer, InsightInput } from "./sources/claude";

export interface CollectConfig {
  radius: number;
  maxPlaces: number;
  naverRefreshDays: number;
  googleMaxPerBranch: number;
  googleRefreshDays: number;
  aiBatchSize: number;
  aiConcurrency: number;
  /** 웹 검색으로 보강할 블로그 글 수 기준 (이하) */
  webMaxBlogTotal: number;
  webRefreshDays: number;
  /** 블로그 '영업시간' 검색을 다시 할 간격 (일) */
  hoursRefreshDays: number;
  /** 웹 조사 대상: 이 도보 시간(분) 안의 가게 */
  webMaxWalkMin: number;
}

export const DEFAULT_CONFIG: CollectConfig = {
  radius: 1000,
  maxPlaces: 400,
  naverRefreshDays: 3,
  googleMaxPerBranch: 0,
  googleRefreshDays: 30,
  aiBatchSize: 8,
  aiConcurrency: 2,
  webMaxBlogTotal: 3,
  webRefreshDays: 45,
  hoursRefreshDays: 30,
  webMaxWalkMin: 12,
};

export interface Deps {
  today: string;
  nowIso: string;
  kakao: (branch: Branch) => Promise<KakaoPlace[]>;
  naver: ((query: string, opts?: SearchOptions) => Promise<BlogSearchResult>) | null;
  google: ((place: Place) => Promise<GoogleInfo | null>) | null;
  analyzer: Analyzer | null;
  /** 블로그 글이 적은 가게를 웹 검색으로 보강 (선택) */
  web?: ((place: Place) => Promise<WebInfo | null>) | null;
  log?: (msg: string) => void;
}

export interface Budget {
  naver: number;
  google: number;
  ai: number;
  web?: number;
}

export interface BranchStats {
  kakao: number;
  kept: number;
  naverCalls: number;
  googleCalls: number;
  aiAnalyzed: number;
  aiPending: number;
  webChecked: number;
  hoursCalls: number;
  hoursFound: number;
  errors: number;
}

/** 새 글 중 이 단어가 있으면 바로 다시 분석한다 */
const NEWS_KEYWORDS = /오픈|신메뉴|새 메뉴|이벤트|행사|할인|시즌|한정|출시|개시|런치|점심\s?특선|리뉴얼|증정|기념|신상|폐업|이전|휴업|가격|인상|웨이팅|줄 서/;

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
    priceHistory: prev?.priceHistory,
    priceChange: prev?.priceChange ?? null,
    web: prev?.web ?? null,
    hours: prev?.hours ?? null,
    hoursCheckedAt: prev?.hoursCheckedAt,
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
  const stats: BranchStats = {
    kakao: 0,
    kept: 0,
    naverCalls: 0,
    googleCalls: 0,
    aiAnalyzed: 0,
    aiPending: 0,
    webChecked: 0,
    hoursCalls: 0,
    hoursFound: 0,
    errors: 0,
  };
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
    // AI 대기 중인 곳은 이번에 분석할 수 있는 만큼(인기 순)만 앞당겨 다시 조회한다.
    // 대기 중인 수천 곳을 매일 다시 조회하면 네이버 호출만 낭비된다.
    const pendingQuota = Math.max(20, Math.max(0, budget.ai) * 2);
    const pendingFirst = new Set(
      places
        .filter((p) => p.aiPending)
        .sort((a, b) => popularity(b) - popularity(a))
        .slice(0, pendingQuota)
        .map((p) => p.id),
    );
    const stale = places
      // 예전 형식(가게와 무관한 글까지 센 값)도 다시 조회
      .filter(
        (p) =>
          pendingFirst.has(p.id) || !p.naver || (p.naver.v ?? 1) < NAVER_FORMAT || daysBetween(p.naver.checkedAt, today) >= cfg.naverRefreshDays,
      )
      .sort((a, b) => {
        const pa = pendingFirst.has(a.id) ? 0 : 1;
        const pb = pendingFirst.has(b.id) ? 0 : 1;
        return pa - pb || (a.naver?.checkedAt ?? "").localeCompare(b.naver?.checkedAt ?? "");
      });
    const targets = stale.slice(0, Math.max(0, budget.naver));
    budget.naver -= targets.length;
    await mapLimit(targets, 4, async (p) => {
      const q = blogQuery(p.name, docs.find((d) => d.id === p.id)?.address_name ?? "", p.address);
      try {
        stats.naverCalls++;
        // 정확도순 100개: 최신순으로 받으면 이름만 스쳐 간 글(여행 코스 모음, 납품 후기)이 앞에 온다
        const res = await naver(q.query, { sort: "sim", display: NAVER_DISPLAY });
        // 이름이 흔한 단어면 무관한 글이 섞인다 → 이 가게 이야기인 글만 쓴다
        // 한두 글자 이름(「한」「오늘」)은 흔한 낱말과 섞여 검색 수를 믿을 수 없다 → 제목에 이름 + 동네가 함께 있는 글만, 수도 그 글 수만
        const ambiguous = isAmbiguousName(q.core);
        const relevant = res.posts.filter((post) => (ambiguous ? isStrictRelevantPost(post, q) : isRelevantPost(post, q)));
        const relevance = res.posts.length ? relevant.length / res.posts.length : 0;
        // 정확도순 상위 글에 무관한 글이 섞여 있으면 관련 글은 거의 다 받은 셈 → 그 수를 쓴다.
        // 상위 글이 거의 다 관련 글이면(인기 가게) 전체 검색 수에 비율을 곱해 어림한다.
        const blogTotal =
          ambiguous || relevant.length < res.posts.length * 0.9
            ? relevant.length
            : Math.max(relevant.length, Math.round(res.total * relevance));
        const byDate = [...relevant].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        const recent = relevant.filter((post) => post.date && daysBetween(post.date, today) <= 30).length;
        const hadOldFormat = p.naver !== null && (p.naver.v ?? 1) < 2;
        p.naver = {
          blogTotal,
          rawTotal: res.total,
          relevance: Math.round(relevance * 100) / 100,
          ambiguous: ambiguous || undefined,
          v: NAVER_FORMAT,
          sponsoredHint: byDate.slice(0, 10).filter((post) => SPONSORED_RE.test(`${post.title} ${post.snippet}`)).length,
          recentPosts: recent,
          latestPostDate: byDate.find((post) => post.date)?.date ?? null,
          posts: rankReviewPosts(relevant, q.core)
            .slice(0, 3)
            .map(({ title, link, date }) => ({ title, link, date })),
          query: q.query,
          checkedAt: today,
        };
        // 첫 형식(가게와 무관한 글까지 읽음)으로 분석한 AI 결과는 다시 분석한다
        if (hadOldFormat) p.ai = null;
        // AI 에는 최근 글 10개를 넘긴다 (새 소식 · 이벤트는 최신 글에 있다)
        freshPosts.set(p.id, byDate.slice(0, 10));
      } catch (err) {
        stats.errors++;
        log(`  네이버 실패 ${p.name}: ${(err as Error).message}`);
      }
    });
  }

  // 2-2) 블로그 '영업시간' 검색: 가게 이름 + 동네 + 영업시간 으로 찾은 글에서 시각을 읽는다.
  //      검색 요약문은 검색어 주변을 보여 주므로 영업시간 문장이 잘 걸린다.
  if (deps.naver) {
    const naver = deps.naver;
    const due = places
      .filter(
        (p) =>
          p.naver !== null &&
          !p.naver.ambiguous &&
          p.naver.blogTotal > 0 &&
          p.hours?.source !== "google" &&
          p.hours?.source !== "web" &&
          (!p.hoursCheckedAt || daysBetween(p.hoursCheckedAt, today) >= cfg.hoursRefreshDays),
      )
      .sort((a, b) => a.walkMin - b.walkMin || popularity(b) - popularity(a));
    const targets = due.slice(0, Math.max(0, budget.naver));
    budget.naver -= targets.length;
    await mapLimit(targets, 4, async (p) => {
      const q = blogQuery(p.name, docs.find((d) => d.id === p.id)?.address_name ?? "", p.address);
      try {
        stats.hoursCalls++;
        const res = await naver(hoursQuery(q), { sort: "sim", display: 20 });
        const relevant = res.posts.filter((post) => isRelevantPost(post, q));
        const found = pickHours(relevant);
        p.hoursCheckedAt = today;
        if (found) {
          stats.hoursFound++;
          p.hours = {
            open: found.open,
            close: found.close,
            breakStart: found.breakStart,
            breakEnd: found.breakEnd,
            lastOrder: found.lastOrder,
            closedDays: found.closedDays,
            text: found.text,
            source: "blog",
            date: found.date,
            link: found.link,
            checkedAt: today,
          };
        }
      } catch (err) {
        stats.errors++;
        log(`  영업시간 검색 실패 ${p.name}: ${(err as Error).message}`);
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
          const analyzedCount = Math.max(1, inputs.find((x) => x.id === p.id)?.posts.length ?? posts.length);
          p.priceHistory = mergePriceHistory(
            p.priceHistory,
            r.prices.map((x) => ({ ...x, source: "blog" as const })),
          );
          p.ai = {
            bookTitle: r.bookTitle || undefined,
            summary: r.summary,
            signatureMenus: r.signatureMenus,
            priceHint: r.priceHint,
            badges: r.badges,
            lunch: r.lunch,
            lunchNote: r.lunchNote,
            tags: r.tags,
            closure: r.closure,
            waiting: r.waiting,
            pace: r.pace,
            dineIn: r.dineIn,
            adRatio: Math.round(Math.min(1, r.sponsoredPosts / analyzedCount) * 100) / 100,
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

  // 5) AI 웹 조사: 추천에 자주 오를 가까운 가게부터 영업시간 · 휴무 · 매장 식사 여부를 확인한다.
  //    (영업시간을 아직 모르는 곳 → 블로그 글이 거의 없는 새 가게 → 인기순)
  if (deps.web && (budget.web ?? 0) > 0) {
    const web = deps.web;
    const due = places
      .filter(
        (p) =>
          p.category !== "dessert" &&
          p.category !== "pub" &&
          !isDeliveryOnly(p) &&
          p.walkMin <= cfg.webMaxWalkMin &&
          // 네이버를 쓰는데 조회가 안 된 곳(키 오류 등)은 건너뛴다
          (deps.naver ? p.naver !== null : true) &&
          (!p.web || daysBetween(p.web.checkedAt, today) >= cfg.webRefreshDays),
      )
      .sort((a, b) => {
        const rank = (p: Place) =>
          (p.hours || p.google?.hoursText ? 2 : 0) + (p.naver && p.naver.blogTotal <= cfg.webMaxBlogTotal ? 0 : 1);
        return rank(a) - rank(b) || popularity(b) - popularity(a) || a.distance - b.distance;
      });
    const targets = due.slice(0, Math.max(0, budget.web ?? 0));
    budget.web = (budget.web ?? 0) - targets.length;
    await mapLimit(targets, 2, async (p) => {
      try {
        stats.webChecked++;
        const info = await web(p);
        if (info) {
          p.web = info;
          if (info.menus.length && !p.ai?.signatureMenus.length && p.ai) p.ai.signatureMenus = info.menus.slice(0, 3);
          if (info.menuPrice) {
            p.priceHistory = mergePriceHistory(p.priceHistory, [{ ...info.menuPrice, date: today, source: "web" as const }]);
          }
        } else {
          p.web = { summary: null, openedOn: null, hours: null, lunch: "unknown", closure: "unknown", menus: [], sources: [], checkedAt: today };
        }
      } catch (err) {
        stats.errors++;
        log(`  웹 검색 실패 ${p.name}: ${(err as Error).message}`);
      }
    });
  }

  // 6) 영업시간 정리 · 배달 전문 표시 · 가격 변동 · 점심 영업 판정
  for (const p of places) {
    p.hours = resolveHours(p, today);
    p.deliveryOnly = isDeliveryOnly(p) || undefined;
    p.priceChange = computePriceChange(p.priceHistory);
    const { status, reason } = computeLunch(p, today);
    p.lunch = status;
    p.lunchReason = reason;
  }

  stats.kept = places.length;
  const sources = ["kakao"];
  if (deps.naver) sources.push("naver-blog");
  if (deps.google && cfg.googleMaxPerBranch > 0) sources.push("google-places");
  if (deps.analyzer) sources.push(`claude:${deps.analyzer.model}`);
  if (deps.web) sources.push("web-search");

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
