/**
 * 다음 검색 API (카카오) — 블로그(티스토리 · 다음 · 브런치 등) · 카페 글 · 웹문서.
 * 카카오 로컬과 같은 REST API 키를 쓴다.
 *   GET https://dapi.kakao.com/v2/search/blog?query=…&sort=accuracy&size=50
 *   GET https://dapi.kakao.com/v2/search/cafe?query=…&sort=accuracy&size=50
 *   GET https://dapi.kakao.com/v2/search/web?query=…&sort=accuracy&size=50   (영업시간 찾기)
 */
import { fetchJson, type FetchLike } from "../http";
import type { BlogSearchResult } from "./naver";
import { cleanText } from "./naver";

interface DaumDoc {
  title: string;
  contents: string;
  url: string;
  datetime?: string;
  blogname?: string;
  cafename?: string;
}

interface DaumResponse {
  meta?: { total_count?: number; pageable_count?: number; is_end?: boolean };
  documents?: DaumDoc[];
}

export type DaumKind = "blog" | "cafe" | "web";

export function parseDaumResponse(data: DaumResponse): BlogSearchResult {
  const docs = Array.isArray(data.documents) ? data.documents : [];
  const total = Number(data.meta?.total_count);
  return {
    total: Number.isFinite(total) && total >= 0 ? total : docs.length,
    posts: docs.map((d) => ({
      title: cleanText(d.title ?? ""),
      link: d.url,
      // "2024-03-01T12:00:00.000+09:00" → 한국 날짜
      date: /^\d{4}-\d{2}-\d{2}/.test(d.datetime ?? "") ? d.datetime!.slice(0, 10) : null,
      snippet: cleanText(d.contents ?? ""),
    })),
  };
}

export async function searchDaum(kind: DaumKind, query: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<BlogSearchResult> {
  const params = new URLSearchParams({ query, sort: "accuracy", page: "1", size: "50" });
  const data = await fetchJson<DaumResponse>(fetchImpl, `https://dapi.kakao.com/v2/search/${kind}?${params}`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  return parseDaumResponse(data);
}
