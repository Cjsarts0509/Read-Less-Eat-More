import { afterEach, describe, expect, it, vi } from "vitest";
import type { Place } from "../shared/types";
import { describeCandidate } from "../worker/candidates";
import { cleanPrefs, defaultDeadline, newRoomCode } from "../worker/rooms";
import { ruleLine } from "../worker/weather";
import { handlePlaceLive } from "../worker/live";
import type { Env } from "../worker/env";

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

describe("상세 화면 실시간 확인", () => {
  afterEach(() => vi.unstubAllGlobals());

  const place = { id: "123", name: "삼정모밀 상암점", address: "서울 마포구 월드컵북로54길 25", categoryPath: "일식" };
  const env = (over: Partial<Env> = {}): Env =>
    ({
      ASSETS: {
        fetch: async () =>
          new Response(JSON.stringify({ branch: "HO1", places: [place] }), { headers: { "content-type": "application/json" } }),
      },
      ANTHROPIC_API_KEY: "k",
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_x",
      LIVE_LOOKUP_DAILY: "2",
      ...over,
    }) as unknown as Env;

  /** Supabase REST 흉내: 가게 줄 · 오늘 확인 수 · 저장 기록 */
  function supabase(row: unknown | null, todayCount: number) {
    const writes: Array<{ status: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(...(JSON.parse(String(init.body)) as Array<{ status: string }>));
        return new Response(null, { status: 201 });
      }
      if (url.includes("place_id=eq.")) return new Response(JSON.stringify(row ? [row] : []));
      return new Response(JSON.stringify(Array.from({ length: todayCount }, (_, i) => ({ place_id: String(i) }))));
    });
    return writes;
  }
  const req = new Request("https://lunch.example/api/place-live?b=HO1&id=123");

  it("최근 확인 결과가 있으면 다시 찾지 않는다", async () => {
    supabase({ place_id: "123", status: "done", data: { hours: "10:00-16:00", sources: [], checkedAt: "2026-11-20" }, checked_at: new Date().toISOString() }, 0);
    let called = 0;
    const res = await handlePlaceLive(req, env(), async () => (called++, null));
    const body = (await res.json()) as { status: string; hours: { open: string } | null };
    expect(body.status).toBe("cached");
    expect(body.hours?.open).toBe("10:00");
    expect(called).toBe(0);
  });

  it("없으면 AI 웹 검색으로 찾고 저장한다", async () => {
    const writes = supabase(null, 0);
    const res = await handlePlaceLive(req, env(), async (p) => ({
      summary: p.name,
      openedOn: null,
      hours: "11:00-21:00",
      closedDays: "일요일",
      lunch: "yes",
      closure: "open",
      menus: ["판모밀"],
      sources: [],
      checkedAt: "2026-11-20",
    }));
    const body = (await res.json()) as { status: string; hours: { close: string; closedDays: string } };
    expect(body.status).toBe("fresh");
    expect(body.hours).toMatchObject({ close: "21:00", closedDays: "일요일" });
    expect(writes.map((w) => w.status)).toEqual(["pending", "done"]);
  });

  it("오늘 한도를 다 쓰면 찾지 않는다", async () => {
    supabase(null, 2);
    let called = 0;
    const res = await handlePlaceLive(req, env(), async () => (called++, null));
    expect(((await res.json()) as { status: string }).status).toBe("limit");
    expect(called).toBe(0);
  });
});

describe("사내 한줄평", () => {
  it("평균 · 개수 · 최근 글 · 내 평가를 묶고, 다른 사람의 멤버 키는 내보내지 않는다", async () => {
    const { summarize, cleanComment } = await import("../worker/reviews");
    const rows = [
      { place_id: "1", member_key: "me-12345678", nickname: "나", rating: 5, comment: "진함", updated_at: "2026-11-20T03:00:00Z" },
      { place_id: "1", member_key: "you-1234567", nickname: "너", rating: 4, comment: "", updated_at: "2026-11-19T03:00:00Z" },
      { place_id: "2", member_key: "you-1234567", nickname: "너", rating: 2, comment: "짬", updated_at: "2026-11-18T03:00:00Z" },
    ];
    const s = summarize(rows, "me-12345678");
    expect(s["1"]).toMatchObject({ avg: 4.5, count: 2, mine: { rating: 5, comment: "진함" } });
    expect(s["2"]!.mine).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("you-1234567");
    expect(cleanComment("  맛있어요\n https://spam.example  최고 ")).toBe("맛있어요 최고");
  });
});
