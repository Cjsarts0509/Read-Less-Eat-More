import { describe, expect, it } from "vitest";
import type { Branch, BranchPlaces } from "../shared/types";
import { collectBranch, DEFAULT_CONFIG, needsAnalysis, serializeBranchPlaces, toPlace, type Deps } from "../pipeline/core";
import { collectNearby, type KakaoPlace } from "../pipeline/sources/kakao";
import { areaHint, buildQuery, cleanText, toIsoDate } from "../pipeline/sources/naver";
import { sanitizeInsight, supportsServerFallback, type Analyzer, type PlaceInsight } from "../pipeline/sources/claude";
import { normalizeName } from "../pipeline/sources/google";

/** 새로 생긴 분석 필드의 기본값 (테스트용) */
const EXTRA = {
  closure: { state: "open" as const, note: null, evidenceDate: null },
  waiting: { level: "unknown" as const, bestTime: null, note: null },
  pace: "unknown" as const,
  dineIn: "unknown" as const,
  sponsoredPosts: 0,
  prices: [] as Array<{ item: string; price: number; date: string | null }>,
};

const branch: Branch = {
  code: "001",
  name: "광화문",
  label: "광화문점",
  division: "강북사업단",
  region: "서울",
  address: "서울특별시 종로구 종로 1",
  lat: 37.571,
  lng: 126.9778,
};

function kakaoDoc(id: string, name: string, dLat: number, category = "음식점 > 한식 > 국밥"): KakaoPlace {
  return {
    id,
    place_name: name,
    category_name: category,
    category_group_code: "FD6",
    phone: "02-000-0000",
    address_name: "서울 종로구 종로1가 24",
    road_address_name: "서울 종로구 종로 24",
    x: String(branch.lng),
    y: String(branch.lat + dLat),
    place_url: `http://place.map.kakao.com/${id}`,
    distance: "",
  };
}

describe("카카오 수집", () => {
  it("45개를 넘는 영역은 4등분해서 다시 검색하고 중복을 없앤다", async () => {
    const urls: string[] = [];
    let n = 0;
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const rect = new URL(url).searchParams.get("rect")!.split(",").map(Number);
      const isRoot = rect[2]! - rect[0]! > 0.02; // 첫 사각형 (지름 2km)
      const total = isRoot ? 100 : 20;
      const page = Number(new URL(url).searchParams.get("page"));
      const count = Math.min(15, total - (page - 1) * 15);
      const documents = Array.from({ length: count }, () => kakaoDoc(`p${n++ % 50}`, "가게", 0.001));
      return new Response(JSON.stringify({ meta: { total_count: total, pageable_count: Math.min(45, total), is_end: page * 15 >= total }, documents }));
    };
    const places = await collectNearby({ apiKey: "k", center: branch, radius: 1000, fetchImpl });
    // 루트 1번 + 사분면 4곳 × 2쪽
    expect(urls).toHaveLength(1 + 4 * 2);
    expect(urls[0]).toContain("category_group_code=FD6");
    expect(new Set(places.map((p) => p.id)).size).toBe(places.length);
  });
});

describe("네이버 검색어", () => {
  it("동 이름을 붙인다", () => {
    expect(areaHint("서울 종로구 종로1가 24", "")).toBe("종로1가");
    expect(areaHint("서울 강남구 역삼동 823-1", "")).toBe("역삼동");
    expect(areaHint("", "서울 서초구 강남대로 465")).toBe("서초구");
    expect(buildQuery("본죽 광화문점", "서울 종로구 종로1가 24", "")).toBe('"본죽" 종로1가');
  });

  it("HTML 태그와 엔티티를 지운다", () => {
    expect(cleanText("<b>광화문</b> 국밥 &amp; 수육&quot;")).toBe('광화문 국밥 & 수육"');
    expect(toIsoDate("20261118")).toBe("2026-11-18");
    expect(toIsoDate("")).toBeNull();
  });
});

