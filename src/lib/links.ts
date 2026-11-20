import type { Branch, Place } from "../../shared/types";

/**
 * 네이버 지도 — 별점 · 방문자 리뷰 · 영업시간은 네이버 지도에서 확인.
 * 가게 번호를 알면 그 가게로 바로, 모르면 가게 이름(지점명 포함) 그대로 검색한다.
 * 이름 뒤에 구 이름을 붙이면 오히려 검색이 안 되는 경우가 많다 (예: 「삼정모밀 상암점 마포구」).
 */
export function naverMapUrl(place: Pick<Place, "name"> & { web?: Place["web"] }): string {
  const id = place.web?.naverPlaceId;
  if (id && /^\d+$/.test(id)) return `https://map.naver.com/p/entry/place/${id}`;
  return `https://map.naver.com/p/search/${encodeURIComponent(place.name.trim())}`;
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
