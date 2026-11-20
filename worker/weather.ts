/**
 * 날씨 띠지 — 이미 Supabase 에 매일 쌓이는 기상청 단기예보(env_forecast)를 지점 격자로 읽고,
 * Claude 가 서점 말투로 한 줄을 붙인다. 지점 · 날짜마다 3시간 캐시.
 */
import { MOOD_BOOST, PTY_LABEL, SKY_LABEL, toKmaGrid, weatherMood, type DailyForecast, type WeatherMood } from "../shared/kma";
import type { WeatherResponse } from "../shared/api";
import { claude, json, todayKst, type Env } from "./env";
import { getBranch } from "./places";
import { hasSupabase, sbSelect } from "./supabase";

interface ForecastRow extends DailyForecast {
  rain: string | null;
}


export function ruleLine(mood: WeatherMood, f: DailyForecast): string {
  const t = f.tmax !== null ? `최고 ${Math.round(f.tmax)}℃` : "";
  switch (mood) {
    case "rain":
      return `☔ 비 소식${f.pop ? ` ${f.pop}%` : ""} — 가까운 국물 서가부터 펼쳐 둘게요`;
    case "snow":
      return "❄️ 눈 오는 날 — 멀리 가지 말고 뜨끈하게";
    case "cold":
      return `🧣 ${t} — 오늘은 국물 서가부터`;
    case "hot":
      return `☀️ ${t} — 시원한 면 서가를 앞에 꽂았어요`;
    default:
      return `🌤 걷기 좋은 날${t ? ` (${t})` : ""} — 15분 거리 맛집도 다녀올 만해요`;
  }
}

async function aiLine(env: Env, branchLabel: string, f: DailyForecast, mood: WeatherMood): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const { client, model, fallback } = claude(env);
  const res = await client.beta.messages.create({
    model,
    max_tokens: 2000,
    betas: fallback ? ["server-side-fallback-2026-07-01"] : undefined,
    fallbacks: fallback ? "default" : undefined,
    output_config: { effort: "low" },
    system:
      "당신은 서점 직원들의 점심을 챙기는 사서입니다. 오늘 날씨를 보고 점심 메뉴 고르기에 도움이 되는 한 줄을 씁니다. " +
      "이모지 하나로 시작하고 35자 이내, 따옴표 없이 문장만 씁니다. 책 · 서가 · 페이지 같은 서점 말을 가볍게 섞어도 좋습니다.",
    messages: [
      {
        role: "user",
        content: `${branchLabel} 오늘 날씨: 최저 ${f.tmin ?? "?"}℃ · 최고 ${f.tmax ?? "?"}℃ · 하늘 ${SKY_LABEL[f.sky ?? 0] ?? "?"} · 강수 ${PTY_LABEL[f.pty ?? 0] || "없음"} · 강수확률 ${f.pop ?? "?"}% (분위기: ${MOOD_BOOST[mood].label})`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "");
  return text ? text.slice(0, 60) : null;
}

export async function handleWeather(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("branch") ?? "";
  const today = todayKst();
  const cacheKey = new Request(`https://cache.lunch.local/weather/${encodeURIComponent(code)}/${today}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  if (!hasSupabase(env)) return json({ available: false } satisfies WeatherResponse);
  const branch = await getBranch(env, request, code);
  const { nx, ny } = toKmaGrid(branch.lat, branch.lng);
  const rows = await sbSelect<ForecastRow>(
    env,
    "env_forecast",
    `nx=eq.${nx}&ny=eq.${ny}&day=eq.${today}&select=tmin,tmax,sky,pty,pop,rain&limit=1`,
  );
  const f = rows[0];
  if (!f) return json({ available: false } satisfies WeatherResponse);

  const mood = weatherMood(f);
  let line: string | null = null;
  try {
    line = await aiLine(env, branch.label, f, mood);
  } catch (err) {
    console.error("weather line", (err as Error).message);
  }
  const body: WeatherResponse = {
    available: true,
    day: today,
    tmin: f.tmin,
    tmax: f.tmax,
    sky: SKY_LABEL[f.sky ?? 0] ?? "",
    precip: PTY_LABEL[f.pty ?? 0] ?? "",
    pop: f.pop,
    mood,
    line: line ?? ruleLine(mood, f),
    boost: MOOD_BOOST[mood],
  };
  const res = json(body, 200, { "cache-control": "public, max-age=10800" });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