describe("Claude 출력 정리", () => {
  it("길이·개수를 자르고 날짜 없는 배지는 버린다", () => {
    const raw: PlaceInsight = {
      id: "1",
      bookTitle: "『맑은 뚝배기의 고독』",
      summary: "가".repeat(100),
      signatureMenus: ["a", "b", "c", "d"],
      priceHint: null,
      lunch: "yes",
      lunchNote: null,
      tags: ["혼밥", "가성비", "웨이팅", "포장", "단체"],
      badges: [
        { type: "event", label: "리뷰 이벤트", detail: "음료 증정", evidenceDate: "2026-11-10" },
        { type: "event", label: "중복", detail: "", evidenceDate: "2026-11-11" },
        { type: "new_menu", label: "날짜 없음", detail: "", evidenceDate: null },
        { type: "lunch_special", label: "런치 9,900원", detail: "", evidenceDate: null },
      ],
      ...EXTRA,
    };
    const out = sanitizeInsight(raw);
    expect(out.bookTitle).toBe("맑은 뚝배기의 고독");
    expect(out.summary.length).toBeLessThanOrEqual(60);
    expect(out.signatureMenus).toHaveLength(3);
    expect(out.tags).toHaveLength(4);
    expect(out.badges.map((b) => b.label)).toEqual(["리뷰 이벤트", "런치 9,900원"]);
  });

  it("서버 폴백은 지원 모델에서만 켠다", () => {
    expect(supportsServerFallback("claude-opus-5-5")).toBe(true);
    expect(supportsServerFallback("claude-haiku-5-5")).toBe(false);
  });

  it("Google 이름 비교용 정규화", () => {
    expect(normalizeName("본죽 광화문점")).toBe("본죽광화문");
  });
});

