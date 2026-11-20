import { formatHours, hoursOpenAtLunch, parseClosedDays, parseHoursText } from "./hours";
import type { Badge, BadgeType, ClosureState, GoogleInfo, HoursInfo, LunchStatus, Place, PricePoint } from "./types";

export const BADGE_META: Record<BadgeType, { label: string; tone: string; maxAgeDays: number }> = {
  new_open: { label: "신규 오픈", tone: "green", maxAgeDays: 90 },
  event: { label: "이벤트", tone: "red", maxAgeDays: 45 },
  discount: { label: "할인", tone: "red", maxAgeDays: 45 },
  seasonal_menu: { label: "시즌 메뉴", tone: "gold", maxAgeDays: 75 },
  new_menu: { label: "신메뉴", tone: "violet", maxAgeDays: 60 },
  lunch_special: { label: "점심 특선", tone: "blue", maxAgeDays: 365 },
};

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(toIso.slice(0, 10) + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** 근거 날짜가 너무 오래된 배지는 숨긴다 (데이터가 갱신되지 않아도 화면에서 자동 만료). */
export function activeBadges(badges: Badge[] | undefined, today: string): Badge[] {
  if (!badges) return [];
  return badges.filter((b) => {
    const meta = BADGE_META[b.type];
    if (!meta) return false;
    if (!b.evidenceDate) return b.type === "lunch_special";
    const age = daysBetween(b.evidenceDate, today);
    return age >= -1 && age <= meta.maxAgeDays;
  });
}

/** 가게의 새 소식: AI 가 찾은 것 + 블로그 낱말로 찾은 것 (같은 종류면 AI 우선) */
export function placeBadges(place: Pick<Place, "ai" | "autoBadges">, today: string): Badge[] {
  const ai = activeBadges(place.ai?.badges, today);
  const auto = activeBadges(place.autoBadges, today).filter((b) => !ai.some((a) => a.type === b.type));
  return [...ai, ...auto];
}

const KEYWORD_RULES: Array<{ type: BadgeType; re: RegExp; not?: RegExp; label: (m: RegExpMatchArray, date: string) => string }> = [
  {
    type: "new_open",
    re: /(신규|그랜드|정식|가)\s*오픈|새로\s*(생긴|오픈|문\s*연)|오픈\s*(기념|소식|첫날|이벤트)|오픈한\s*지\s*(얼마|몇|한\s*달|\d+\s*(일|주|개월))|신장\s*개업|개업\s*(했|기념|소식)|new\s*open/i,
    not: /오픈\s*(시간|런|하자마자|맞춰|직후|시각)/,
    label: (_m, date) => `${Number(date.slice(5, 7))}월 오픈 소식`,
  },
  { type: "event", re: /이벤트|증정|사은품|경품|쿠폰\s*(증정|지급|이벤트)/, not: /이벤트\s*홀/, label: () => "이벤트 진행" },
  { type: "discount", re: /할인\s*(행사|이벤트|중)|\d+\s*%\s*(할인|off)|반값|1\s*\+\s*1|가격\s*인하/i, label: () => "할인 소식" },
  {
    type: "seasonal_menu",
    re: /(겨울|여름|봄|가을|시즌|기간|계절)\s*한정|한정\s*(메뉴|판매)|시즌\s*메뉴|(굴|매생이|콩국수|냉면|팥빙수|빙수|딸기|대방어|방어|꼬막|과메기)\s*(개시|시작|출시|시즌)/,
    label: (m) => (m[3] ? `${m[3]} ${m[4]}` : "시즌 한정"),
  },
  { type: "new_menu", re: /신메뉴|새\s*메뉴|신상\s*메뉴|메뉴\s*출시/, label: () => "신메뉴" },
  {
    type: "lunch_special",
    re: /점심\s*특선|런치\s*(세트|메뉴|특선|코스|스페셜)|점심\s*(세트|정식|한정)|직장인\s*(점심|메뉴|세트)/,
    label: () => "점심 특선",
  },
];

/**
 * 블로그 글 제목 · 요약에서 새 소식 낱말을 찾는다 (AI 분석이 닿기 전에도 새 소식을 보여 주려고).
 * 종류마다 가장 최근 글 하나만, 기간이 지난 글은 버린다.
 */
export function keywordBadges(posts: Array<{ title: string; snippet?: string; date: string | null; link?: string }>, today: string): Badge[] {
  const out: Badge[] = [];
  const sorted = [...posts].filter((p) => p.date).sort((a, b) => b.date!.localeCompare(a.date!));
  for (const rule of KEYWORD_RULES) {
    for (const post of sorted) {
      const age = daysBetween(post.date!, today);
      if (age < -1 || age > BADGE_META[rule.type].maxAgeDays) continue;
      const text = `${post.title} ${post.snippet ?? ""}`;
      const m = text.match(rule.re);
      if (!m || rule.not?.test(text)) continue;
      out.push({
        type: rule.type,
        label: rule.label(m, post.date!),
        detail: post.title.length > 40 ? `${post.title.slice(0, 39)}…` : post.title,
        evidenceDate: post.date,
        auto: true,
        link: post.link,
      });
      break;
    }
  }
  return out;
}

/** 파이프라인이 처음 본 날이 기준일 이후이고 60일 안이면 '지도 신규 등록' */
export function isNewlyListed(place: Pick<Place, "firstSeen">, baselineDate: string | null, today: string): boolean {
  if (!baselineDate) return false;
  if (place.firstSeen <= baselineDate) return false;
  return daysBetween(place.firstSeen, today) <= 60;
}

interface Period {
  open?: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

/** Google regularOpeningHours.periods 로 특정 요일 [start, end) 분 구간에 영업하는지 */
export function isOpenDuring(periods: Period[], day: number, startMin: number, endMin: number): boolean {
  const WEEK = 7 * 24 * 60;
  const qs = day * 1440 + startMin;
  const qe = day * 1440 + endMin;
  for (const p of periods) {
    if (!p.open) continue;
    // 닫는 시간이 없으면 24시간 영업
    if (!p.close) return true;
    const s = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let e = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (e <= s) e += WEEK; // 토요일 밤 → 일요일 새벽처럼 주를 넘기는 구간
    for (const shift of [0, -WEEK, WEEK]) {
      if (s + shift <= qs && e + shift >= qe) return true;
    }
  }
  return false;
}

/** 평일(월~금) 중 3일 이상 12:00~13:00 에 열면 점심 영업으로 본다 */
export function openAtWeekdayLunch(periods: Period[] | undefined | null): boolean | null {
  if (!periods || periods.length === 0) return null;
  let open = 0;
  for (let day = 1; day <= 5; day++) {
    if (isOpenDuring(periods, day, 12 * 60, 13 * 60)) open++;
  }
  return open >= 3;
}

/** 폐업 · 이전 · 휴업 단서 (AI 분석 → 웹 검색 순). 오래된 근거(1년 넘음)는 무시 */
export function closureOf(place: Pick<Place, "ai" | "web">, today: string): { state: ClosureState; note: string } | null {
  const c = place.ai?.closure;
  if (c && c.state !== "open" && c.state !== "unknown") {
    if (!c.evidenceDate || daysBetween(c.evidenceDate, today) <= 365) {
      return { state: c.state, note: c.note ?? "" };
    }
  }
  const w = place.web;
  if (w && w.closure !== "open" && w.closure !== "unknown") return { state: w.closure, note: "웹 검색 결과" };
  return null;
}

export const CLOSURE_LABEL: Record<ClosureState, string> = {
  open: "영업 중",
  closed: "폐업 의심",
  moved: "이전 소식",
  temporarily_closed: "휴업 중",
  unknown: "",
};

/** 최신 글 중 협찬 · 체험단 글 비율. AI 판정이 있으면 그것, 없으면 키워드 추정 */
export function adRatioOf(place: Pick<Place, "ai" | "naver">): number | null {
  if (typeof place.ai?.adRatio === "number") return place.ai.adRatio;
  const n = place.naver;
  if (n && typeof n.sponsoredHint === "number" && n.posts.length > 0) return Math.min(1, n.sponsoredHint / 10);
  return null;
}

export const SPONSORED_RE = /체험단|협찬|원고료|제공\s?받|소정의|업체로부터|광고\s?포함|광고입니다|내돈내산 아님/;

/** 가격 기록을 합친다: 같은 메뉴·가격·날짜는 하나로, 메뉴당 최근 4개, 전체 24개까지 */
export function mergePriceHistory(prev: PricePoint[] | undefined, next: PricePoint[]): PricePoint[] {
  const all = [...(prev ?? []), ...next].filter((p) => p.item && Number.isFinite(p.price) && p.price >= 1000 && p.price <= 200000);
  const seen = new Set<string>();
  const uniq: PricePoint[] = [];
  for (const p of all) {
    const key = `${normalizeItem(p.item)}|${p.price}|${p.date ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  uniq.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const perItem = new Map<string, number>();
  return uniq
    .filter((p) => {
      const k = normalizeItem(p.item);
      const c = perItem.get(k) ?? 0;
      perItem.set(k, c + 1);
      return c < 4;
    })
    .slice(0, 24);
}

export function normalizeItem(s: string): string {
  return s.replace(/\s|\(.*?\)|[·,.]/g, "").replace(/(정식|세트)$/, "");
}

/** 같은 메뉴의 가장 최근 가격이 14일 넘게 앞선 기록과 다르면 가격 변동으로 본다 */
export function computePriceChange(history: PricePoint[] | undefined): Place["priceChange"] {
  if (!history?.length) return null;
  const byItem = new Map<string, PricePoint[]>();
  for (const p of history) {
    if (!p.date) continue;
    const k = normalizeItem(p.item);
    byItem.set(k, [...(byItem.get(k) ?? []), p]);
  }
  let best: NonNullable<Place["priceChange"]> | null = null;
  for (const list of byItem.values()) {
    const sorted = [...list].sort((a, b) => b.date!.localeCompare(a.date!));
    const latest = sorted[0]!;
    const older = sorted.find((p) => daysBetween(p.date!, latest.date!) >= 14 && p.price !== latest.price);
    if (!older) continue;
    if (!best || (latest.date ?? "") > (best.date ?? "")) {
      best = { item: latest.item, from: older.price, to: latest.price, date: latest.date };
    }
  }
  return best;
}

export const HOURS_SOURCE_LABEL: Record<HoursInfo["source"], string> = {
  google: "Google 지도",
  web: "웹 조사",
  blog: "블로그",
};

/** 블로그 영업시간이 이보다 오래된 글에서 나왔으면 '바뀌었을 수 있음' */
export const HOURS_STALE_DAYS = 365;

const GOOGLE_WEEKDAYS = ["월요일", "화요일", "수요일", "목요일", "금요일"];

/** Google 요일별 영업시간 문장("월요일: 오전 11:00~오후 9:00")을 HoursInfo 로 */
export function hoursFromGoogle(g: GoogleInfo | null | undefined): HoursInfo | null {
  const lines = g?.hoursText;
  if (!g || !lines?.length) return null;
  const closed = lines.filter((l) => /휴무|closed/i.test(l)).map((l) => l.slice(0, 1));
  const line = lines.find((l) => GOOGLE_WEEKDAYS.some((d) => l.startsWith(d)) && !/휴무|closed/i.test(l));
  if (!line) return null;
  const body = line.replace(/^[^:]+:\s*/, "");
  const parsed = /24시간/.test(body)
    ? { open: "00:00", close: "24:00", breakStart: null, breakEnd: null, lastOrder: null, closedDays: null }
    : parseHoursText(body.replace(/,\s*/g, " / "));
  if (!parsed) return null;
  return {
    ...parsed,
    closedDays: closed.length ? parseClosedDays(`${closed.join(",")} 휴무`) : null,
    text: line,
    source: "google",
    date: g.checkedAt,
    link: g.mapsUrl,
    checkedAt: g.checkedAt,
  };
}

/** 웹 조사에서 찾은 영업시간 문장을 HoursInfo 로 */
export function hoursFromWeb(w: Place["web"]): HoursInfo | null {
  if (!w?.hours) return null;
  const text = [w.hours, w.breakTime ? `브레이크타임 ${w.breakTime}` : "", w.lastOrder ? `라스트오더 ${w.lastOrder}` : ""].join(" ");
  const parsed = parseHoursText(text);
  if (!parsed) return null;
  const closedDays = w.closedDays ? (parseClosedDays(/휴무|무휴/.test(w.closedDays) ? w.closedDays : `${w.closedDays} 휴무`) ?? null) : parsed.closedDays;
  return {
    ...parsed,
    closedDays,
    text: text.trim(),
    source: "web",
    date: w.checkedAt,
    link: w.sources[0]?.url ?? null,
    checkedAt: w.checkedAt,
  };
}

/** 영업시간 출처를 고른다: Google > 웹 조사 > 블로그 */
export function resolveHours(place: Pick<Place, "google" | "web" | "hours">, _today?: string): HoursInfo | null {
  const g = hoursFromGoogle(place.google);
  if (g) return g;
  const w = hoursFromWeb(place.web);
  if (w) return w;
  return place.hours?.source === "blog" ? place.hours : null;
}

/** 이름 · 분류로 보이는 배달 · 포장 전문점 */
export const DELIVERY_NAME_RE = /배달\s*전문|배달\s*전용|배달점|배달만|딜리버리|delivery|공유\s*주방|배민\s*키친|고스트\s*키친|포장\s*전문|테이크\s*아웃\s*전문|\(배달\)/i;

/** 매장에서 먹을 수 없는 배달 · 포장 전문점인가 */
export function isDeliveryOnly(place: Pick<Place, "name" | "categoryPath" | "ai" | "web" | "google">): boolean {
  if (DELIVERY_NAME_RE.test(`${place.name} ${place.categoryPath}`)) return true;
  if (place.google?.dineIn === false && place.google?.delivery) return true;
  if (place.web?.dineIn === "no") return true;
  return place.ai?.dineIn === "no" && place.web?.dineIn !== "yes" && place.google?.dineIn !== true;
}

export function computeLunch(
  place: Pick<Place, "category"> & { google: GoogleInfo | null; ai: Place["ai"]; web?: Place["web"]; hours?: Place["hours"] },
  today = new Date().toISOString().slice(0, 10),
): { status: LunchStatus; reason: string } {
  const g = place.google;
  const closure = closureOf({ ai: place.ai, web: place.web ?? null }, today);
  if (closure?.state === "closed") return { status: "closed", reason: closure.note || "폐업 단서가 있어요" };
  if (closure?.state === "temporarily_closed") return { status: "closed", reason: closure.note || "휴업 중이라는 글이 있어요" };
  if (g?.businessStatus === "CLOSED_TEMPORARILY") return { status: "closed", reason: "임시 휴업 (Google)" };
  if (g?.openAtLunch === true) return { status: "open", reason: "영업시간 확인됨 (Google)" };
  if (g?.openAtLunch === false) return { status: "unlikely", reason: "평일 점심엔 문을 닫아요 (Google 영업시간)" };
  const h = place.hours;
  if (h) {
    const at = hoursOpenAtLunch(h);
    const from = HOURS_SOURCE_LABEL[h.source];
    const stale = h.source === "blog" && (!h.date || daysBetween(h.date, today) > HOURS_STALE_DAYS);
    if (at === true) return { status: stale ? "likely" : "open", reason: `${from} 영업시간 기준${stale ? " (오래된 글)" : ""}` };
    if (at === false) return { status: "unlikely", reason: `${formatHours(h)} (${from})` };
  }
  if (place.ai?.lunch === "yes") return { status: "likely", reason: place.ai.lunchNote || "리뷰상 점심 영업" };
  if (place.ai?.lunch === "no") return { status: "unlikely", reason: place.ai.lunchNote || "리뷰상 저녁 위주" };
  if (place.web?.lunch === "yes") return { status: "likely", reason: place.web.hours ? `영업시간 ${place.web.hours} (웹)` : "웹 검색상 점심 영업" };
  if (place.web?.lunch === "no") return { status: "unlikely", reason: place.web.hours ? `영업시간 ${place.web.hours} (웹)` : "웹 검색상 저녁 영업" };
  if (place.category === "pub") return { status: "unlikely", reason: "주점이라 저녁 영업 위주일 수 있어요" };
  return { status: "unknown", reason: "영업시간 미확인 (일반 음식점)" };
}

export const LUNCH_LABEL: Record<LunchStatus, string> = {
  open: "점심 영업",
  likely: "점심 영업 추정",
  unknown: "영업시간 미확인",
  unlikely: "점심 영업 안 할 수 있음",
  closed: "영업 안 함",
};

export function isLunchFriendly(status: LunchStatus): boolean {
  return status === "open" || status === "likely" || status === "unknown";
}

export const REVIEW_SOURCE_LABEL = {
  naverBlog: "네이버 블로그",
  naverCafe: "네이버 카페",
  daumBlog: "티스토리·다음",
  daumCafe: "다음 카페",
} as const;
export type ReviewSourceKey = keyof typeof REVIEW_SOURCE_LABEL;

/** 리뷰 수: 네이버 블로그 + 카페 + 다음. 이름이 흔해 셀 수 없으면 null */
export function reviewCounts(
  p: Pick<Place, "naver" | "extraReviews">,
): { total: number; parts: Array<{ key: ReviewSourceKey; label: string; count: number }> } | null {
  if (!p.naver || p.naver.ambiguous) return null;
  const parts: Array<{ key: ReviewSourceKey; label: string; count: number }> = [
    { key: "naverBlog", label: REVIEW_SOURCE_LABEL.naverBlog, count: p.naver.blogTotal },
  ];
  for (const key of ["naverCafe", "daumBlog", "daumCafe"] as const) {
    const s = p.extraReviews?.[key];
    if (s && s.total > 0) parts.push({ key, label: REVIEW_SOURCE_LABEL[key], count: s.total });
  }
  return { total: parts.reduce((n, x) => n + x.count, 0), parts };
}

/** 여러 갈래의 리뷰 글을 한 줄로: 출처 이름을 붙여 날짜 최신순 (날짜 없는 카페글은 뒤로) */
export function reviewPosts(p: Pick<Place, "naver" | "extraReviews">): Array<{ title: string; link: string; date: string | null; source: ReviewSourceKey }> {
  const out: Array<{ title: string; link: string; date: string | null; source: ReviewSourceKey }> = [];
  for (const post of p.naver?.posts ?? []) out.push({ ...post, source: "naverBlog" });
  for (const key of ["naverCafe", "daumBlog", "daumCafe"] as const) {
    for (const post of p.extraReviews?.[key]?.posts ?? []) if (!out.some((o) => o.link === post.link)) out.push({ ...post, source: key });
  }
  return out;
}
