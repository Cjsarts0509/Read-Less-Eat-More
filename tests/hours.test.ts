import { describe, expect, it } from "vitest";
import { formatHours, hoursOpenAtLunch, parseClosedDays, parseHoursText, pickHours } from "../shared/hours";
import { computeLunch, hoursFromGoogle, hoursFromWeb, isDeliveryOnly, resolveHours } from "../shared/insights";
import type { GoogleInfo, HoursInfo, Place, WebInfo } from "../shared/types";
import { hoursQuery, rankReviewPosts } from "../pipeline/sources/naver";
import { naverPlaceIdFrom, toWebInfo, webSearchToolType } from "../pipeline/sources/websearch";
import { naverMapUrl } from "../src/lib/links";

describe("영업시간 글 읽기", () => {
  it.each([
    ["영업시간 : 매일 11:00 - 21:30 브레이크타임 15:00~17:00 라스트오더 20:30 매주 일요일 휴무", "11:00–21:30 · 브레이크 15:00–17:00 · L.O 20:30 · 일요일 휴무"],
    ["평일 11시~9시 / 주말 12시~8시 연중무휴", "11:00–21:00 · 연중무휴"],
    ["오전 11시 반 ~ 오후 9시까지 영업해요. 토, 일 휴무", "11:30–21:00 · 토·일요일 휴무"],
    ["점심 11:30~14:00 / 저녁 17:00~22:00 일요일 정기휴무", "11:30–22:00 · 브레이크 14:00–17:00 · 일요일 휴무"],
    ["영업시간 17:00 - 02:00 (L.O 01:00) 월요일 휴무", "17:00–익일 02:00 · L.O 익일 01:00 · 월요일 휴무"],
    ["운영시간 10:00-16:00 주말 휴무", "10:00–16:00 · 토·일요일 휴무"],
    ["휴무일: 매주 월요일, 화요일 영업시간 11:30-21:00", "11:30–21:00 · 월·화요일 휴무"],
  ])("%s", (text, expected) => {
    const h = parseHoursText(text);
    expect(h).not.toBeNull();
    expect(formatHours(h!)).toBe(expected);
  });

  it("시각이 아닌 숫자 범위(인분 · 인원)는 영업시간으로 읽지 않는다", () => {
    expect(parseHoursText("1-2인분 기준 9,000원, 3~4명이 가면 좋아요")).toBeNull();
  });

  it("'월요일' 의 '일' 을 일요일로 읽지 않고, 임시 휴무는 정기 휴무가 아니다", () => {
    expect(parseClosedDays("매주 월요일 휴무")).toBe("월요일");
    expect(parseClosedDays("임시 휴무 공지")).toBeNull();
    expect(parseClosedDays("연중무휴")).toBe("연중무휴");
  });

  it("평일 12~13시 영업 판정", () => {
    const base = { breakStart: null, breakEnd: null, closedDays: null };
    expect(hoursOpenAtLunch({ ...base, open: "11:00", close: "21:00" })).toBe(true);
    expect(hoursOpenAtLunch({ ...base, open: "17:00", close: "26:00" })).toBe(false);
    expect(hoursOpenAtLunch({ ...base, open: "07:00", close: "11:30" })).toBe(false);
    expect(hoursOpenAtLunch({ open: "11:00", close: "21:00", breakStart: "11:30", breakEnd: "13:30", closedDays: null })).toBe(false);
    expect(hoursOpenAtLunch({ ...base, open: "11:00", close: "21:00", closedDays: "월·화·수·목·금요일" })).toBe(false);
    expect(hoursOpenAtLunch({ ...base, open: "12:20", close: "21:00" })).toBeNull();
  });

  it("여러 글 중 같은 시각을 말한 글이 많은 쪽을, 그다음 최신 글을 고른다", () => {
    const h = pickHours([
      { title: "삼정모밀", snippet: "영업시간 10:00-16:00", date: "2026-03-01", link: "a" },
      { title: "삼정모밀 후기", snippet: "영업시간 11:00-15:00 일요일 휴무", date: "2026-10-01", link: "b" },
      { title: "삼정모밀 점심", snippet: "운영시간 10:00~16:00 브레이크 없음 토요일 휴무", date: "2026-09-01", link: "c" },
    ]);
    expect(h?.open).toBe("10:00");
    expect(h?.close).toBe("16:00");
    expect(h?.link).toBe("c");
    expect(h?.closedDays).toBe("토요일");
  });
});

const hours = (over: Partial<HoursInfo> = {}): HoursInfo => ({
  open: "11:00",
  close: "21:00",
  breakStart: null,
  breakEnd: null,
  lastOrder: null,
  closedDays: null,
  text: "",
  source: "blog",
  date: "2026-10-01",
  link: null,
  checkedAt: "2026-11-20",
  ...over,
});