describe("collectBranch", () => {
  const today = "2026-11-20";

  function makeDeps(overrides: Partial<Deps> = {}): Deps & { analyzed: string[][] } {
    const analyzed: string[][] = [];
    const analyzer: Analyzer = {
      model: "test-model",
      async analyze(_today, places) {
        analyzed.push(places.map((p) => p.id));
        return new Map(
          places.map((p) => [
            p.id,
            {
              id: p.id,
              bookTitle: "국밥의 고독",
              summary: `${p.name} 요약`,
              signatureMenus: ["국밥"],
              priceHint: "1만원",
              lunch: "yes",
              lunchNote: null,
              tags: ["혼밥"],
              badges: [{ type: "new_open", label: "11월 오픈", detail: "오픈 후기", evidenceDate: "2026-11-15" }],
              ...EXTRA,
              sponsoredPosts: 1,
              prices: [{ item: "국밥", price: 10000, date: "2026-11-15" }],
            } satisfies PlaceInsight,
          ]),
        );
      },
    };
    return {
      analyzed,
      today,
      nowIso: "2026-11-20T00:00:00.000Z",
      kakao: async () => [
        kakaoDoc("a", "가까운 국밥", 0.001),
        kakaoDoc("b", "먼 국밥", 0.02), // 2km 밖
        kakaoDoc("c", "이자카야", 0.002, "음식점 > 술집 > 일본식주점"),
      ],
      naver: async (q) => ({
        total: q.includes("가까운") ? 120 : 5,
        posts: [
          {
            title: `${q.match(/"(.+?)"/)?.[1] ?? q} 그랜드 오픈 후기`,
            link: `https://blog/${q}`,
            date: "2026-11-15",
            snippet: "오픈 기념 이벤트",
          },
        ],
      }),
      google: null,
      analyzer,
      ...overrides,
    };
  }

  it("반경 밖은 빼고, 네이버·AI 정보를 붙이고, 점심 영업을 판정한다", async () => {
    const deps = makeDeps();
    const budget = { naver: 100, google: 0, ai: 100 };
    const { data, stats } = await collectBranch(branch, null, DEFAULT_CONFIG, deps, budget);
    expect(data.places.map((p) => p.id)).toEqual(["a", "c"]);
    const a = data.places[0]!;
    expect(a.naver?.blogTotal).toBe(120);
    expect(a.naver?.query).toBe('"가까운 국밥" 종로1가');
    expect(a.ai?.summary).toBe("가까운 국밥 요약");
    expect(a.ai?.bookTitle).toBe("국밥의 고독");
    expect(a.ai?.adRatio).toBe(1); // 글 1개 중 협찬 1개
    expect(a.priceHistory?.[0]).toMatchObject({ item: "국밥", price: 10000, source: "blog" });
    expect(a.naver?.sponsoredHint).toBe(0);
    expect(a.ai?.sourceLatestPost).toBe("2026-11-15");
    expect(a.lunch).toBe("likely");
    expect(a.firstSeen).toBe(today);
    // 인기순으로 분석
    expect(deps.analyzed[0]).toEqual(["a", "c"]);
    expect(stats.aiAnalyzed).toBe(2);
    expect(budget.ai).toBe(98);
  });

  it("AI 예산이 모자라면 대기로 남기고, 다음 실행에서 우선 처리한다", async () => {
    const deps = makeDeps();
    const first = await collectBranch(branch, null, DEFAULT_CONFIG, deps, { naver: 100, google: 0, ai: 1 });
    const c = first.data.places.find((p) => p.id === "c")!;
    expect(c.aiPending).toBe(true);
    expect(c.ai).toBeNull();

    // 다음 날: 네이버 갱신 주기 전이지만 대기 중이라 다시 조회·분석한다
    const deps2 = makeDeps({ today: "2026-11-21" });
    const second = await collectBranch(branch, first.data, DEFAULT_CONFIG, deps2, { naver: 100, google: 0, ai: 10 });
    expect(deps2.analyzed.flat()).toEqual(["c"]);
    expect(second.data.places.find((p) => p.id === "c")!.aiPending).toBeUndefined();
    // 처음 본 날짜는 유지
    expect(second.data.places.find((p) => p.id === "a")!.firstSeen).toBe(today);
  });

  it("직렬화는 장소 하나당 한 줄이고 다시 읽을 수 있다", async () => {
    const { data } = await collectBranch(branch, null, DEFAULT_CONFIG, makeDeps(), { naver: 100, google: 0, ai: 100 });
    const text = serializeBranchPlaces(data);
    const parsed = JSON.parse(text) as BranchPlaces;
    expect(parsed.places).toHaveLength(2);
    expect(text.split("\n").filter((l) => l.startsWith('{"id"'))).toHaveLength(2);
  });
});

describe("needsAnalysis", () => {
  const place = {
    ai: { analyzedAt: "2026-11-01", sourceLatestPost: "2026-11-01" },
  } as unknown as Parameters<typeof needsAnalysis>[0];

  it("새 글이 없으면 다시 분석하지 않는다", () => {
    expect(needsAnalysis(place, [{ title: "후기", snippet: "", link: "", date: "2026-10-30" }], "2026-11-20")).toBe(false);
  });

  it("새 글에 이벤트·신메뉴 같은 말이 있으면 다시 분석한다", () => {
    expect(needsAnalysis(place, [{ title: "겨울 신메뉴 출시", snippet: "", link: "", date: "2026-11-10" }], "2026-11-20")).toBe(true);
  });

  it("평범한 새 글은 5개 이상 + 30일 지났을 때만", () => {
    const posts = Array.from({ length: 5 }, (_, i) => ({ title: "맛있어요", snippet: "", link: `${i}`, date: "2026-11-10" }));
    expect(needsAnalysis(place, posts.slice(0, 4), "2026-12-05")).toBe(false);
    expect(needsAnalysis(place, posts, "2026-11-20")).toBe(false);
    expect(needsAnalysis(place, posts, "2026-12-05")).toBe(true);
  });
});

