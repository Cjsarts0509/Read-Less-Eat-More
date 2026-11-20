/**
 * /api/place-live — 상세 화면을 열 때 영업시간 · 메뉴 · 가격을 AI 웹 검색으로 확인한다.
 *
 * 네이버 · 카카오 지도 페이지를 직접 긁어 오지 않는다 (이용약관 · 서버 IP 차단 문제).
 * 대신 Claude 웹 검색 도구로 공개된 맛집 정보 페이지와 후기를 찾아 읽는다.
 * 결과는 Supabase 에 가게당 한 줄로 저장해 모두가 함께 쓰고(14일), 하루 확인 수에 한도를 둔다.
 */
import type { PlaceLiveResponse } from "../shared/api";
import { hoursFromWeb } from "../shared/insights";
import type { WebInfo } from "../shared/types";
import { createWebSearcher } from "../pipeline/sources/websearch";
import { BRANCH_RE, HttpError, json, limit, todayKst, type Env } from "./env";
import { getPlaces } from "./places";
import { hasSupabase, sbInsert, sbSelect } from "./supabase";

const TABLE = "lunch_place_live";
const FRESH_MS = 14 * 86_400_000;
const PENDING_MS = 2 * 60_000;
const ID_RE = /^[0-9A-Za-z_-]{1,32}$/;

interface Row {
  place_id: string;
  branch_code: string;
  status: "pending" | "done" | "notfound" | "error";
  data: WebInfo | null;
  checked_at: string;
}

type Search = (place: Parameters<ReturnType<typeof createWebSearcher>>[0], today: string) => Promise<WebInfo | null>;

function reply(status: PlaceLiveResponse["status"], info: WebInfo | null, checkedAt: string | null): Response {
  return json({ status, info, hours: hoursFromWeb(info), checkedAt } satisfies PlaceLiveResponse);
}

export async function handlePlaceLive(request: Request, env: Env, search?: Search): Promise<Response> {
  const url = new URL(request.url);
  const branch = url.searchParams.get("b") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!BRANCH_RE.test(branch) || !ID_RE.test(id)) throw new HttpError(400, "지점과 가게를 함께 보내 주세요.");
  if (!env.ANTHROPIC_API_KEY || !hasSupabase(env)) return reply("off", null, null);

  const [row] = await sbSelect<Row>(env, TABLE, `place_id=eq.${encodeURIComponent(id)}&select=*`);
  const age = row ? Date.now() - Date.parse(row.checked_at) : Infinity;
  if (row?.status === "pending" && age < PENDING_MS) return reply("pending", row.data, row.checked_at);
  if (row && (row.status === "done" || row.status === "notfound") && age < FRESH_MS) {
    return reply(row.status === "done" ? "cached" : "notfound", row.data, row.checked_at);
  }

  await limit(env, request, "live");
  // 하루 한도: 오늘 확인한 가게 수 (KST 자정 기준)
  const cap = Math.max(0, Number(env.LIVE_LOOKUP_DAILY ?? 20) || 0);
  const since = encodeURIComponent(`${todayKst()}T00:00:00+09:00`);
  const todays = await sbSelect<{ place_id: string }>(env, TABLE, `select=place_id&status=neq.pending&checked_at=gte.${since}&limit=1000`);
  if (todays.length >= cap) return reply("limit", row?.data ?? null, row?.checked_at ?? null);

  const data = await getPlaces(env, request, branch);
  const place = data.places.find((p) => p.id === id);
  if (!place) throw new HttpError(404, "가게를 찾을 수 없어요.");

  const save = (status: Row["status"], info: WebInfo | null) =>
    sbInsert(env, TABLE, [{ place_id: id, branch_code: branch, status, data: info, checked_at: new Date().toISOString() }], {
      upsertOn: "place_id",
      returning: false,
    });

  await save("pending", row?.data ?? null);
  const run: Search =
    search ??
    createWebSearcher({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.LIVE_MODEL || env.WEB_MODEL || env.CLAUDE_MODEL,
      // 사람이 기다리는 화면이라 검색 2번 · 기본 검색 도구로 짧게
      maxUses: 2,
      fast: true,
    });
  let info: WebInfo | null;
  try {
    info = await run(place, todayKst());
  } catch (err) {
    await save("error", row?.data ?? null).catch(() => {});
    throw err;
  }
  await save(info ? "done" : "notfound", info);
  return reply(info ? "fresh" : "notfound", info, new Date().toISOString());
}
