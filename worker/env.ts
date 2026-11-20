import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  /** https://<ref>.supabase.co */
  SUPABASE_URL?: string;
  /** Supabase secret key (sb_secret_…) 또는 service_role 키. 브라우저에 절대 내보내지 않는다 */
  SUPABASE_SECRET_KEY?: string;
  /** wrangler.jsonc 의 ratelimits 바인딩 (없으면 제한 없이 동작) */
  AI_LIMITER?: RateLimit;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function todayKst(now = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

export function supportsServerFallback(model: string): boolean {
  return /^claude-(fable-5-[12]|opus-5-5|opus-5|sonnet-5-5)$/.test(model);
}

export function claude(env: Env): { client: Anthropic; model: string; fallback: boolean } {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, "AI 기능이 꺼져 있어요.");
  const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
  return { client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 }), model, fallback: supportsServerFallback(model) };
}

/** IP 마다 분당 호출 수 제한 */
export async function limit(env: Env, request: Request, bucket: string): Promise<void> {
  if (!env.AI_LIMITER) return;
  const ip = request.headers.get("cf-connecting-ip") ?? "anon";
  const { success } = await env.AI_LIMITER.limit({ key: `${bucket}:${ip}` });
  if (!success) throw new HttpError(429, "요청이 너무 많아요. 1분 뒤에 다시 해 주세요.");
}

export async function readJsonBody<T>(request: Request, maxBytes = 64_000): Promise<T> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "요청이 너무 커요.");
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "요청 형식이 올바르지 않아요.");
  }
}

export const BRANCH_RE = /^[0-9A-Za-z-]{1,16}$/;
