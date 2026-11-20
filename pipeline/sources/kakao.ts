/**
 * 카카오 로컬 API — 카테고리로 장소 검색 (FD6 = 음식점)
 * https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-category
 *
 * 한 번의 검색은 최대 45개(15개 × 3쪽)까지만 돌려주므로, 결과가 45개를 넘는 영역은
 * 사각형을 4등분해 다시 검색한다. 원 밖의 사각형은 건너뛴다.
 */
import { boundingRect, rectIntersectsCircle, splitRect, type LatLng, type Rect } from "../../shared/geo";
import { fetchJson, type FetchLike } from "../http";

export interface KakaoPlace {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string; // 경도
  y: string; // 위도
  place_url: string;
  distance: string;
}

interface KakaoResponse {
  meta: { total_count: number; pageable_count: number; is_end: boolean };
  documents: KakaoPlace[];
}

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/category.json";
const PAGE_SIZE = 15;
const MAX_PAGES = 3;
const MAX_PER_QUERY = PAGE_SIZE * MAX_PAGES;

export interface CollectOptions {
  apiKey: string;
  center: LatLng;
  radius: number;
  categoryGroup?: string;
  maxDepth?: number;
  fetchImpl?: FetchLike;
  onRequest?: () => void;
}

export async function collectNearby(opts: CollectOptions): Promise<KakaoPlace[]> {
  const { apiKey, center, radius, categoryGroup = "FD6", maxDepth = 6 } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const found = new Map<string, KakaoPlace>();

  const query = async (rect: Rect, page: number) => {
    const params = new URLSearchParams({
      category_group_code: categoryGroup,
      rect: [rect.west, rect.south, rect.east, rect.north].map((n) => n.toFixed(7)).join(","),
      x: String(center.lng),
      y: String(center.lat),
      page: String(page),
      size: String(PAGE_SIZE),
      sort: "distance",
    });
    opts.onRequest?.();
    return fetchJson<KakaoResponse>(fetchImpl, `${ENDPOINT}?${params}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
    });
  };

  const crawl = async (rect: Rect, depth: number): Promise<void> => {
    if (!rectIntersectsCircle(rect, center, radius)) return;
    const first = await query(rect, 1);
    const total = first.meta.total_count;
    if (total > MAX_PER_QUERY && depth < maxDepth) {
      for (const sub of splitRect(rect)) await crawl(sub, depth + 1);
      return;
    }
    for (const d of first.documents) found.set(d.id, d);
    const pages = Math.min(MAX_PAGES, Math.ceil(Math.min(total, MAX_PER_QUERY) / PAGE_SIZE));
    for (let p = 2; p <= pages; p++) {
      const res = await query(rect, p);
      for (const d of res.documents) found.set(d.id, d);
      if (res.meta.is_end) break;
    }
  };

  await crawl(boundingRect(center, radius), 0);
  return [...found.values()];
}

interface KakaoAddressResponse {
  documents: Array<{ address_name: string; x: string; y: string }>;
}

/** 주소 → 좌표 (카카오 주소 검색). 쉼표 뒤 건물 이름은 떼고 찾는다 */
export async function geocodeAddress(
  apiKey: string,
  address: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ lat: number; lng: number } | null> {
  const query = address.split(",")[0]!.trim();
  const params = new URLSearchParams({ query, size: "1" });
  const data = await fetchJson<KakaoAddressResponse>(fetchImpl, `https://dapi.kakao.com/v2/local/search/address.json?${params}`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  const d = data.documents[0];
  if (!d) return null;
  const lat = Number(d.y);
  const lng = Number(d.x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
