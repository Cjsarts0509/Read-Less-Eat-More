/**
 * Claude API — 블로그 최신 글을 읽고 신규 오픈 · 이벤트 · 시즌 메뉴 · 점심 정보를 구조화한다.
 * 식당 여러 곳을 한 요청에 묶어 보내고, 구조화 출력(zod 스키마)으로 받는다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Badge, BadgeType } from "../../shared/types";

export const DEFAULT_MODEL = "claude-opus-5-5";

const BADGE_TYPES = ["new_open", "event", "discount", "seasonal_menu", "new_menu", "lunch_special"] as const;

const PlaceInsightSchema = z.object({
  id: z.string(),
  bookTitle: z.string(),
  summary: z.string(),
  signatureMenus: z.array(z.string()),
  priceHint: z.string().nullable(),
  lunch: z.enum(["yes", "no", "unknown"]),
  lunchNote: z.string().nullable(),
  tags: z.array(z.string()),
  badges: z.array(
    z.object({
      type: z.enum(BADGE_TYPES),
      label: z.string(),
      detail: z.string(),
      evidenceDate: z.string().nullable(),
    }),
  ),
  closure: z.object({
    state: z.enum(["open", "closed", "moved", "temporarily_closed", "unknown"]),
    note: z.string().nullable(),
    evidenceDate: z.string().nullable(),
  }),
  waiting: z.object({
    level: z.enum(["none", "short", "long", "unknown"]),
    bestTime: z.string().nullable(),
    note: z.string().nullable(),
  }),
  pace: z.enum(["fast", "normal", "slow", "unknown"]),
  dineIn: z.enum(["yes", "no", "unknown"]),
  sponsoredPosts: z.number().int(),
  prices: z.array(z.object({ item: z.string(), price: z.number().int(), date: z.string().nullable() })),
});

export const InsightBatchSchema = z.object({ places: z.array(PlaceInsightSchema) });
export type PlaceInsight = z.infer<typeof PlaceInsightSchema>;

export const SYSTEM_PROMPT = `당신은 회사 근처 점심 식당 정보를 정리하는 편집자입니다.
식당마다 네이버 블로그 최신 글(최대 10개)의 날짜·제목·요약이 주어집니다. 이 글들만 근거로, 직장인이 점심 식당을 고를 때 도움이 되는 정보를 한국어로 정리하세요.

규칙
- 글에 없는 내용은 지어내지 않습니다. 근거가 없으면 빈 배열, null, "unknown" 으로 둡니다.
- 이름만 같은 다른 지점·다른 동네 가게의 글이나 가게와 무관한 글은 무시합니다.
- 체험단·협찬 글의 과장된 표현은 걸러서 씁니다.
- 입력에 있는 모든 식당 id 마다 결과를 정확히 하나씩 냅니다.

필드
- bookTitle: 이 가게를 서점의 책 제목처럼 재치 있게 패러디한 제목 (15자 이내, 가게 이름은 넣지 않음. 예: "맑은 뚝배기의 고독", "돈카츠 미학 개론", "짬뽕의 뜨거운 서사").
- summary: 가게를 한 줄로 소개 (40자 이내, 존댓말 아닌 명사형 문장. 예: "진한 사골 국물의 수육국밥집").
- signatureMenus: 대표 메뉴 최대 3개. 글에 나온 메뉴를 먼저 쓰고, 글에 없으면 가게 이름 · 분류로 분명한 메뉴를 씁니다 (예: 「등촌샤브칼국수」→ 샤브샤브, 칼국수). 짐작조차 어려우면 빈 배열.
- priceHint: 점심 1인 가격대가 보이면 "9천원대", "1만~1.5만원" 처럼. 없으면 null.
- lunch: 점심 영업이 글로 확인되면 "yes" (점심 방문 후기, 점심 특선, 런치 메뉴, 점심이 포함된 영업시간), 저녁에만 연다는 근거가 있으면 "no", 모르면 "unknown".
- lunchNote: 점심에 유용한 한 줄 (예: "11:30 오픈, 12시엔 웨이팅", "브레이크타임 15~17시"). 없으면 null.
- tags: 점심 고를 때 유용한 짧은 태그 최대 4개 (예: 혼밥, 단체석, 빠른 회전, 웨이팅, 조용함, 가성비, 매운맛, 포장).
- badges: 아래 유형 중 근거가 있는 것만 넣습니다. evidenceDate 는 근거가 된 글의 날짜(YYYY-MM-DD)입니다.
  - new_open: 기준일로부터 90일 안의 글에서 새로 문을 열었다고(오픈, 신규 오픈, 가오픈, 그랜드 오픈, 이전 오픈) 한 경우.
  - event: 45일 안의 글에서 진행 중인 이벤트·행사 (리뷰 이벤트, 오픈 기념 행사, 사은품 등).
  - discount: 45일 안의 글에서 할인·가격 행사.
  - seasonal_menu: 75일 안의 글에서 계절·기간 한정 메뉴 (예: 굴국밥 개시, 콩국수 시작, 딸기 시즌).
  - new_menu: 60일 안의 글에서 새로 나온 메뉴.
  - lunch_special: 점심 특선·런치 세트가 있다는 내용 (기간 제한 없음).
  - label 은 12자 이내 (예: "11월 오픈", "굴국밥 개시", "런치 9,900원"), detail 은 40자 이내의 근거 요약.
- closure: 폐업 · 이전 · 휴업 단서. 「폐업했어요」「문 닫았」「이전했습니다」「휴업」「임시 휴무(장기)」 같은 표현이 있으면 closed / moved / temporarily_closed, 최근 글에서 영업 중이면 open, 모르면 unknown. note 는 30자 이내 근거(이전이면 옮긴 곳), evidenceDate 는 근거 글 날짜.
- waiting: 점심 웨이팅. 없거나 바로 앉았다는 글 → none, 10분 안팎 → short, 20분 이상 · 줄이 길다 → long, 모르면 unknown. bestTime 은 "11:50 전" 처럼 추천 도착 시각, note 는 30자 이내.
- pace: 식사 속도 · 회전. 주문 즉시 나오고 빨리 먹는 곳(국밥 · 분식 · 덮밥) → fast, 코스 · 화덕 · 오래 걸리는 곳 → slow, 그 밖 normal, 모르면 unknown.
- dineIn: 매장에서 먹을 수 있는가. 「배달 전문」「배달 전용」「홀 없음」「포장 · 배달만」처럼 매장 식사가 안 된다는 근거가 있거나, 모든 글이 배달 · 포장 주문 후기이고 매장 방문 · 좌석 이야기가 하나도 없으면 "no". 매장 방문 · 좌석 · 웨이팅 이야기가 있으면 "yes". 모르면 "unknown".
- sponsoredPosts: 주어진 글 중 체험단 · 협찬 · 원고료 · 제품 제공처럼 광고성으로 보이는 글의 개수 (0 이상, 글 개수 이하).
- prices: 글에 나온 1인분 메뉴 가격 (예: {"item": "순대국", "price": 10000, "date": "2026-11-02"}). 원 단위 정수, 세트 · 단품 구분이 애매하면 넣지 않음, 최대 5개. date 는 그 글의 날짜.`;

export interface InsightInput {
  id: string;
  name: string;
  categoryPath: string;
  address: string;
  posts: Array<{ date: string | null; title: string; snippet: string }>;
}

export function buildUserPrompt(today: string, places: InsightInput[]): string {
  const blocks = places.map((p, i) => {
    const posts = p.posts.length
      ? p.posts.map((post) => `- ${post.date ?? "날짜없음"} | ${post.title} | ${post.snippet}`).join("\n")
      : "- (글 없음)";
    return `[식당 ${i + 1}] id=${p.id}\n이름: ${p.name}\n분류: ${p.categoryPath}\n주소: ${p.address}\n블로그 글 (최신순):\n${posts}`;
  });
  return `기준일(오늘): ${today}\n\n${blocks.join("\n\n")}`;
}

/** 서버 측 거절 폴백(fallbacks: "default")을 지원하는 모델 */
export function supportsServerFallback(model: string): boolean {
  return /^claude-(fable-5-[12]|opus-5-5|opus-5|sonnet-5-5)$/.test(model);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** 모델 출력을 화면에 맞게 다듬는다 (길이 제한, 날짜 형식, 개수 제한). */
export function sanitizeInsight(raw: PlaceInsight): PlaceInsight {
  const badges: Badge[] = [];
  const seen = new Set<BadgeType>();
  for (const b of raw.badges) {
    if (seen.has(b.type)) continue;
    const evidenceDate = b.evidenceDate && DATE_RE.test(b.evidenceDate) ? b.evidenceDate : null;
    if (!evidenceDate && b.type !== "lunch_special") continue;
    seen.add(b.type);
    badges.push({ type: b.type, label: clip(b.label.trim(), 14), detail: clip(b.detail.trim(), 60), evidenceDate });
  }
  return {
    id: raw.id,
    bookTitle: clip(raw.bookTitle.trim().replace(/^[「『《"']+|[」』》"']+$/g, ""), 24),
    summary: clip(raw.summary.trim(), 60),
    signatureMenus: raw.signatureMenus.map((m) => clip(m.trim(), 20)).filter(Boolean).slice(0, 3),
    priceHint: raw.priceHint ? clip(raw.priceHint.trim(), 20) : null,
    lunch: raw.lunch,
    lunchNote: raw.lunchNote ? clip(raw.lunchNote.trim(), 60) : null,
    tags: raw.tags.map((t) => clip(t.trim(), 10)).filter(Boolean).slice(0, 4),
    badges: badges.slice(0, 4),
    closure: {
      state: raw.closure.state,
      note: raw.closure.note ? clip(raw.closure.note.trim(), 50) : null,
      evidenceDate: raw.closure.evidenceDate && DATE_RE.test(raw.closure.evidenceDate) ? raw.closure.evidenceDate : null,
    },
    waiting: {
      level: raw.waiting.level,
      bestTime: raw.waiting.bestTime ? clip(raw.waiting.bestTime.trim(), 16) : null,
      note: raw.waiting.note ? clip(raw.waiting.note.trim(), 50) : null,
    },
    pace: raw.pace,
    dineIn: raw.dineIn,
    sponsoredPosts: Math.max(0, Math.floor(raw.sponsoredPosts)),
    prices: raw.prices
      .filter((p) => p.item.trim() && Number.isFinite(p.price) && p.price >= 1000 && p.price <= 200000)
      .slice(0, 5)
      .map((p) => ({ item: clip(p.item.trim(), 20), price: Math.round(p.price), date: p.date && DATE_RE.test(p.date) ? p.date : null })),
  };
}

export interface Analyzer {
  model: string;
  analyze(today: string, places: InsightInput[]): Promise<Map<string, PlaceInsight>>;
}

export function createClaudeAnalyzer(
  opts: { apiKey?: string; model?: string; fetch?: typeof globalThis.fetch } = {},
): Analyzer {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 4, fetch: opts.fetch });
  const model = opts.model || DEFAULT_MODEL;
  const fallback = supportsServerFallback(model);

  return {
    model,
    async analyze(today, places) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: fallback ? ["server-side-fallback-2026-07-01"] : undefined,
        fallbacks: fallback ? "default" : undefined,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        output_config: { effort: "low", format: betaZodOutputFormat(InsightBatchSchema) },
        messages: [{ role: "user", content: buildUserPrompt(today, places) }],
      });

      if (response.stop_reason === "refusal") {
        console.warn(`  ⚠️  Claude 가 이 묶음을 거절했습니다 (${response.stop_details?.category ?? "unknown"})`);
        return new Map();
      }
      if (response.stop_reason === "max_tokens") {
        console.warn("  ⚠️  출력이 max_tokens 에서 잘렸습니다 — AI_BATCH_SIZE 를 줄여 보세요");
        return new Map();
      }
      const parsed = response.parsed_output;
      if (!parsed) return new Map();

      const ids = new Set(places.map((p) => p.id));
      const out = new Map<string, PlaceInsight>();
      for (const item of parsed.places) {
        if (ids.has(item.id)) out.set(item.id, sanitizeInsight(item));
      }
      return out;
    },
  };
}
