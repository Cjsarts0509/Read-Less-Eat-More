/**
 * 사내 한줄평 · 별점 — 직원이 가게마다 별 1~5개와 한 줄(80자)을 남긴다.
 * 로그인 없이 브라우저가 만든 member_key + 닉네임. 한 사람이 같은 가게에 다시 쓰면 고쳐진다.
 *   GET  /api/reviews?b=지점&me=멤버키  → { 가게 id: { avg, count, recent, mine } }
 *   POST /api/reviews  { branch, placeId, memberKey, nickname, rating, comment }
 */
import type { ReviewSummary } from "../shared/api";
import { BRANCH_RE, HttpError, json, limit, readJsonBody, type Env } from "./env";
import { getPlaces } from "./places";
import { sbInsert, sbSelect } from "./supabase";

const TABLE = "lunch_reviews";
const ID_RE = /^[\w-]{1,64}$/;
const KEY_RE = /^[\w-]{8,64}$/;

interface Row {
  place_id: string;
  member_key: string;
  nickname: string;
  rating: number;
  comment: string;
  updated_at: string;
}

/** 줄바꿈 · 연속 공백 · 주소(링크)를 걷어 내고 80자로 */
export function cleanComment(s: unknown): string {
  return String(s ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function summarize(rows: Row[], me?: string | null): Record<string, ReviewSummary> {
  const out: Record<string, ReviewSummary> = {};
  for (const r of rows) {
    const s = (out[r.place_id] ??= { avg: 0, count: 0, recent: [] });
    s.avg += r.rating;
    s.count++;
    if (s.recent.length < 5 && (r.comment || s.recent.length < 3)) {
      s.recent.push({ nickname: r.nickname, rating: r.rating, comment: r.comment, updatedAt: r.updated_at });
    }
    if (me && r.member_key === me) s.mine = { rating: r.rating, comment: r.comment };
  }
  for (const s of Object.values(out)) s.avg = Math.round((s.avg / s.count) * 10) / 10;
  return out;
}

async function list(env: Env, branch: string, me: string | null): Promise<Record<string, ReviewSummary>> {
  const rows = await sbSelect<Row>(
    env,
    TABLE,
    `branch_code=eq.${encodeURIComponent(branch)}&select=place_id,member_key,nickname,rating,comment,updated_at&order=updated_at.desc&limit=3000`,
  );
  return summarize(rows, me);
}

interface Body {
  branch?: unknown;
  placeId?: unknown;
  memberKey?: unknown;
  nickname?: unknown;
  rating?: unknown;
  comment?: unknown;
}

export async function handleReviews(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const branch = url.searchParams.get("b") ?? "";
    const me = url.searchParams.get("me");
    if (!BRANCH_RE.test(branch)) throw new HttpError(400, "지점을 알려 주세요.");
    return json(await list(env, branch, me && KEY_RE.test(me) ? me : null));
  }
  if (request.method !== "POST") throw new HttpError(405, "GET 또는 POST 로 보내 주세요.");

  await limit(env, request, "review");
  const body = await readJsonBody<Body>(request, 4_000);
  const branch = String(body.branch ?? "");
  const placeId = String(body.placeId ?? "");
  const memberKey = String(body.memberKey ?? "");
  const nickname = String(body.nickname ?? "").trim().slice(0, 20);
  const rating = Number(body.rating);
  if (!BRANCH_RE.test(branch) || !ID_RE.test(placeId) || !KEY_RE.test(memberKey)) throw new HttpError(400, "가게 정보가 올바르지 않아요.");
  if (!nickname) throw new HttpError(400, "닉네임을 적어 주세요.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "별점은 1~5개로 골라 주세요.");

  const data = await getPlaces(env, request, branch);
  if (!data.places.some((p) => p.id === placeId)) throw new HttpError(404, "이 지점의 가게가 아니에요.");

  await sbInsert(
    env,
    TABLE,
    [
      {
        branch_code: branch,
        place_id: placeId,
        member_key: memberKey,
        nickname,
        rating,
        comment: cleanComment(body.comment),
        updated_at: new Date().toISOString(),
      },
    ],
    { upsertOn: "place_id,member_key", returning: false },
  );
  const all = await list(env, branch, memberKey);
  return json(all[placeId] ?? null);
}
