import type { WeatherMood } from "./kma";

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
