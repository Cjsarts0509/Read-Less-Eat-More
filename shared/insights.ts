import type { Badge, BadgeType, ClosureState, GoogleInfo, LunchStatus, Place, PricePoint } from "./types";

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

export function computeLunch(
  place: Pick<Place, "category"> & { google: GoogleInfo | null; ai: Place["ai"]; web?: Place["web"] },
  today = new Date().toISOString().slice(0, 10),
): { status: LunchStatus; reason: string } {
  const g = place.google;
  const closure = closureOf({ ai: place.ai, web: place.web ?? null }, today);
  if (closure?.state === "closed") return { status: "closed", reason: closure.note || "폐업 단서가 있어요" };
  if (closure?.state === "temporarily_closed") return { status: "closed", reason: closure.note || "휴업 중이라는 글이 있어요" };
  if (g?.businessStatus === "CLOSED_TEMPORARILY") return { status: "closed", reason: "임시 휴업 (Google)" };
  if (g?.openAtLunch === true) return { status: "open", reason: "영업시간 확인됨 (Google)" };
  if (g?.openAtLunch === false) return { status: "unlikely", reason: "평일 점심엔 문을 닫아요 (Google 영업시간)" };
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