describe("createClaudeAnalyzer (가짜 API 응답)", () => {
  it("구조화 출력 요청을 보내고 결과를 id 로 묶는다", async () => {
    const { createClaudeAnalyzer } = await import("../pipeline/sources/claude");
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
      const output = {
        places: [
          {
            id: "a",
            bookTitle: "뚝배기의 고독",
            summary: "진한 국물의 국밥집",
            signatureMenus: ["국밥"],
            priceHint: "9천원대",
            lunch: "yes",
            lunchNote: null,
            tags: ["혼밥"],
            badges: [{ type: "event", label: "리뷰 이벤트", detail: "음료 증정", evidenceDate: "2026-11-10" }],
            ...EXTRA,
          },
          { id: "zzz", bookTitle: "", summary: "입력에 없던 id", signatureMenus: [], priceHint: null, lunch: "unknown", lunchNote: null, tags: [], badges: [], ...EXTRA },
        ],
      };
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(output) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const analyzer = createClaudeAnalyzer({ apiKey: "test-key", fetch: fakeFetch });
    const out = await analyzer.analyze("2026-11-20", [
      { id: "a", name: "국밥집", categoryPath: "한식 > 국밥", address: "서울", posts: [{ date: "2026-11-10", title: "후기", snippet: "맛있다" }] },
    ]);

    expect(analyzer.model).toBe("claude-opus-5-5");
    expect([...out.keys()]).toEqual(["a"]);
    expect(out.get("a")?.badges[0]?.label).toBe("리뷰 이벤트");
    expect(sent!.url).toContain("/v1/messages");
    expect(sent!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(sent!.body.fallbacks).toBe("default");
    const oc = sent!.body.output_config as { effort: string; format: { type: string } };
    expect(oc.effort).toBe("low");
    expect(oc.format.type).toBe("json_schema");
    expect(String((sent!.body.messages as Array<{ content: string }>)[0]!.content)).toContain("기준일(오늘): 2026-11-20");
  });
});

describe("카카오 주소 검색 (본사 등 대략 좌표 보정)", () => {
  it("쉼표 뒤 건물 이름은 떼고 찾는다", async () => {
    const { geocodeAddress } = await import("../pipeline/sources/kakao");
    let asked = "";
    const fetchImpl = async (url: string) => {
      asked = new URL(url).searchParams.get("query") ?? "";
      return new Response(JSON.stringify({ documents: [{ address_name: "서울 마포구 상암동", x: "126.889", y: "37.578" }] }));
    };
    const geo = await geocodeAddress("k", "서울특별시 마포구 월드컵북로54길 25, 상암DMC푸르지오시티(S-City)", fetchImpl);
    expect(asked).toBe("서울특별시 마포구 월드컵북로54길 25");
    expect(geo).toEqual({ lat: 37.578, lng: 126.889 });
  });

  it("결과가 없으면 null", async () => {
    const { geocodeAddress } = await import("../pipeline/sources/kakao");
    const fetchImpl = async () => new Response(JSON.stringify({ documents: [] }));
    expect(await geocodeAddress("k", "없는 주소", fetchImpl)).toBeNull();
  });
});

describe("웹 검색 대상", () => {
  it("네이버 조회가 실패한 곳은 웹 검색하지 않는다", async () => {
    const searched: string[] = [];
    const deps: Deps = {
      today: "2026-11-20",
      nowIso: "2026-11-20T00:00:00.000Z",
      kakao: async () => [kakaoDoc("a", "새로 연 집", 0.001), kakaoDoc("b", "키 오류 난 집", 0.002)],
      naver: async (q) => {
        if (q.includes("키 오류")) throw new Error("HTTP 401");
        return { total: 1, posts: [] };
      },
      google: null,
      analyzer: null,
      web: async (p) => {
        searched.push(p.id);
        return null;
      },
    };
    await collectBranch(branch, null, DEFAULT_CONFIG, deps, { naver: 10, google: 0, ai: 0, web: 10 });
    expect(searched).toEqual(["a"]);
  });
});

describe("네이버 검색 API (NAVER API HUB 이전)", () => {
  it("새 주소 · 새 헤더를 먼저 쓰고, 되면 그 방식을 기억한다", async () => {
    const { searchBlog, resetNaverMode } = await import("../pipeline/sources/naver");
    resetNaverMode();
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(
        JSON.stringify({ total: 42, items: [{ title: "<b>국밥</b> 후기", link: "https://blog/1", description: "맛있다", bloggername: "a", postdate: "20261118" }] }),
      );
    };
    const res = await searchBlog("국밥 상암동", { clientId: "id", clientSecret: "secret" }, fetchImpl);
    expect(res.total).toBe(42);
    expect(res.posts[0]).toMatchObject({ title: "국밥 후기", date: "2026-11-18" });
    expect(calls[0]!.url).toContain("https://naverapihub.apigw.ntruss.com/search/v1/blog?");
    expect(calls[0]!.url).toContain("format=json");
    expect(calls[0]!.headers).toEqual({ "X-NCP-APIGW-API-KEY-ID": "id", "X-NCP-APIGW-API-KEY": "secret" });
  });

  it("새 방식이 인증 실패면 예전 방식으로 한 번 더", async () => {
    const { searchBlog, resetNaverMode } = await import("../pipeline/sources/naver");
    resetNaverMode();
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes("ntruss")) return new Response('{"error":"auth"}', { status: 401 });
      return new Response(JSON.stringify({ total: 3, items: [] }));
    };
    const res = await searchBlog("q", { clientId: "id", clientSecret: "s" }, fetchImpl);
    expect(res.total).toBe(3);
    expect(urls[1]).toContain("https://openapi.naver.com/v1/search/blog.json");
    // 다음 호출부터는 예전 방식만
    await searchBlog("q2", { clientId: "id", clientSecret: "s" }, fetchImpl);
    expect(urls).toHaveLength(3);
    resetNaverMode();
  });

  it("total 이 없는 응답이면 받은 글 수", async () => {
    const { parseBlogResponse } = await import("../pipeline/sources/naver");
    expect(parseBlogResponse({ items: [{ title: "a", link: "l", description: "", bloggername: "", postdate: "20261101" }] }).total).toBe(1);
  });
});

