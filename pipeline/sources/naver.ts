/**
 * 네이버 검색 API — 블로그 검색 (공식 API)
 * 2026년부터 NAVER API HUB(네이버 클라우드, ncloud.com)로 옮겨져 주소와 인증 헤더가 바뀌었다.
 *   새 방식: https://naverapihub.apigw.ntruss.com/search/v1/blog  + X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY
 *   예전 방식: https://openapi.naver.com/v1/search/blog.json      + X-Naver-Client-Id / X-Naver-Client-Secret
 * 새 방식을 먼저 쓰고, 인증이 거절되면 예전 방식으로 한 번 더 시도한 뒤 되는 쪽을 기억한다.
 *
 * 네이버 지도(플레이스)의 별점·방문자 리뷰는 공식 API 가 없다.
 * 그래서 '가게 이름 + 동네' 블로그 글 수를 인기 지표로 쓰고,
 * 최신 글 10개(제목·요약·날짜)를 Claude 분석 재료로 쓴다.
 */
import type { BlogPost } from "../../shared/types";
import { fetchJson, HttpError, type FetchLike } from "../http";

interface NaverBlogItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  postdate: string; // yyyymmdd
}

interface NaverBlogResponse {
  total?: number | string;
  items?: NaverBlogItem[];
}

export interface BlogSearchResult {
  total: number;
  posts: Array<BlogPost & { snippet: string }>;
}

type Mode = "hub" | "legacy";

const ENDPOINTS: Record<Mode, string> = {
  hub: "https://naverapihub.apigw.ntruss.com/search/v1/blog",
  legacy: "https://openapi.naver.com/v1/search/blog.json",
};

/** 이번 실행에서 인증이 통한 방식 (NAVER_API_MODE=hub|legacy 로 고정할 수도 있다) */
let workingMode: Mode | null = null;

export function resetNaverMode(mode: Mode | null = null): void {
  workingMode = mode;
}

function authHeaders(mode: Mode, creds: { clientId: string; clientSecret: string }): Record<string, string> {
  return mode === "hub"
    ? { "X-NCP-APIGW-API-KEY-ID": creds.clientId, "X-NCP-APIGW-API-KEY": creds.clientSecret }
    : { "X-Naver-Client-Id": creds.clientId, "X-Naver-Client-Secret": creds.clientSecret };
}

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
  const fixed = (typeof process !== "undefined" ? process.env.NAVER_API_MODE : undefined) as Mode | undefined;
  const order: Mode[] = workingMode ? [workingMode] : fixed === "hub" || fixed === "legacy" ? [fixed] : ["hub", "legacy"];

  let lastErr: unknown;
  for (const mode of order) {
    const params = new URLSearchParams({ query, display: "10", start: "1", sort: "date" });
    if (mode === "hub") params.set("format", "json");
    try {
      const data = await fetchJson<NaverBlogResponse>(fetchImpl, `${ENDPOINTS[mode]}?${params}`, {
        headers: authHeaders(mode, creds),
      });
      workingMode = mode;
      return parseBlogResponse(data);
    } catch (err) {
      lastErr = err;
      // 인증 · 주소 문제면 다른 방식으로, 그 밖의 오류는 그대로
      if (err instanceof HttpError && [401, 403, 404].includes(err.status) && !workingMode) continue;
      throw err;
    }
  }
  throw lastErr;
}

export function parseBlogResponse(data: NaverBlogResponse): BlogSearchResult {
  const items = Array.isArray(data.items) ? data.items : [];
  const total = Number(data.total);
  return {
    // total 이 없는 응답이면 받은 글 수라도 쓴다
    total: Number.isFinite(total) && total >= 0 ? total : items.length,
    posts: items.map((it) => ({
      title: cleanText(it.title ?? ""),
      link: it.link,
      date: toIsoDate(it.postdate),
      snippet: cleanText(it.description ?? ""),
    })),
  };
}
