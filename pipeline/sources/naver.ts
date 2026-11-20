/**
 * 네이버 검색 API — 블로그 검색 (공식 API, 하루 25,000회)
 * https://developers.naver.com/docs/serviceapi/search/blog/blog.md
 *
 * 네이버 지도(플레이스)의 별점·방문자 리뷰는 공식 API 가 없다.
 * 그래서 '가게 이름 + 동네' 블로그 글 수를 인기 지표로 쓰고,
 * 최신 글 10개(제목·요약·날짜)를 Claude 분석 재료로 쓴다.
 */
import type { BlogPost } from "../../shared/types";
import { fetchJson, type FetchLike } from "../http";

interface NaverBlogItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  postdate: string; // yyyymmdd
}

interface NaverBlogResponse {
  total: number;
  items: NaverBlogItem[];
}

export interface BlogSearchResult {
  total: number;
  posts: Array<BlogPost & { snippet: string }>;
}

const ENDPOINT = "https://openapi.naver.com/v1/search/blog.json";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function cleanText(s: string): string {
  return s
    .replace(/<\/?b>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toIsoDate(yyyymmdd: string | undefined): string | null {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** 지번 주소에서 동 이름을 뽑는다. "서울 종로구 종로1가 24" → "종로1가" */
export function areaHint(jibunAddress: string, roadAddress: string): string {
  const tokens = (jibunAddress || roadAddress).split(/\s+/).filter(Boolean).slice(1);
  const dong = tokens.find((t) => /^[가-힣]+\d*(동|가|읍|면|리)$/.test(t));
  if (dong) return dong;
  return tokens.find((t) => /(구|군)$/.test(t)) ?? tokens.find((t) => /시$/.test(t)) ?? "";
}

export function buildQuery(name: string, jibunAddress: string, roadAddress: string): string {
  const hint = areaHint(jibunAddress, roadAddress);
  return hint && !name.includes(hint) ? `${name} ${hint}` : name;
}

export async function searchBlog(
  query: string,
  creds: { clientId: string; clientSecret: string },
  fetchImpl: FetchLike = fetch,
): Promise<BlogSearchResult> {
  const params = new URLSearchParams({ query, display: "10", start: "1", sort: "date" });
  const data = await fetchJson<NaverBlogResponse>(fetchImpl, `${ENDPOINT}?${params}`, {
    headers: {
      "X-Naver-Client-Id": creds.clientId,
      "X-Naver-Client-Secret": creds.clientSecret,
    },
  });
  return {
    total: data.total ?? 0,
    posts: (data.items ?? []).map((it) => ({
      title: cleanText(it.title),
      link: it.link,
      date: toIsoDate(it.postdate),
      snippet: cleanText(it.description),
    })),
  };
}
