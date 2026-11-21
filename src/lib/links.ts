import type { Branch, Place } from "../../shared/types";

/** 지금까지 알아낸 네이버 지도 가게 번호 (수집 · 실시간 확인 · 다른 사람의 확인) */
const naverIds = new Map<string, string>();

export function rememberNaverIds(ids: Record<string, string>): void {
  for (const [placeId, nid] of Object.entries(ids)) if (/^\d{4,12}$/.test(nid)) naverIds.set(placeId, nid);
}

/** 위도 · 경도 → 네이버 지도 주소의 중심 좌표 (웹 메르카토르, m) */
function mercator(lat: number, lng: number): [number, number] {
  const R = 6378137;
  const x = (lng * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

/**
 * 네이버 지도 — 별점 · 방문자 리뷰 · 영업시간은 네이버 지도에서 확인.
 * 네이버 가게 번호를 알면 그 가게 페이지로 바로 간다.
 * 모르면(네이버 공식 API 는 가게 번호를 주지 않는다) 가게 좌표에 지도를 맞춘 채 가게 이름으로 찾아,
 * 같은 이름의 다른 지점이 아니라 바로 그 자리의 가게가 맨 위에 오게 한다.
 * 이름 뒤에 구 이름을 붙이면 오히려 검색이 안 되는 경우가 많다 (예: 「삼정모밀 상암점 마포구」).
 */
export function naverMapUrl(place: Pick<Place, "name"> & Partial<Pick<Place, "id" | "lat" | "lng">> & { web?: Place["web"] }): string {
  const id = place.web?.naverPlaceId ?? (place.id ? naverIds.get(place.id) : undefined);
  if (id && /^\d+$/.test(id)) return `https://map.naver.com/p/entry/place/${id}`;
  const q = encodeURIComponent(place.name.trim());
  if (place.lat == null || place.lng == null) return `https://map.naver.com/p/search/${q}`;
  const [x, y] = mercator(place.lat, place.lng);
  return `https://map.naver.com/p/search/${q}?c=${x.toFixed(4)},${y.toFixed(4)},18,0,0,0,dh`;
}

export function kakaoPlaceUrl(place: Pick<Place, "kakaoUrl" | "id">): string {
  return place.kakaoUrl ? place.kakaoUrl.replace(/^http:/, "https:") : `https://place.map.kakao.com/${place.id}`;
}

/** 카카오맵 길찾기 (도착지 = 식당) */
export function directionsUrl(place: Pick<Place, "name" | "lat" | "lng">): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}

export function shareText(place: Place, branch: Branch, bookTitle: string): string {
  const menus = place.ai?.signatureMenus.length ? ` (${place.ai.signatureMenus.join(" · ")})` : "";
  const lines = [
    `📚 [점심은 사람을 만든다 - ${branch.label} 편찬실]`,
    `오늘의 필독서: 《${bookTitle}》`,
    `🍽️ 식당: ${place.name}${menus}`,
    `🚶 도보 ${place.walkMin}분${place.ai?.priceHint ? ` · ${place.ai.priceHint}` : ""}`,
  ];
  if (place.ai?.summary) lines.push(`💬 사서평: ${place.ai.summary}`);
  lines.push(`🗺️ ${naverMapUrl(place)}`);
  lines.push("👉 완독보다 완뚝! 12시에 바로 출발하실 분?");
  return lines.join("\n");
}