const web = (over: Partial<WebInfo> = {}): WebInfo => ({
  summary: null,
  openedOn: null,
  hours: null,
  lunch: "unknown",
  closure: "unknown",
  menus: [],
  sources: [],
  checkedAt: "2026-11-20",
  ...over,
});

describe("영업시간 출처 고르기 · 점심 판정", () => {
  it("Google > 웹 조사 > 블로그 순으로 믿는다", () => {
    const google: GoogleInfo = {
      rating: null,
      ratingCount: null,
      openAtLunch: true,
      hoursText: ["월요일: 오전 11:00~오후 9:00", "화요일: 오전 11:00~오후 9:00", "일요일: 휴무일"],
      mapsUrl: null,
      businessStatus: "OPERATIONAL",
      checkedAt: "2026-11-20",
    };
    expect(hoursFromGoogle(google)).toMatchObject({ open: "11:00", close: "21:00", closedDays: "일요일", source: "google" });
    expect(resolveHours({ google, web: web({ hours: "10:00-16:00" }), hours: hours() })?.source).toBe("google");
    expect(resolveHours({ google: null, web: web({ hours: "10:00-16:00", closedDays: "일요일" }), hours: hours() })).toMatchObject({
      source: "web",
      open: "10:00",
      close: "16:00",
      closedDays: "일요일",
    });
    expect(hoursFromWeb(web({ hours: "10:00-21:00", breakTime: "15:00-17:00" }))).toMatchObject({ breakStart: "15:00", breakEnd: "17:00" });
    expect(resolveHours({ google: null, web: null, hours: hours() })?.source).toBe("blog");
  });

  it("영업시간으로 점심 영업을 판정하고, 오래된 블로그 글이면 '추정'으로 낮춘다", () => {
    const base = { category: "korean" as const, google: null, ai: null, web: null };
    expect(computeLunch({ ...base, hours: hours() }, "2026-11-20").status).toBe("open");
    expect(computeLunch({ ...base, hours: hours({ date: "2024-01-01" }) }, "2026-11-20").status).toBe("likely");
    expect(computeLunch({ ...base, hours: hours({ open: "17:00", close: "24:00" }) }, "2026-11-20")).toMatchObject({
      status: "unlikely",
      reason: "17:00–24:00 (블로그)",
    });
  });
});

describe("배달 · 포장 전문점", () => {
  const p = (over: Partial<Place>) =>
    ({ name: "가게", categoryPath: "한식", ai: null, web: null, google: null, ...over }) as Pick<
      Place,
      "name" | "categoryPath" | "ai" | "web" | "google"
    >;
  it("이름 · AI · 웹 조사 · Google 로 판단한다", () => {
    expect(isDeliveryOnly(p({ name: "떡볶이 배달전문점 상암점" }))).toBe(true);
    expect(isDeliveryOnly(p({ name: "족발야시장 (배달)" }))).toBe(true);
    expect(isDeliveryOnly(p({ name: "옥이포차", categoryPath: "술집 > 실내포장마차" }))).toBe(false);
    expect(isDeliveryOnly(p({ web: web({ dineIn: "no" }) }))).toBe(true);
    expect(isDeliveryOnly(p({ ai: { dineIn: "no" } as Place["ai"] }))).toBe(true);
    expect(isDeliveryOnly(p({ ai: { dineIn: "no" } as Place["ai"], web: web({ dineIn: "yes" }) }))).toBe(false);
  });
});

describe("네이버 지도 · 블로그 검색어", () => {
  it("지도 검색은 가게 이름 그대로 (구 이름을 붙이지 않는다), 가게 번호를 알면 바로 연결", () => {
    expect(naverMapUrl({ name: "삼정모밀 상암점" })).toBe(`https://map.naver.com/p/search/${encodeURIComponent("삼정모밀 상암점")}`);
    expect(naverMapUrl({ name: "삼정모밀 상암점", web: web({ naverPlaceId: "1234567" }) })).toBe("https://map.naver.com/p/entry/place/1234567");
  });

  it("영업시간 검색어", () => {
    expect(hoursQuery({ core: "삼정모밀", hint: "상암동" })).toBe('"삼정모밀" 상암동 영업시간');
  });

  it("리뷰 글은 제목에 가게 이름이 있는 글 먼저, 그 안에서 최신순", () => {
    const ranked = rankReviewPosts(
      [
        { title: "목공방 납품기", date: "2026-11-07" },
        { title: "삼정모밀 판모밀", date: "2026-08-01" },
        { title: "삼정 모밀 후기", date: "2026-09-01" },
      ],
      "삼정모밀",
    );
    expect(ranked.map((r) => r.date)).toEqual(["2026-09-01", "2026-08-01", "2026-11-07"]);
  });
});

