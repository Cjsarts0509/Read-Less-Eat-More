import { describe, expect, it } from "vitest";
import type { Place } from "../shared/types";
import { describeCandidate } from "../worker/candidates";
import { cleanPrefs, defaultDeadline, newRoomCode } from "../worker/rooms";
import { ruleLine } from "../worker/weather";

describe("투표방", () => {
  it("방 코드는 헷갈리는 글자 없이 6자리", () => {
    for (let i = 0; i < 50; i++) expect(newRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("11:30 전에는 오늘 11:50 마감, 그 뒤엔 30분 뒤", () => {
    const morning = Date.parse("2026-11-20T10:00:00+09:00");
    expect(defaultDeadline(morning)).toBe("2026-11-20T02:50:00.000Z");
    const noon = Date.parse("2026-11-20T12:00:00+09:00");
    expect(defaultDeadline(noon)).toBe(new Date(noon + 30 * 60_000).toISOString());
  });

  it("취향 입력을 정리한다", () => {
    expect(cleanPrefs({ want: " 국물 ", avoid: "x".repeat(100), budget: "999", maxWalk: 7 })).toEqual({
      want: "국물",
      avoid: "x".repeat(60),
      budget: "any",
      maxWalk: 15,
    });
  });
});

describe("Claude 에게 넘기는 후보 설명", () => {
  it("소요 시간 · 웨이팅 · 폐업 · 가격 변동을 담는다", () => {
    const p = {
      id: "1",
      name: "국밥집",
      categoryPath: "한식 > 국밥",
      category: "korean",
      walkMin: 5,
      lunch: "likely",
      naver: null,
      google: null,
      web: null,
      priceChange: { item: "국밥", from: 9000, to: 10000, date: "2026-11-10" },
      ai: {
        summary: "진한 국물",
        signatureMenus: ["국밥"],
        priceHint: null,
        badges: [],
        lunch: "yes",
        lunchNote: null,
        tags: [],
        waiting: { level: "long", bestTime: "11:40 전", note: null },
        pace: "fast",
        closure: { state: "moved", note: "건너편", evidenceDate: "2026-11-01" },
        analyzedAt: "2026-11-01",
        model: "m",
        sourceLatestPost: null,
      },
    } as unknown as Place;
    const line = describeCandidate(p, "2026-11-20");
    expect(line).toContain("왕복+식사 약 55분");
    expect(line).toContain("웨이팅: long (11:40 전)");
    expect(line).toContain("주의: 이전 소식");
    expect(line).toContain("가격 변동: 국밥 9000→10000원");
  });
});

describe("날씨 문구 (AI 없을 때)", () => {
  it("분위기마다 다른 문구", () => {
    expect(ruleLine("rain", { tmin: 3, tmax: 8, sky: 4, pty: 1, pop: 70 })).toContain("비 소식 70%");
    expect(ruleLine("hot", { tmin: 25, tmax: 33, sky: 1, pty: 0, pop: 0 })).toContain("최고 33℃");
  });
});
