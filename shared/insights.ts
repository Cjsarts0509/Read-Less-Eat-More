import type { Badge, BadgeType, GoogleInfo, LunchStatus, Place } from "./types";

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

export function computeLunch(
  place: Pick<Place, "category"> & { google: GoogleInfo | null; ai: Place["ai"] },
): { status: LunchStatus; reason: string } {
  const g = place.google;
  if (g?.businessStatus === "CLOSED_TEMPORARILY") return { status: "closed", reason: "임시 휴업 (Google)" };
  if (g?.openAtLunch === true) return { status: "open", reason: "영업시간 확인됨 (Google)" };
  if (g?.openAtLunch === false) return { status: "unlikely", reason: "평일 점심엔 문을 닫아요 (Google 영업시간)" };
  if (place.ai?.lunch === "yes") return { status: "likely", reason: place.ai.lunchNote || "리뷰상 점심 영업" };
  if (place.ai?.lunch === "no") return { status: "unlikely", reason: place.ai.lunchNote || "리뷰상 저녁 위주" };
  if (place.category === "pub") return { status: "unlikely", reason: "주점이라 저녁 영업 위주일 수 있어요" };
  return { status: "unknown", reason: "영업시간 미확인 (일반 음식점)" };
}

export const LUNCH_LABEL: Record<LunchStatus, string> = {
  open: "점심 영업",
  likely: "점심 영업 추정",
  unknown: "영업시간 미확인",
  unlikely: "점심 영업 안 할 수 있음",
  closed: "휴업",
};

export function isLunchFriendly(status: LunchStatus): boolean {
  return status === "open" || status === "likely" || status === "unknown";
}