describe("AI 웹 조사 결과", () => {
  it("네이버 지도 가게 번호를 여러 주소 형태에서 뽑는다", () => {
    expect(naverPlaceIdFrom("https://m.place.naver.com/restaurant/2063269142/location")).toBe("2063269142");
    expect(naverPlaceIdFrom("https://map.naver.com/p/entry/place/1675859519?c=15")).toBe("1675859519");
    expect(naverPlaceIdFrom("https://pcmap.place.naver.com/restaurant/73603981/home")).toBe("73603981");
    expect(naverPlaceIdFrom("https://www.diningcode.com/profile.php?rid=abc")).toBeNull();
  });

  it("모델이 못 찾았으면 제목에 가게 이름이 있는 검색 결과의 네이버 주소를 쓴다", () => {
    const info = toWebInfo(
      { found: true, hours: "10:00-16:00", closedDays: "일요일", dineIn: "yes", menus: ["판모밀"], menuPrice: { item: "판모밀", price: "9000" } },
      [],
      "2026-11-20",
      {
        core: "삼정모밀",
        resultUrls: [
          { title: "다른 가게 : 네이버", url: "https://m.place.naver.com/restaurant/111111" },
          { title: "삼정모밀 상암점 : 네이버", url: "https://m.place.naver.com/restaurant/222222" },
        ],
      },
    );
    expect(info).toMatchObject({ naverPlaceId: "222222", closedDays: "일요일", dineIn: "yes", menuPrice: { item: "판모밀", price: 9000 } });
  });

  it("모델에 맞는 웹 검색 도구 버전", () => {
    expect(webSearchToolType("claude-opus-5-5")).toBe("web_search_20260209");
    expect(webSearchToolType("claude-sonnet-5-5")).toBe("web_search_20260209");
    expect(webSearchToolType("claude-haiku-5-5")).toBe("web_search_20250305");
  });
});

describe("블로그 낱말로 찾는 새 소식", () => {
  const today = "2026-11-20";
  it("종류마다 가장 최근 글 하나, 기간이 지난 글은 버린다", async () => {
    const { keywordBadges } = await import("../shared/insights");
    const badges = keywordBadges(
      [
        { title: "상암 새로 생긴 국밥집 그랜드 오픈 기념 수육 증정", date: "2026-11-10", link: "a" },
        { title: "굴국밥 개시! 겨울 한정", date: "2026-11-15", link: "b" },
        { title: "직장인 점심 특선 9,900원", date: "2026-06-01", link: "c" },
        { title: "오픈 시간 맞춰 갔어요", date: "2026-11-18", link: "d" },
        { title: "작년 오픈 이벤트", date: "2025-01-01", link: "e" },
      ],
      today,
    );
    const byType = Object.fromEntries(badges.map((b) => [b.type, b]));
    expect(byType.new_open).toMatchObject({ label: "11월 오픈 소식", evidenceDate: "2026-11-10", auto: true, link: "a" });
    expect(byType.event?.link).toBe("a");
    expect(byType.seasonal_menu?.link).toBe("b");
    expect(byType.lunch_special?.link).toBe("c");
    expect(badges.some((b) => b.link === "d" || b.link === "e")).toBe(false);
  });

  it("AI 가 찾은 같은 종류의 소식이 있으면 AI 쪽을 쓴다", async () => {
    const { placeBadges } = await import("../shared/insights");
    const ai = { badges: [{ type: "event" as const, label: "리뷰 이벤트", detail: "", evidenceDate: today }] } as unknown as Place["ai"];
    const auto = [
      { type: "event" as const, label: "이벤트 진행", detail: "", evidenceDate: today, auto: true },
      { type: "new_menu" as const, label: "신메뉴", detail: "", evidenceDate: today, auto: true },
    ];
    expect(placeBadges({ ai, autoBadges: auto }, today).map((b) => b.label)).toEqual(["리뷰 이벤트", "신메뉴"]);
  });
});

