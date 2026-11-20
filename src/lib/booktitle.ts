import type { CategoryKey, Place } from "../../shared/types";
import { hashString } from "./random";

// AI 제목이 없을 때 쓰는 패러디 책 제목 틀
const PATTERNS = [
  (m: string) => `${m}의 고독`,
  (m: string) => `${m} 미학 개론`,
  (m: string) => `${m} 연대기`,
  (m: string) => `${m}의 철학`,
  (m: string) => `${m}의 뜨거운 서사`,
  (m: string) => `${m} 입문`,
  (m: string) => `${m}의 정석`,
  (m: string) => `${m}에 관하여`,
];

const FALLBACK_MENU: Record<CategoryKey, string> = {
  korean: "한 상 차림",
  chinese: "짜장과 짬뽕",
  japanese: "덮밥",
  western: "파스타",
  asian: "쌀국수",
  snack: "떡볶이",
  fastfood: "버거",
  healthy: "샐러드",
  dessert: "빵",
  pub: "점심 특선",
  etc: "오늘의 메뉴",
};

/** 표지에 쓸 책 제목: Claude 가 지은 제목 → 대표 메뉴로 만든 제목 → 분류로 만든 제목 */
export function bookTitleOf(place: Place): string {
  if (place.ai?.bookTitle) return place.ai.bookTitle;
  const menu =
    place.ai?.signatureMenus[0] ??
    place.categoryPath.split(" > ").at(-1)?.split(",")[0] ??
    FALLBACK_MENU[place.category];
  const pattern = PATTERNS[hashString(place.id) % PATTERNS.length]!;
  return pattern(menu || FALLBACK_MENU[place.category]);
}

/** 가짜 ISBN 꼬리 (지점 코드 + 장소 ID 해시) */
export function isbnOf(branchCode: string, place: Place): string {
  return `978-89-${branchCode}-${String(hashString(place.id) % 100000).padStart(5, "0")}`;
}
