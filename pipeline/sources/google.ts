/**
 * (선택) Google Places API (New) — 텍스트 검색으로 별점·영업시간·영업 상태를 가져온다.
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * 별점·영업시간 필드는 Enterprise 요금이 붙으므로 GOOGLE_MAX_PER_BRANCH 로 지점마다
 * 인기 상위 N곳만 조회하고, GOOGLE_REFRESH_DAYS 마다 다시 확인한다.
 */
import { haversine } from "../../shared/geo";
import { openAtWeekdayLunch } from "../../shared/insights";
import type { GoogleInfo } from "../../shared/types";
import { fetchJson, type FetchLike } from "../http";

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  googleMapsUri?: string;
  regularOpeningHours?: {
    periods?: Array<{
      open?: { day: number; hour: number; minute: number };
      close?: { day: number; hour: number; minute: number };
    }>;
    weekdayDescriptions?: string[];
  };
}

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.googleMapsUri",
  "places.regularOpeningHours",
].join(",");

/** 이름 비교용: 공백·괄호·'점' 접미사를 뺀다 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[\s·.,'"&-]/g, "")
    .replace(/(본점|점)$/, "");
}

export async function lookupGoogle(
  place: { name: string; address: string; lat: number; lng: number },
  apiKey: string,
  today: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleInfo | null> {
  const data = await fetchJson<{ places?: GooglePlace[] }>(fetchImpl, ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${place.name} ${place.address}`,
      languageCode: "ko",
      regionCode: "KR",
      pageSize: 3,
      locationBias: { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: 200 } },
    }),
  });

  const target = normalizeName(place.name);
  const match = (data.places ?? []).find((g) => {
    if (!g.location) return false;
    const d = haversine({ lat: place.lat, lng: place.lng }, { lat: g.location.latitude, lng: g.location.longitude });
    const name = normalizeName(g.displayName?.text ?? "");
    const similar = name.length > 0 && (name.includes(target) || target.includes(name));
    return d <= 150 && similar;
  });
  if (!match) return null;

  return {
    rating: match.rating ?? null,
    ratingCount: match.userRatingCount ?? null,
    openAtLunch: openAtWeekdayLunch(match.regularOpeningHours?.periods),
    hoursText: match.regularOpeningHours?.weekdayDescriptions ?? null,
    mapsUrl: match.googleMapsUri ?? null,
    businessStatus: match.businessStatus ?? null,
    checkedAt: today,
  };
}
