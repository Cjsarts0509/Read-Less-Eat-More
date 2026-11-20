/**
 * /api/balance — 오늘의 밸런스 게임. 질문은 날짜로 정해지고, 한 사람 한 표(바꾸면 고쳐짐).
 *   GET  /api/balance?me=멤버키
 *   POST /api/balance { memberKey, choice: "a" | "b" }
 */
import type { BalanceResponse } from "../shared/api";
import { balanceOfDay } from "../shared/fun";
import { HttpError, json, limit, readJsonBody, todayKst, type Env } from "./env";
import { sbInsert, sbSelect } from "./supabase";

const TABLE = "lunch_balance_votes";
const KEY_RE = /^[\w-]{8,64}$/;

async function view(env: Env, day: string, me: string | null): Promise<BalanceResponse> {
  const rows = await sbSelect<{ member_key: string; choice: "a" | "b" }>(env, TABLE, `day=eq.${day}&select=member_key,choice&limit=10000`);
  const counts = { a: 0, b: 0 };
  let mine: "a" | "b" | null = null;
  for (const r of rows) {
    counts[r.choice]++;
    if (me && r.member_key === me) mine = r.choice;
  }
  const { q, a, b } = balanceOfDay(day);
  return { day, q, a, b, counts, mine };
}

export async function handleBalance(request: Request, env: Env): Promise<Response> {
  const day = todayKst();
  if (request.method === "GET") {
    const me = new URL(request.url).searchParams.get("me");
    return json(await view(env, day, me && KEY_RE.test(me) ? me : null));
  }
  if (request.method !== "POST") throw new HttpError(405, "GET 또는 POST 로 보내 주세요.");
  await limit(env, request, "balance");
  const body = await readJsonBody<{ memberKey?: unknown; choice?: unknown }>(request, 1_000);
  const memberKey = String(body.memberKey ?? "");
  const choice = body.choice === "a" || body.choice === "b" ? body.choice : null;
  if (!KEY_RE.test(memberKey) || !choice) throw new HttpError(400, "선택을 다시 해 주세요.");
  await sbInsert(env, TABLE, [{ day, member_key: memberKey, choice, updated_at: new Date().toISOString() }], {
    upsertOn: "day,member_key",
    returning: false,
  });
  return json(await view(env, day, memberKey));
}