describe("블로그 글 관련성 (흔한 이름의 부풀려진 검색 수 거르기)", () => {
  it("지점 접미사를 떼고 따옴표로 묶는다", async () => {
    const { blogQuery, coreName } = await import("../pipeline/sources/naver");
    expect(coreName("냉면쟁이고기꾼 서울마포상암점")).toBe("냉면쟁이고기꾼");
    expect(coreName("한")).toBe("한");
    expect(blogQuery("죽이요 상암동점", "서울 마포구 상암동 1600", "").query).toBe('"죽이요" 상암동');
  });

  it("두 글자 이하 이름은 동네 이름도 함께 나와야 관련 글", async () => {
    const { blogQuery, isRelevantPost } = await import("../pipeline/sources/naver");
    const q = blogQuery("오늘", "서울 마포구 상암동 1600", "");
    expect(isRelevantPost({ title: "오늘 날씨 좋다", snippet: "산책" }, q)).toBe(false);
    expect(isRelevantPost({ title: "상암동 점심 오늘 후기", snippet: "" }, q)).toBe(true);
    const q2 = blogQuery("백채김치찌개 상암점", "서울 마포구 상암동 1600", "");
    expect(isRelevantPost({ title: "백채 김치찌개 점심", snippet: "" }, q2)).toBe(true);
    expect(isRelevantPost({ title: "김치찌개 맛집", snippet: "" }, q2)).toBe(false);
  });

  it("정확도순 상위 글에 무관한 글이 섞이면 관련 글 수만 세고, 무관한 글은 AI 에 넘기지 않는다", async () => {
    const seenByAi: number[] = [];
    const deps: Deps = {
      today: "2026-11-20",
      nowIso: "2026-11-20T00:00:00.000Z",
      kakao: async () => [kakaoDoc("x", "오늘의식탁", 0.001)],
      naver: async () => ({
        total: 300000,
        posts: [
          { title: "오늘의 식단 일기", link: "1", date: "2026-11-19", snippet: "일상" },
          { title: "종로1가 오늘의식탁 점심", link: "2", date: "2026-11-18", snippet: "백반" },
        ],
      }),
      google: null,
      analyzer: {
        model: "m",
        async analyze(_t, places) {
          seenByAi.push(places[0]!.posts.length);
          return new Map();
        },
      },
    };
    const { data } = await collectBranch(branch, null, DEFAULT_CONFIG, deps, { naver: 10, google: 0, ai: 10 });
    const n = data.places[0]!.naver!;
    expect(n.rawTotal).toBe(300000);
    expect(n.relevance).toBe(0.5);
    expect(n.blogTotal).toBe(1);
    expect(seenByAi).toEqual([1]);
  });

  it("정확도순 상위 글이 거의 다 관련 글이면(인기 가게) 전체 검색 수에 비율을 곱해 어림한다", async () => {
    const posts = Array.from({ length: 100 }, (_, i) => ({
      title: `종로1가 오늘의식탁 후기 ${i}`,
      link: String(i),
      date: "2026-11-01",
      snippet: "",
    }));
    const opts: Array<{ sort?: string; display?: number } | undefined> = [];
    const deps: Deps = {
      today: "2026-11-20",
      nowIso: "",
      kakao: async () => [kakaoDoc("x", "오늘의식탁", 0.001)],
      naver: async (q, o) => {
        if (!q.includes("영업시간")) opts.push(o);
        return { total: 5000, posts };
      },
      google: null,
      analyzer: null,
    };
    const { data } = await collectBranch(branch, null, DEFAULT_CONFIG, deps, { naver: 10, google: 0, ai: 0 });
    expect(data.places[0]!.naver!.blogTotal).toBe(5000);
    expect(opts[0]).toEqual({ sort: "sim", display: 100 });
  });

  it("리뷰로 보여 줄 글은 제목에 가게 이름이 있는 글을 먼저 고른다", async () => {
    const deps: Deps = {
      today: "2026-11-20",
      nowIso: "",
      kakao: async () => [kakaoDoc("x", "삼정모밀 상암점", 0.001)],
      naver: async () => ({
        total: 3,
        posts: [
          { title: "송파 목공방 세이로무시 납품기", link: "a", date: "2026-11-07", snippet: "삼정모밀에 납품한 밥통" },
          { title: "상암동 점심 삼정모밀 판모밀 후기", link: "b", date: "2026-09-01", snippet: "" },
          { title: "상암 당일치기 코스", link: "c", date: "2026-10-04", snippet: "삼정모밀 들러서" },
        ],
      }),
      google: null,
      analyzer: null,
    };
    const { data } = await collectBranch(branch, null, DEFAULT_CONFIG, deps, { naver: 10, google: 0, ai: 0 });
    expect(data.places[0]!.naver!.posts.map((p) => p.link)).toEqual(["b", "a", "c"]);
  });
});

