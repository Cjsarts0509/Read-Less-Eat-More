/**
 * AI 웹 조사 — Claude 웹 검색 도구로 가게 정보를 확인한다.
 * (영업시간 · 브레이크 · 휴무 · 매장 식사 여부 · 대표 메뉴와 가격 · 좌석 · 네이버 지도 가게 번호 · 개업 시기 · 폐업/이전)
 * 다이닝코드 · 네이버 플레이스 · 카카오맵 · 식신 같은 맛집 정보 페이지를 우선 참고한다.
 *
 * 웹 검색 결과에는 인용이 붙어 구조화 출력과 함께 쓰기 어려워, 마지막에 JSON 코드 블록으로
 * 답하게 하고 zod 로 검증한다. 인용된 주소는 출처로 남긴다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Place, WebInfo } from "../../shared/types";
import { DEFAULT_MODEL, supportsServerFallback } from "./claude";

const FindingSchema = z.object({
  found: z.boolean(),
  summary: z.string().nullable().optional(),
  openedOn: z.string().nullable().optional(),
  hours: z.string().nullable().optional(),
  breakTime: z.string().nullable().optional().catch(null),
  lastOrder: z.string().nullable().optional().catch(null),
  closedDays: z.string().nullable().optional().catch(null),
  lunch: z.enum(["yes", "no", "unknown"]).catch("unknown"),
  closure: z.enum(["open", "closed", "moved", "temporarily_closed", "unknown"]).catch("unknown"),
  dineIn: z.enum(["yes", "no", "unknown"]).catch("unknown"),
  menus: z.array(z.string()).catch([]),
  menuPrice: z
    .object({ item: z.string(), price: z.coerce.number() })
    .nullable()
    .optional()
    .catch(null),
  seats: z.string().nullable().optional().catch(null),
  naverPlaceUrl: z.string().nullable().optional().catch(null),
});

/** 네이버 지도 가게 주소에서 가게 번호를 뽑는다 */
export function naverPlaceIdFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:m\.place\.naver\.com|pcmap\.place\.naver\.com|place\.naver\.com)\/(?:restaurant|place|cafe|food)\/(\d{5,})|map\.naver\.com\/(?:p|v5)\/(?:entry\/place|search\/[^/?#]+\/place|place)\/(\d{5,})|naver\.me\/.*[?&]id=(\d{5,})/,
  );
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

const clip = (s: string | null | undefined, n: number) => {
  if (!s) return null;
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** 응답 글에서 마지막 JSON 객체를 꺼낸다 (```json 블록 우선) */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!);
  const candidates = fenced.length ? fenced.reverse() : [];
  const start = text.lastIndexOf("{");
  if (start >= 0) {
    // 맨 마지막 { 부터 짝이 맞는 } 까지가 아니라, 첫 { 부터 마지막 } 까지도 시도
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export function toWebInfo(
  raw: unknown,
  sources: WebInfo["sources"],
  today: string,
  opts: { resultUrls?: Array<{ title: string; url: string }>; core?: string } = {},
): WebInfo | null {
  const parsed = FindingSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.found) return null;
  const d = parsed.data;
  // 네이버 가게 번호: 모델이 고른 주소 → 검색 결과 중 제목에 가게 이름이 들어간 네이버 지도 주소
  const squash = (x: string) => x.replace(/\s+/g, "").toLowerCase();
  let naverPlaceId = naverPlaceIdFrom(d.naverPlaceUrl);
  if (!naverPlaceId && opts.core) {
    const hit = (opts.resultUrls ?? []).find((r) => naverPlaceIdFrom(r.url) && squash(r.title).includes(squash(opts.core!)));
    naverPlaceId = hit ? naverPlaceIdFrom(hit.url) : null;
  }
  const price = d.menuPrice && d.menuPrice.item.trim() && d.menuPrice.price >= 1000 && d.menuPrice.price <= 200000 ? d.menuPrice : null;
  return {
    summary: clip(d.summary, 60),
    openedOn: d.openedOn && /^\d{4}-\d{2}(-\d{2})?$/.test(d.openedOn) ? d.openedOn : null,
    hours: clip(d.hours, 40),
    breakTime: clip(d.breakTime, 30),
    lastOrder: clip(d.lastOrder, 20),
    closedDays: clip(d.closedDays, 30),
    lunch: d.lunch,
    closure: d.closure,
    dineIn: d.dineIn,
    menus: d.menus.map((m) => clip(m, 20)!).filter(Boolean).slice(0, 3),
    menuPrice: price ? { item: clip(price.item, 20)!, price: Math.round(price.price) } : null,
    seats: clip(d.seats, 50),
    naverPlaceId,
    sources: sources.slice(0, 3),
    checkedAt: today,
  };
}

const PROMPT = (p: Place, today: string) => `오늘은 ${today} 입니다. 직장인 점심 추천에 쓸 수 있게 아래 식당의 정보를 웹에서 확인해 주세요.

이름: ${p.name}
주소: ${p.address}
분류: ${p.categoryPath}

찾을 것
- 평일 영업시간 · 브레이크타임 · 라스트오더 · 정기 휴무일
- 매장에서 먹을 수 있는지 (배달 · 포장 전문점이면 "no")
- 대표 메뉴와 그 1인분 가격, 좌석 · 단체석 안내
- 네이버 지도 가게 주소 (m.place.naver.com/restaurant/숫자 또는 map.naver.com/p/entry/place/숫자 형태)
- 폐업 · 이전 · 휴업 여부, 개업 시기, 한 줄 소개

방법: 「가게 이름 + 동네」로 검색하고, 다이닝코드 · 네이버 플레이스 · 카카오맵 · 식신 · 캐치테이블 같은 맛집 정보 페이지와 최근 방문 후기를 우선 참고하세요.
주소가 다른 같은 이름의 가게(다른 지점)와 헷갈리지 마세요. 확인하지 못한 항목은 null 로 두고 지어내지 마세요.

마지막에 아래 형식의 JSON 코드 블록 하나로만 답하세요.
\`\`\`json
{"found": true,
 "hours": "평일 영업시간 11:00-21:00 형식 또는 null",
 "breakTime": "15:00-17:00 형식 또는 null",
 "lastOrder": "20:30 형식 또는 null",
 "closedDays": "일요일 · 토·일요일 · 연중무휴 처럼 또는 null",
 "lunch": "yes|no|unknown",
 "dineIn": "yes|no|unknown",
 "menus": ["대표 메뉴 최대 3개"],
 "menuPrice": {"item": "대표 메뉴", "price": 9000} 또는 null,
 "seats": "좌석 · 단체석 안내 30자 이내 또는 null",
 "naverPlaceUrl": "찾은 네이버 지도 가게 주소 또는 null",
 "closure": "open|closed|moved|temporarily_closed|unknown",
 "openedOn": "YYYY-MM 또는 YYYY-MM-DD 또는 null",
 "summary": "40자 이내 소개 또는 null"}
\`\`\`
가게 정보를 전혀 찾지 못했으면 {"found": false, "lunch": "unknown", "closure": "unknown", "dineIn": "unknown", "menus": []} 로 답하세요.`;

/** 웹 검색 도구 버전: 동적 필터링 버전(20260209)을 지원하지 않는 모델은 기본 버전 */
export function webSearchToolType(model: string): "web_search_20260209" | "web_search_20250305" {
  return /^claude-(fable|mythos|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)/.test(model) ? "web_search_20260209" : "web_search_20250305";
}

export function createWebSearcher(opts: { apiKey?: string; model?: string; maxUses?: number; fast?: boolean } = {}) {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 });
  const model = opts.model || DEFAULT_MODEL;
  const fallback = supportsServerFallback(model);

  return async function search(place: Place, today: string, city?: string): Promise<WebInfo | null> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: PROMPT(place, today) }];
    let res: Anthropic.Beta.BetaMessage | null = null;
    for (let turn = 0; turn < 3; turn++) {
      res = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: fallback ? ["server-side-fallback-2026-07-01"] : undefined,
        fallbacks: fallback ? "default" : undefined,
        output_config: { effort: "low" },
        tools: [
          {
            // fast: 결과를 코드로 거르는 단계(동적 필터링)를 건너뛰는 기본 검색 도구 — 화면에서 기다리는 실시간 확인용
            type: opts.fast ? "web_search_20250305" : webSearchToolType(model),
            name: "web_search",
            max_uses: opts.maxUses ?? 4,
            user_location: { type: "approximate", country: "KR", timezone: "Asia/Seoul", ...(city ? { city } : {}) },
          },
        ],
        messages,
      });
      // 서버 쪽 검색 반복이 길어지면 pause_turn 으로 멈춘다 → 그대로 이어서 보낸다
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    if (!res || res.stop_reason === "refusal") return null;

    let text = "";
    const sources: WebInfo["sources"] = [];
    // 인용이 없으면 검색 결과 상위 주소라도 출처로 남긴다
    const results: WebInfo["sources"] = [];
    for (const block of res.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.type === "web_search_result" && !results.some((s) => s.url === r.url)) {
            results.push({ title: clip(r.title ?? r.url, 60) ?? r.url, url: r.url });
          }
        }
      }
      if (block.type !== "text") continue;
      text += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location" && !sources.some((s) => s.url === c.url)) {
          sources.push({ title: clip(c.title ?? c.url, 60) ?? c.url, url: c.url });
        }
      }
    }
    const core = place.name.trim().split(/\s+/).filter((t, i, all) => !(i === all.length - 1 && all.length > 1 && /(점|지점|본점|호점)$/.test(t))).join(" ");
    return toWebInfo(extractJson(text), sources.length ? sources : results, today, { resultUrls: results, core });
  };
}
