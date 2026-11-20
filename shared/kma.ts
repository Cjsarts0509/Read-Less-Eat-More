/**
 * 위경도 → 기상청 동네예보 격자(nx, ny). 기상청 Lambert Conformal Conic 변환식.
 */
export function toKmaGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877; // 지구 반경 km
  const GRID = 5.0; // 격자 간격 km
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

export type WeatherMood = "rain" | "snow" | "cold" | "hot" | "mild";

export interface DailyForecast {
  tmin: number | null;
  tmax: number | null;
  /** 1 맑음 · 3 구름많음 · 4 흐림 */
  sky: number | null;
  /** 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 4 소나기 */
  pty: number | null;
  /** 강수확률 % */
  pop: number | null;
}

export function weatherMood(f: DailyForecast): WeatherMood {
  if (f.pty === 3) return "snow";
  if ((f.pty !== null && [1, 2, 4].includes(f.pty)) || (f.pop ?? 0) >= 60) return "rain";
  if (f.tmax !== null && f.tmax <= 4) return "cold";
  if (f.tmax !== null && f.tmax >= 29) return "hot";
  return "mild";
}

/** 날씨에 따라 뽑기에서 더 잘 나오게 할 메뉴 단어와 도보 한도 */
export const MOOD_BOOST: Record<WeatherMood, { keywords: string[]; maxWalk: number | null; label: string }> = {
  rain: { keywords: ["국밥", "탕", "찌개", "국수", "칼국수", "짬뽕", "라멘", "우동", "수제비", "전골", "샤브"], maxWalk: 7, label: "비 오는 날" },
  snow: { keywords: ["국밥", "탕", "찌개", "칼국수", "짬뽕", "라멘", "우동", "전골", "샤브"], maxWalk: 7, label: "눈 오는 날" },
  cold: { keywords: ["국밥", "탕", "찌개", "칼국수", "짬뽕", "라멘", "우동", "곰탕", "설렁탕", "전골", "샤브"], maxWalk: null, label: "추운 날" },
  hot: { keywords: ["냉면", "막국수", "소바", "콩국수", "물회", "샐러드", "포케", "초밥"], maxWalk: 10, label: "더운 날" },
  mild: { keywords: [], maxWalk: null, label: "걷기 좋은 날" },
};

export const SKY_LABEL: Record<number, string> = { 1: "맑음", 3: "구름 많음", 4: "흐림" };
export const PTY_LABEL: Record<number, string> = { 0: "", 1: "비", 2: "비/눈", 3: "눈", 4: "소나기" };