describe("한두 글자 이름", () => {
  it("검색 수를 믿지 않고, 제목에 이름 + 동네가 함께 있는 글만 센다", async () => {
    const deps: Deps = {
      today: "2026-11-20",
      nowIso: "2026-11-20T00:00:00.000Z",
      kakao: async () => [kakaoDoc("h", "한", 0.001), kakaoDoc("o", "오늘", 0.0015)],
      naver: async (q) => ({
        total: 400000,
        posts: q.includes("오늘")
          ? [
              { title: "종로1가 오늘 점심 후기", link: "1", date: "2026-11-19", snippet: "" },
              { title: "오늘 하루", link: "2", date: "2026-11-18", snippet: "종로1가 산책" },
            ]
          : [{ title: "종로1가 한 바퀴", link: "3", date: "2026-11-19", snippet: "" }],
      }),
      google: null,
      analyzer: null,
    };
    const { data } = await collectBranch(branch, null, DEFAULT_CONFIG, deps, { naver: 10, google: 0, ai: 0 });
    const han = data.places.find((p) => p.id === "h")!.naver!;
    const today = data.places.find((p) => p.id === "o")!.naver!;
    expect(han).toMatchObject({ ambiguous: true, blogTotal: 0, rawTotal: 400000 });
    expect(today).toMatchObject({ ambiguous: true, blogTotal: 1 });
  });
});

