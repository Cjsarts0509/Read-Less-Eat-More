/**
 * /api/place-photos?b=지점&id=가게 — 음식 · 메뉴판 사진 (다음 이미지 검색, 카카오 공식 API).
 *
 * 검색어는 서버 데이터의 가게 이름 · 동네로만 만든다 (아무 검색어나 받지 않는다).
 * 결과는 Cloudflare 캐시에 7일 둔다. 사진은 원래 글로 연결하는 썸네일만 보여 준다.
 */
import type { PlacePhoto, PlacePhotosResponse } from "../shared/api";
import { blogQuery } from "../pipeline/sources/naver";
import { BRANCH_RE, HttpError, json, limit, type Env } from "./env";
import { getPlaces } from "./places";

const ID_RE = /^[0-9A-Za-z_-]{1,32}$/;
const KEEP_S = 7 * 86_400;
const MAX = 8;

interface DaumImage {
  thumbnail_url?: string;
  image_url?: string;
  display_sitename?: string;
  doc_url?: string;
  datetime?: string;
  collection?: string;
}

export function toPhotos(docs: DaumImage[], max = MAX): PlacePhoto[] {
  const seen = new Set<string>();
  const out: PlacePhoto[] = [];
  for (const d of docs) {
    const thumb = (d.thumbnail_url ?? "").replace(/^http:/, "https:");
    const link = d.doc_url ?? "";
    if (!/^https:\/\//.test(thumb) || !/^https?:\/\//.test(link) || seen.has(link)) continue;
    seen.add(link);
    out.push({
      thumb,
      link,
      site: (d.display_sitename ?? "").slice(0, 40),
      date: /^\d{4}-\d{2}-\d{2}/.test(d.datetime ?? "") ? d.datetime!.slice(0, 10) : null,
    });
    if (out.length >= max) break;
  }
  return out;
}

export async function handlePlacePhotos(request: Request, env: Env, ctx?: ExecutionContext, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const branch = url.searchParams.get("b") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!BRANCH_RE.test(branch) || !ID_RE.test(id)) throw new HttpError(400, "지점과 가게를 함께 보내 주세요.");
  if (!env.KAKAO_REST_API_KEY) return json({ photos: [], query: null } satisfies PlacePhotosResponse);

  const cacheKey = new Request(`https://cache.lunch/place-photos/${branch}/${id}`);
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(cacheKey);
  if (hit) return hit;

  await limit(env, request, "photos");
  const data = await getPlaces(env, request, branch);
  const place = data.places.find((p) => p.id === id);
  if (!place) throw new HttpError(404, "가게를 찾을 수 없어요.");

  const q = blogQuery(place.name, place.address, place.address);
  const query = `"${q.core}" ${q.hint} 메뉴`.trim();
  const params = new URLSearchParams({ query, sort: "accuracy", page: "1", size: "30" });
  const res = await fetchImpl(`https://dapi.kakao.com/v2/search/image?${params}`, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) throw new HttpError(502, "사진을 불러오지 못했어요.");
  const body = (await res.json()) as { documents?: DaumImage[] };
  const out = json({ photos: toPhotos(body.documents ?? []), query } satisfies PlacePhotosResponse, 200, {
    "cache-control": `public, max-age=${KEEP_S}`,
  });
  if (cache) {
    const put = cache.put(cacheKey, out.clone());
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return out;
}
