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