describe("AI 대기 중인 곳 다시 조회", () => {
  it("이번 AI 예산의 두 배(최소 20곳)까지만, 인기 순으로 앞당긴다", async () => {
    const docs = Array.from({ length: 30 }, (_, i) => kakaoDoc(`p${i}`, `가게${i}번집`, 0.0001 * (i + 1)));
    const prev: BranchPlaces = {
      branch: "001",
      generatedAt: "",
      radius: 1000,
      sources: [],
      places: docs.map((d, i) => ({
        ...toPlace(d, branch, undefined, "2026-11-19"),
        naver: { blogTotal: i, recentPosts: 0, latestPostDate: null, posts: [], query: "", checkedAt: "2026-11-19", v: 3, relevance: 1 },
        aiPending: true,
      })),
    };
    const asked: string[] = [];
    const deps: Deps = {
      today: "2026-11-20",
      nowIso: "",
      kakao: async () => docs,
      naver: async (q) => {
        if (!q.includes("영업시간")) asked.push(q);
        return { total: 0, posts: [] };
      },
      google: null,
      analyzer: null,
    };
    await collectBranch(branch, prev, DEFAULT_CONFIG, deps, { naver: 100, google: 0, ai: 5 });
    // 예산 5 → 최소 20곳, 블로그 수가 많은(번호가 큰) 가게부터
    expect(asked).toHaveLength(20);
    expect(asked).toContain('"가게29번집" 종로1가');
    expect(asked).not.toContain('"가게0번집" 종로1가');
  });
});

describe("네이버 검색 글 수 제한", () => {
  it("100개를 거절하면 10개로 낮춰 다시 묻는다", async () => {
    const { searchBlog, resetNaverMode } = await import("../pipeline/sources/naver");
    resetNaverMode("hub");
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(new URL(url).searchParams.get("display")!);
      if (asked.length === 1) return new Response("bad display", { status: 400 });
      return new Response(JSON.stringify({ total: 1, items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const res = await searchBlog("q", { clientId: "a", clientSecret: "b" }, fetchImpl, { display: 100 });
    expect(res.total).toBe(1);
    expect(asked).toEqual(["100", "10"]);
    resetNaverMode();
  });
});

describe("차량 모드 수집", () => {
  it("도보 반경 밖 「맛집」 검색 결과를 더하고, 최근 본 곳은 남긴다", async () => {
    const near = kakaoDoc("n1", "가까운집", 0.001);
    const far = { ...kakaoDoc("f1", "먼맛집", 0.02), distance: "2000" };
    const prevFar = {
      ...toPlace({ ...kakaoDoc("f0", "어제맛집", 0.025) }, branch, undefined, "2026-11-01"),
      lastSeen: "2026-11-10",
    };
    const old = { ...toPlace(kakaoDoc("f9", "오래전맛집", 0.025), branch, undefined, "2026-09-01"), lastSeen: "2026-09-01" };
    const deps: Deps = {
      today: "2026-11-20",
      nowIso: "",
      kakao: async () => [near],
      kakaoDrive: async () => [near, far],
      naver: null,
      google: null,
      analyzer: null,
    };
    const prev: BranchPlaces = { branch: "001", generatedAt: "", radius: 1000, sources: [], places: [prevFar, old] };
    const { data } = await collectBranch(branch, prev, DEFAULT_CONFIG, deps, { naver: 0, google: 0, ai: 0 });
    expect(data.places.map((p) => p.id)).toEqual(["n1", "f1", "f0"]);
    expect(data.places.find((p) => p.id === "f1")!.lastSeen).toBe("2026-11-20");
  });
});
