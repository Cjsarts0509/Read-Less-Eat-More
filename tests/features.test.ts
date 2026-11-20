import { describe, expect, it } from "vitest";
import { toKmaGrid, weatherMood } from "../shared/kma";
import { adRatioOf, closureOf, computeLunch, computePriceChange, mergePriceHistory } from "../shared/insights";
import { estimateLunchTime } from "../shared/time";
import type { Place, PricePoint } from "../shared/types";
import { extractJson, toWebInfo } from "../pipeline/sources/websearch";

describe("기상청 격자 변환", () => {
  // Supabase env_store_geo 에 이미 저장된 지점 격자와 같은지
  it.each([
    [37.571, 126.9778, 60, 127], // 광화문
    [37.5036, 127.0245, 61, 125], // 강남
    [35.1566, 129.0593, 98, 75], // 부산
    [35.8694, 128.595, 89, 90], // 대구
    [36.8195, 127.1563, 63, 111], // 천안
    [35.1515, 126.851, 58, 74], // 광주상무
  ])("(%f, %f) → (%i, %i)", (lat, lng, nx, ny) => {
    expect(toKmaGrid(lat, lng)).toEqual({ nx, ny });
  });

  it("날씨 분위기", () => {
    expect(weatherMood({ tmin: 2, tmax: 8, sky: 4, pty: 1, pop: 80 })).toBe("rain");
    expect(weatherMood({ tmin: -5, tmax: 1, sky: 1, pty: 0, pop: 0 })).toBe("cold");
    expect(weatherMood({ tmin: 24, tmax: 32, sky: 1, pty: 0, pop: 10 })).toBe("hot");
    expect(weatherMood({ tmin: -3, tmax: 0, sky: 4, pty: 3, pop: 70 })).toBe("snow");
    expect(weatherMood({ tmin: 10, tmax: 18, sky: 3, pty: 0, pop: 20 })).toBe("mild");
  });
});

describe("점심 소요 시간", () => {
  it("왕복 도보 + 식사 + 웨이팅", () => {
    const t = estimateLunchTime({
      walkMin: 6,
      category: "korean",
      ai: { pace: "fast", waiting: { level: "short", bestTime: null, note: null } } as Place["ai"],
    });
    expect(t).toEqual({ walk: 12, mode: "walk", meal: 20, wait: 10, total: 42 });
  });

  it("차량 모드는 왕복 차 시간으로", () => {
    const t = estimateLunchTime({ walkMin: 40, distance: 3000, category: "korean", ai: null }, "drive");
    // 3km × 1.4 ÷ 366.7m/분 ≈ 11.45 → 11분 + 출발 · 주차 4분 = 15분, 왕복 30분
    expect(t.walk).toBe(30);
    expect(t.mode).toBe("drive");
  });

  it("정보가 없으면 분류 기본값", () => {
    expect(estimateLunchTime({ walkMin: 5, category: "western", ai: null }).total).toBe(10 + 45 + 5);
  });
});

describe("가격 변동", () => {
  const h: PricePoint[] = [
    { item: "순대국", price: 10000, date: "2026-11-10", source: "blog" },
    { item: "순대국 ", price: 9000, date: "2026-08-01", source: "blog" },
    { item: "순대국", price: 10000, date: "2026-11-10", source: "blog" }, // 중복
    { item: "수육", price: 500, date: "2026-11-10", source: "blog" }, // 말이 안 되는 값
  ];

  it("중복과 이상한 값은 빼고 합친다", () => {
    const merged = mergePriceHistory(undefined, h);
    expect(merged).toHaveLength(2);
  });

  it("14일 넘게 앞선 기록과 다르면 변동", () => {
    expect(computePriceChange(mergePriceHistory(undefined, h))).toEqual({ item: "순대국", from: 9000, to: 10000, date: "2026-11-10" });
  });

  it("가까운 날짜끼리는 변동으로 보지 않는다", () => {
    expect(
      computePriceChange([
        { item: "라멘", price: 11000, date: "2026-11-10", source: "blog" },
        { item: "라멘", price: 10000, date: "2026-11-05", source: "blog" },
      ]),
    ).toBeNull();
  });
});

describe("폐업 · 광고성 리뷰", () => {
  const ai = (closure: NonNullable<Place["ai"]>["closure"]) => ({ closure }) as Place["ai"];

  it("최근 폐업 단서는 점심 영업을 '휴업'으로", () => {
    const p = { category: "korean" as const, google: null, ai: ai({ state: "closed", note: "폐업 공지", evidenceDate: "2026-11-01" }), web: null };
    expect(closureOf(p, "2026-11-20")?.state).toBe("closed");
    expect(computeLunch(p, "2026-11-20").status).toBe("closed");
  });

  it("1년 넘은 폐업 단서는 무시", () => {
    const p = { ai: ai({ state: "closed", note: null, evidenceDate: "2025-01-01" }), web: null };
    expect(closureOf(p, "2026-11-20")).toBeNull();
  });

  it("AI 판정이 없으면 키워드 추정으로 광고 비율", () => {
    const naver = { blogTotal: 30, sponsoredHint: 6, recentPosts: 0, latestPostDate: null, posts: [{ title: "", link: "", date: null }], query: "", checkedAt: "" };
    expect(adRatioOf({ ai: null, naver })).toBe(0.6);
    expect(adRatioOf({ ai: { adRatio: 0.2 } as Place["ai"], naver })).toBe(0.2);
  });
});

describe("웹 검색 응답 읽기", () => {
  it("```json 블록을 꺼내 정리한다", () => {
    const text = `찾아봤어요.\n\`\`\`json\n{"found": true, "summary": "10월 개업한 국수집", "openedOn": "2026-10", "hours": "11:00-20:00", "lunch": "yes", "closure": "open", "menus": ["잔치국수", "비빔국수", "만두", "김밥"]}\n\`\`\``;
    const info = toWebInfo(extractJson(text), [{ title: "출처", url: "https://example.com" }], "2026-11-20");
    expect(info).toMatchObject({ openedOn: "2026-10", lunch: "yes", closure: "open", menus: ["잔치국수", "비빔국수", "만두"] });
  });

  it("못 찾았거나 깨진 JSON 이면 null", () => {
    expect(toWebInfo(extractJson('{"found": false, "lunch": "unknown", "closure": "unknown", "menus": []}'), [], "2026-11-20")).toBeNull();
    expect(toWebInfo(extractJson("JSON 없음"), [], "2026-11-20")).toBeNull();
  });

  it("모르는 값은 unknown 으로", () => {
    const info = toWebInfo({ found: true, summary: "x", lunch: "maybe", closure: "??", menus: [] }, [], "2026-11-20");
    expect(info?.lunch).toBe("unknown");
    expect(info?.closure).toBe("unknown");
  });
});
