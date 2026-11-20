import type { CategoryKey } from "./types";

export interface CategoryMeta {
  key: CategoryKey;
  label: string;
  emoji: string;
  /** 지도 점 색 */
  color: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { key: "korean", label: "한식", emoji: "🍚", color: "#C2410C" },
  { key: "chinese", label: "중식", emoji: "🥟", color: "#B91C1C" },
  { key: "japanese", label: "일식", emoji: "🍣", color: "#1D4ED8" },
  { key: "western", label: "양식", emoji: "🍝", color: "#7C3AED" },
  { key: "asian", label: "아시안", emoji: "🍜", color: "#0F766E" },
  { key: "snack", label: "분식", emoji: "🍢", color: "#DB2777" },
  { key: "fastfood", label: "패스트푸드", emoji: "🍔", color: "#CA8A04" },
  { key: "healthy", label: "샐러드·건강식", emoji: "🥗", color: "#15803D" },
  { key: "dessert", label: "카페·디저트", emoji: "🥐", color: "#92400E" },
  { key: "pub", label: "주점", emoji: "🍶", color: "#475569" },
  { key: "etc", label: "기타", emoji: "🍽️", color: "#6B7280" },
];

export const CATEGORY_BY_KEY: Record<CategoryKey, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
) as Record<CategoryKey, CategoryMeta>;

// 세부 분류에 들어 있으면 상위 분류보다 먼저 적용하는 키워드
const KEYWORD_RULES: Array<[RegExp, CategoryKey]> = [
  [/샐러드|포케|비건|채식|건강식/, "healthy"],
  [/햄버거|버거|샌드위치|핫도그|토스트/, "fastfood"],
  [/베트남|태국|인도|아시아|쌀국수|동남아|중동|멕시칸/, "asian"],
  [/떡볶이|김밥|순대|분식/, "snack"],
  [/제과|베이커리|디저트|아이스크림|도넛|와플|케이크|빙수|카페|떡,한과|초콜릿|호떡/, "dessert"],
];

const TOP_LEVEL: Record<string, CategoryKey> = {
  한식: "korean",
  중식: "chinese",
  일식: "japanese",
  양식: "western",
  패밀리레스토랑: "western",
  아시아음식: "asian",
  분식: "snack",
  도시락: "snack",
  패스트푸드: "fastfood",
  치킨: "fastfood",
  샐러드: "healthy",
  간식: "dessert",
  카페: "dessert",
  술집: "pub",
};

/**
 * 카카오 category_name ("음식점 > 한식 > 국밥") 을 화면용 분류로 바꾼다.
 * 술집은 키워드 규칙보다 먼저 판단한다 (점심 영업 판단에 쓰이므로).
 */
export function categorize(kakaoCategoryName: string): { key: CategoryKey; path: string } {
  const parts = kakaoCategoryName
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  const body = parts[0] === "음식점" ? parts.slice(1) : parts;
  const path = body.join(" > ");
  const top = body[0] ?? "";

  if (top === "술집") return { key: "pub", path };

  const detail = body.slice(1).join(" ");
  for (const [re, key] of KEYWORD_RULES) {
    if (re.test(detail)) return { key, path };
  }
  const mapped = TOP_LEVEL[top];
  if (mapped) return { key: mapped, path };
  for (const [re, key] of KEYWORD_RULES) {
    if (re.test(top)) return { key, path };
  }
  return { key: "etc", path };
}
