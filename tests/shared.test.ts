import { describe, expect, it } from "vitest";
import { categorize } from "../shared/categories";
import { boundingRect, haversine, radiusForWalk, rectIntersectsCircle, splitRect, walkMinutes } from "../shared/geo";
import { activeBadges, computeLunch, isNewlyListed, isOpenDuring, openAtWeekdayLunch } from "../shared/insights";

describe("categorize", () => {
  it.each([
    ["음식점 > 한식 > 해장국", "korean"],
    ["음식점 > 중식 > 중국요리", "chinese"],
    ["음식점 > 일식 > 초밥,롤", "japanese"],
    ["음식점 > 양식 > 이탈리안", "western"],
    ["음식점 > 양식 > 햄버거", "fastfood"],
    ["음식점 > 아시아음식 > 베트남음식", "asian"],
    ["음식점 > 분식", "snack"],
    ["음식점 > 패스트푸드 > 맥도날드", "fastfood"],
    ["음식점 > 치킨 > 교촌치킨", "fastfood"],
    ["음식점 > 샐러드", "healthy"],
    ["음식점 > 간식 > 제과,베이커리", "dessert"],
    ["음식점 > 술집 > 호프,요리주점", "pub"],
    ["음식점 > 술집 > 와인바", "pub"],
    ["음식점 > 뷔페", "etc"],
    ["카페 > 커피전문점", "dessert"],
  ])("%s → %s", (input, key) => {
    expect(categorize(input).key).toBe(key);
  });

  it("경로에서 '음식점' 접두어를 뺀다", () => {
    expect(categorize("음식점 > 한식 > 국밥").path).toBe("한식 > 국밥");
  });
});

describe("geo", () => {
  const gwanghwamun = { lat: 37.571, lng: 126.9778 };

  it("haversine 은 대략 맞는 거리를 준다", () => {
    // 위도 0.009도 ≈ 1km
    const d = haversine(gwanghwamun, { lat: gwanghwamun.lat + 0.009, lng: gwanghwamun.lng });
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it("도보 시간과 반경은 서로 맞물린다", () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(560)).toBe(10);
    expect(walkMinutes(radiusForWalk(10))).toBe(10);
  });

  it("경계 사각형 4등분과 원 교차 판정", () => {
    const rect = boundingRect(gwanghwamun, 1000);
    expect(rectIntersectsCircle(rect, gwanghwamun, 1000)).toBe(true);
    const quads = splitRect(rect);
    expect(quads).toHaveLength(4);
    for (const q of quads) expect(rectIntersectsCircle(q, gwanghwamun, 1000)).toBe(true);
    // 두 번 더 쪼개면 맨 모서리 칸(중심에서 가장 가까운 점이 약 1.06km)은 원 밖
    const corner = splitRect(splitRect(quads[0]!)[0]!)[0]!;
    expect(rectIntersectsCircle(corner, gwanghwamun, 1000)).toBe(false);
  });
});

describe("영업시간", () => {
  const weekday = (day: number, oh: number, ch: number) => ({
    open: { day, hour: oh, minute: 0 },
    close: { day, hour: ch, minute: 0 },
  });

  it("평일 11~21시 영업이면 점심 영업", () => {
    const periods = [1, 2, 3, 4, 5].map((d) => weekday(d, 11, 21));
    expect(openAtWeekdayLunch(periods)).toBe(true);
  });

  it("평일 17시 오픈이면 점심 영업 아님", () => {
    const periods = [1, 2, 3, 4, 5, 6].map((d) => weekday(d, 17, 23));
    expect(openAtWeekdayLunch(periods)).toBe(false);
  });

  it("24시간 영업 (close 없음)", () => {
    expect(openAtWeekdayLunch([{ open: { day: 0, hour: 0, minute: 0 } }])).toBe(true);
  });

  it("자정을 넘기는 구간", () => {
    // 금 18시 ~ 토 02시: 토요일 01시는 영업, 금요일 12시는 아님
    const p = [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }];
    expect(isOpenDuring(p, 6, 60, 90)).toBe(true);
    expect(isOpenDuring(p, 5, 720, 780)).toBe(false);
  });

  it("토요일 밤 → 일요일 새벽처럼 주를 넘기는 구간", () => {
    const p = [{ open: { day: 6, hour: 20, minute: 0 }, close: { day: 0, hour: 3, minute: 0 } }];
    expect(isOpenDuring(p, 0, 60, 120)).toBe(true);
  });

  it("정보 없으면 null", () => {
    expect(openAtWeekdayLunch(undefined)).toBeNull();
  });
});

describe("computeLunch", () => {
  const base = { category: "korean" as const, google: null, ai: null };

  it("Google 영업시간이 가장 우선", () => {
    const google = { rating: 4.2, ratingCount: 10, openAtLunch: false, hoursText: null, mapsUrl: null, businessStatus: "OPERATIONAL", checkedAt: "2026-11-01" };
    expect(computeLunch({ ...base, google }).status).toBe("unlikely");
  });

  it("주점은 기본적으로 점심 영업 안 함으로 본다", () => {
    expect(computeLunch({ ...base, category: "pub" }).status).toBe("unlikely");
  });

  it("주점이라도 리뷰에서 점심 영업이 보이면 추정 영업", () => {
    const ai = {
      summary: "",
      signatureMenus: [],
      priceHint: null,
      badges: [],
      lunch: "yes" as const,
      lunchNote: "점심 특선 있음",
      tags: [],
      analyzedAt: "2026-11-01",
      model: "m",
      sourceLatestPost: null,
    };
    expect(computeLunch({ ...base, category: "pub", ai })).toEqual({ status: "likely", reason: "점심 특선 있음" });
  });

  it("정보가 없으면 미확인", () => {
    expect(computeLunch(base).status).toBe("unknown");
  });
});

describe("배지 만료", () => {
  it("이벤트는 45일 지나면 숨긴다", () => {
    const badges = [
      { type: "event" as const, label: "리뷰 이벤트", detail: "", evidenceDate: "2026-10-10" },
      { type: "event" as const, label: "오래된 이벤트", detail: "", evidenceDate: "2026-09-01" },
      { type: "lunch_special" as const, label: "런치", detail: "", evidenceDate: null },
    ];
    const labels = activeBadges(badges, "2026-11-20").map((b) => b.label);
    expect(labels).toEqual(["리뷰 이벤트", "런치"]);
  });

  it("지도 신규 등록은 기준일 이후 60일 안", () => {
    expect(isNewlyListed({ firstSeen: "2026-11-10" }, "2026-11-01", "2026-11-20")).toBe(true);
    expect(isNewlyListed({ firstSeen: "2026-11-01" }, "2026-11-01", "2026-11-20")).toBe(false);
    expect(isNewlyListed({ firstSeen: "2026-08-01" }, "2026-07-01", "2026-11-20")).toBe(false);
    expect(isNewlyListed({ firstSeen: "2026-11-10" }, null, "2026-11-20")).toBe(false);
  });
});
