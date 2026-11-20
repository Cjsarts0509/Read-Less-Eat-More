import type { Branch, Place } from "../../shared/types";

/** 주소에서 구·군·시 하나만 뽑아 검색어를 좁힌다 */
function districtOf(address: string): string {
  const tokens = address.split(/\s+/).slice(1);
  return tokens.find((t) => /(구|군)$/.test(t)) ?? tokens.find((t) => /시$/.test(t)) ?? "";
}

/** 네이버 지도 검색 — 별점 · 방문자 리뷰 · 영업시간은 네이버 지도에서 확인 */
export function naverMapUrl(place: Pick<Place, "name" | "address">): string {
  const q = [place.name, districtOf(place.address)].filter(Boolean).join(" ");
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
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
