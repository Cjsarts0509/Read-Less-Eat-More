import { driveMinutes } from "./geo";
import type { CategoryKey, Pace, Place, WaitLevel } from "./types";

export type TravelMode = "walk" | "drive";

/** 분류별 기본 식사 시간 (분) */
const MEAL_BY_CATEGORY: Record<CategoryKey, number> = {
  korean: 30,
  chinese: 30,
  japanese: 30,
  western: 45,
  asian: 30,
  snack: 20,
  fastfood: 20,
  healthy: 20,
  dessert: 20,
  pub: 40,
  etc: 35,
};

const MEAL_BY_PACE: Record<Exclude<Pace, "unknown">, number> = { fast: 20, normal: 30, slow: 45 };
const WAIT_MIN: Record<WaitLevel, number> = { none: 0, short: 10, long: 25, unknown: 5 };

export interface TimeEstimate {
  /** 왕복 이동 (도보 또는 차) */
  walk: number;
  mode: TravelMode;
  meal: number;
  wait: number;
  total: number;
}

/** 다녀오는 데 걸리는 시간 = 왕복 이동(도보 · 차) + 식사 + 웨이팅 */
export function estimateLunchTime(
  p: Pick<Place, "walkMin" | "category" | "ai"> & { distance?: number },
  mode: TravelMode = "walk",
): TimeEstimate {
  const pace = p.ai?.pace;
  const meal = pace && pace !== "unknown" ? MEAL_BY_PACE[pace] : MEAL_BY_CATEGORY[p.category];
  const wait = WAIT_MIN[p.ai?.waiting?.level ?? "unknown"];
  const walk = mode === "drive" && p.distance != null ? driveMinutes(p.distance) * 2 : p.walkMin * 2;
  return { walk, mode, meal, wait, total: walk + meal + wait };
}