describe("점심 1인 가격 어림", () => {
  it("가격대 문구를 숫자로", async () => {
    const { parsePriceHint } = await import("../shared/price");
    expect(parsePriceHint("9천원대")).toBe(9500);
    expect(parsePriceHint("1만~1.5만원")).toBe(12500);
    expect(parsePriceHint("8,000원")).toBe(8000);
    expect(parsePriceHint("1만원대")).toBe(12000);
    expect(parsePriceHint("가성비 좋음")).toBeNull();
  });

  it("메뉴 가격 기록 → 메뉴판 사진 → 가격대 → 웹 조사 순", async () => {
    const { lunchPrice } = await import("../shared/price");
    const today = "2026-11-20";
    const base = { ai: { priceHint: "9천원대" } as Place["ai"], web: null };
    expect(
      lunchPrice(
        {
          ...base,
          priceHistory: [
            { item: "순대국", price: 10000, date: "2026-11-01", source: "blog" },
            { item: "수육", price: 30000, date: "2026-11-01", source: "blog" },
            { item: "순대국", price: 9000, date: "2026-01-01", source: "blog" },
            { item: "공깃밥", price: 1000, date: "2026-11-01", source: "blog" },
          ],
        },
        undefined,
        today,
      ),
    ).toEqual({ price: 10000, source: "menu" });
    expect(lunchPrice({ ...base, priceHistory: [] }, [{ items: [{ price: 8000 }, { price: 9000 }, { price: null }] }], today)).toEqual({
      price: 8000,
      source: "photo",
    });
    expect(lunchPrice({ ...base, priceHistory: [] }, undefined, today)).toEqual({ price: 9500, source: "hint" });
    expect(lunchPrice({ ai: null, web: null, priceHistory: [] }, undefined, today)).toBeNull();
  });

  it("예산 필터는 가격을 아는 곳 중 넘는 곳만 뺀다", async () => {
    const { applyFilters, DEFAULT_FILTERS } = await import("../src/lib/filters");
    const mk = (id: string, hint: string | null) =>
      ({ id, name: id, walkMin: 3, distance: 200, lunch: "open", category: "korean", categoryPath: "", ai: hint ? { priceHint: hint, badges: [] } : null, naver: null }) as unknown as Place;
    const out = applyFilters([mk("싼곳", "8천원대"), mk("비싼곳", "2만원"), mk("모름", null)], { ...DEFAULT_FILTERS, walk: 0, budget: 10000 }, {
      today: "2026-11-20",
      baselineDate: null,
    });
    expect(out.map((p) => p.id)).toEqual(["싼곳", "모름"]);
  });
});

describe("가장 가까운 지점", () => {
  it("직선거리로 고른다", async () => {
    const { nearestBranch } = await import("../shared/geo");
    const branches = [
      { code: "001", lat: 37.571, lng: 126.9778 },
      { code: "HO1", lat: 37.5813, lng: 126.8886 },
    ];
    const near = nearestBranch(branches, { lat: 37.5799, lng: 126.8899 });
    expect(near?.branch.code).toBe("HO1");
    expect(near!.distance).toBeLessThan(300);
  });
});

describe("차량 모드", () => {
  it("도보는 반경 1km 안만, 차량은 차로 N분 안", async () => {
    const { applyFilters, DEFAULT_FILTERS } = await import("../src/lib/filters");
    const mk = (id: string, distance: number) =>
      ({ id, name: id, distance, walkMin: Math.round((distance * 1.25) / 70), lunch: "open", category: "korean", categoryPath: "", ai: null, naver: null }) as unknown as Place;
    const places = [mk("가까움", 300), mk("1.5km", 1500), mk("3.5km", 3500)];
    const ctx = { today: "2026-11-20", baselineDate: null };
    expect(applyFilters(places, { ...DEFAULT_FILTERS, walk: 0 }, ctx).map((p) => p.id)).toEqual(["가까움"]);
    expect(applyFilters(places, { ...DEFAULT_FILTERS, mode: "drive", drive: 15 }, ctx).map((p) => p.id)).toEqual(["가까움", "1.5km"]);
    expect(applyFilters(places, { ...DEFAULT_FILTERS, mode: "drive", drive: 0 }, ctx)).toHaveLength(3);
  });

  it("차로 걸리는 시간과 반경은 서로 맞는다", async () => {
    const { driveMinutes, radiusForDrive } = await import("../shared/geo");
    for (const m of [10, 15, 20]) expect(driveMinutes(radiusForDrive(m))).toBeLessThanOrEqual(m);
  });
});

describe("위치 안내: 브라우저 구분", () => {
  it("카카오톡 · 네이버 앱 · 사파리 · 삼성 인터넷을 구분한다", async () => {
    const { browserEnv } = await import("../src/lib/browser");
    expect(browserEnv("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 KAKAOTALK 10.8.5").inApp).toBe("kakao");
    expect(browserEnv("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) NAVER(inapp; search; 2000; 12.10.1)")).toMatchObject({ inApp: "naver", ios: true });
    expect(browserEnv("Mozilla/5.0 (Linux; Android 14) SamsungBrowser/27.0 Chrome/125 Mobile")).toMatchObject({ inApp: null, samsung: true });
    expect(browserEnv("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1")).toMatchObject({ inApp: null, ios: true });
  });
});
