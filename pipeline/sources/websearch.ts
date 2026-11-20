/**
 * 웹 검색 보강 — 블로그 글이 거의 없는 새 가게를 Claude 웹 검색 도구로 찾아본다.
 * (개업 시기 · 영업시간 · 폐업/이전 · 대표 메뉴)
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
  lunch: z.enum(["yes", "no", "unknown"]).catch("unknown"),
  closure: z.enum(["open", "closed", "moved", "temporarily_closed", "unknown"]).catch("unknown"),
  menus: z.array(z.string()).catch([]),
});

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

export function toWebInfo(raw: unknown, sources: WebInfo["sources"], today: string): WebInfo | null {
  const parsed = FindingSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.found) return null;
  const d = parsed.data;
  return {
    summary: clip(d.summary, 60),
    openedOn: d.openedOn && /^\d{4}-\d{2}(-\d{2})?$/.test(d.openedOn) ? d.openedOn : null,
    hours: clip(d.hours, 40),
    lunch: d.lunch,
    closure: d.closure,
    menus: d.menus.map((m) => clip(m, 20)!).filter(Boolean).slice(0, 3),
    sources: sources.slice(0, 3),
    checkedAt: today,
  };
}

const PROMPT = (p: Place, today: string) => `오늘은 ${today} 입니다. 아래 식당의 최근 정보를 웹에서 찾아 주세요.

이름: ${p.name}
주소: ${p.address}
분류: ${p.categoryPath}

찾을 것: 개업 시기, 영업시간(평일 점심 포함 여부), 폐업 · 이전 · 휴업 여부, 대표 메뉴, 한 줄 소개.
주소가 다른 같은 이름의 가게와 헷갈리지 마세요. 찾지 못한 항목은 null 로 두고 지어내지 마세요.

마지막에 아래 형식의 JSON 코드 블록 하나로만 답하세요.
\`\`\`json
{"found": true, "summary": "40자 이내 소개 또는 null", "openedOn": "YYYY-MM 또는 YYYY-MM-DD 또는 null", "hours": "11:00-21:00 처럼 또는 null", "lunch": "yes|no|unknown", "closure": "open|closed|moved|temporarily_closed|unknown", "menus": ["대표 메뉴 최대 3개"]}
\`\`\`
가게 정보를 전혀 찾지 못했으면 {"found": false, "lunch": "unknown", "closure": "unknown", "menus": []} 로 답하세요.`;

export function createWebSearcher(opts: { apiKey?: string; model?: string; maxUses?: number } = {}) {
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
            type: "web_search_20260209",
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
    for (const block of res.content) {
      if (block.type !== "text") continue;
      text += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location" && !sources.some((s) => s.url === c.url)) {
          sources.push({ title: clip(c.title ?? c.url, 60) ?? c.url, url: c.url });
        }
      }
    }
    return toWebInfo(extractJson(text), sources, today);
  };
}
