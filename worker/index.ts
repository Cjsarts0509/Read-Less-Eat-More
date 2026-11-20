/**
 * Cloudflare Worker
 *  - 정적 파일(화면 + public/data/*.json)은 ASSETS 가 내보낸다.
 *  - /api/config       화면에서 켤 기능 (AI · 저장소)
 *  - /api/weather      지점 날씨 띠지 (기상청 예보 · Supabase env_forecast)
 *  - /api/chat         사서와 대화 (Claude, 여러 턴)
 *  - /api/rooms…       팀 투표방 (Supabase + Claude 중재)
 *  - /api/menu-photo   메뉴판 사진 → 메뉴 · 가격 (Claude 비전 + Supabase)
 *  - /api/menus        지점별 제보된 메뉴판
 *  - /api/place-live   상세 화면 실시간 확인 (영업시간 · 메뉴, AI 웹 검색 + Supabase 캐시)
 *  - /api/reviews      사내 한줄평 · 별점
 */
import Anthropic from "@anthropic-ai/sdk";
import { handleChat } from "./chat";
import { HttpError, json, todayKst, type Env } from "./env";
import { handlePlaceLive } from "./live";
import { handleReviews } from "./reviews";
import { handleMenuPhoto, handleMenus } from "./menus";
import { handleRooms } from "./rooms";
import { hasSupabase } from "./supabase";
import { handleWeather } from "./weather";

export type { Env } from "./env";
export { describeCandidate } from "./candidates";

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const [, name, ...rest] = parts;
  const method = request.method;

  switch (name) {
    case "health":
      return json({ ok: true, today: todayKst() });
    case "config":
      return json({ ai: Boolean(env.ANTHROPIC_API_KEY), store: hasSupabase(env) });
    case "weather":
      return handleWeather(request, env, ctx);
    case "chat":
      if (method !== "POST") throw new HttpError(405, "POST 로 보내 주세요.");
      return handleChat(request, env);
    case "rooms":
      return handleRooms(request, env, rest);
    case "menu-photo":
      if (method !== "POST") throw new HttpError(405, "POST 로 보내 주세요.");
      return handleMenuPhoto(request, env);
    case "menus":
      return handleMenus(request, env);
    case "place-live":
      return handlePlaceLive(request, env);
    case "reviews":
      return handleReviews(request, env);
    default:
      throw new HttpError(404, "not found");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof Anthropic.RateLimitError) return json({ error: "AI 가 바빠요. 잠시 후 다시 시도해 주세요." }, 429);
      if (err instanceof Anthropic.APIError) {
        console.error("Claude API error", err.status, err.message);
        return json({ error: "AI 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);
      }
      console.error(err);
      return json({ error: "서버 오류가 났어요." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
