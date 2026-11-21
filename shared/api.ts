import type { WeatherMood } from "./kma";
import type { HoursInfo, WebInfo } from "./types";

/** /api/weather 응답 */
export interface WeatherResponse {
  available: boolean;
  day?: string;
  tmin?: number | null;
  tmax?: number | null;
  sky?: string;
  precip?: string;
  pop?: number | null;
  mood?: WeatherMood;
  line?: string;
  boost?: { keywords: string[]; maxWalk: number | null; label: string };
}

/** /api/menus 응답의 항목 */
export interface MenuReport {
  placeId: string;
  nickname: string | null;
  items: Array<{ name: string; price: number | null }>;
  note: string | null;
  createdAt: string;
}

/** /api/place-live 응답 — 상세 화면의 실시간 확인 (AI 웹 검색) */
export interface PlaceLiveResponse {
  /** fresh: 방금 확인 · cached: 최근 확인 결과 · pending: 다른 사람이 확인 중 · limit: 오늘 한도 소진 · notfound: 못 찾음 · off: 기능 꺼짐 */
  status: "fresh" | "cached" | "pending" | "limit" | "notfound" | "off";
  info: WebInfo | null;
  hours: HoursInfo | null;
  checkedAt: string | null;
}

/** 사내 한줄평 하나 */
export interface InhouseReview {
  nickname: string;
  rating: number;
  comment: string;
  updatedAt: string;
}

/** /api/reviews 응답: 가게별 사내 평점 */
export interface ReviewSummary {
  avg: number;
  count: number;
  /** 최근 한줄평 (최대 5개) */
  recent: InhouseReview[];
  /** 내가 쓴 평가 (me 를 보냈을 때) */
  mine?: { rating: number; comment: string };
}

/** /api/balance 응답: 오늘의 밸런스 게임 */
export interface BalanceResponse {
  day: string;
  q: string;
  a: string;
  b: string;
  counts: { a: number; b: number };
  mine: "a" | "b" | null;
}

/** /api/naver-ids — 상세 화면 확인 등으로 알아낸 네이버 지도 가게 번호 (지점별) */
export interface NaverIdsResponse {
  ids: Record<string, string>;
}

/** 음식 · 메뉴판 사진 (다음 이미지 검색). 썸네일 + 원래 글 */
export interface PlacePhoto {
  thumb: string;
  link: string;
  site: string;
  date: string | null;
}

export interface PlacePhotosResponse {
  photos: PlacePhoto[];
  /** 검색에 쓴 말 (없으면 꺼져 있음) */
  query: string | null;
}
