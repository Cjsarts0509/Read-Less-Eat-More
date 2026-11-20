export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** 두 좌표 사이 직선거리 (m) */
export function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 직선거리는 실제 걷는 길보다 짧으므로 1.25배 우회 계수, 분속 70m 로 잡는다. */
export const DETOUR_FACTOR = 1.25;
export const WALK_METERS_PER_MIN = 70;

export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round((distanceM * DETOUR_FACTOR) / WALK_METERS_PER_MIN));
}

/** 도보 N분 안에 들어오는 최대 직선거리 (m) */
export function radiusForWalk(minutes: number): number {
  return Math.round((minutes * WALK_METERS_PER_MIN) / DETOUR_FACTOR);
}

/** 걸어서 갈 만한 곳으로 보는 직선거리 (m). 이보다 먼 곳은 차량 모드에서만 보인다 */
export const WALK_RADIUS_M = 1000;

/** 차: 도로 우회 1.4배, 점심시간 도심 평균 22km/h, 출발 · 주차에 4분 */
export const DRIVE_DETOUR = 1.4;
export const DRIVE_METERS_PER_MIN = 22000 / 60;
export const DRIVE_OVERHEAD_MIN = 4;

export function driveMinutes(distanceM: number): number {
  return Math.max(3, Math.round((distanceM * DRIVE_DETOUR) / DRIVE_METERS_PER_MIN) + DRIVE_OVERHEAD_MIN);
}

/** 차로 N분 안에 들어오는 최대 직선거리 (m) */
export function radiusForDrive(minutes: number): number {
  return Math.max(0, Math.round(((minutes - DRIVE_OVERHEAD_MIN) * DRIVE_METERS_PER_MIN) / DRIVE_DETOUR));
}

export interface Rect {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function boundingRect(center: LatLng, radiusM: number): Rect {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return {
    west: center.lng - dLng,
    south: center.lat - dLat,
    east: center.lng + dLng,
    north: center.lat + dLat,
  };
}

export function splitRect(r: Rect): Rect[] {
  const midLng = (r.west + r.east) / 2;
  const midLat = (r.south + r.north) / 2;
  return [
    { west: r.west, south: midLat, east: midLng, north: r.north },
    { west: midLng, south: midLat, east: r.east, north: r.north },
    { west: r.west, south: r.south, east: midLng, north: midLat },
    { west: midLng, south: r.south, east: r.east, north: midLat },
  ];
}

/** 사각형이 원과 겹치는지 (원 중심에서 사각형 위 가장 가까운 점까지 거리로 판단) */
export function rectIntersectsCircle(r: Rect, center: LatLng, radiusM: number): boolean {
  const nearest = {
    lat: Math.min(Math.max(center.lat, r.south), r.north),
    lng: Math.min(Math.max(center.lng, r.west), r.east),
  };
  return haversine(center, nearest) <= radiusM;
}

/** 가장 가까운 지점 (거리 m 포함) */
export function nearestBranch<B extends { lat: number; lng: number }>(branches: B[], at: { lat: number; lng: number }): { branch: B; distance: number } | null {
  let best: { branch: B; distance: number } | null = null;
  for (const b of branches) {
    const d = haversine(at, b);
    if (!best || d < best.distance) best = { branch: b, distance: Math.round(d) };
  }
  return best;
}

/** 이동 한 줄: 도보 반경 안이면 도보 N분, 밖이면 차로 약 N분 */
export function travelText(p: { distance: number; walkMin: number }): string {
  return p.distance > WALK_RADIUS_M ? `🚗 차로 약 ${driveMinutes(p.distance)}분` : `🚶 도보 ${p.walkMin}분`;
}
