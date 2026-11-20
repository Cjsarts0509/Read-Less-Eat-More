// 프론트엔드 · 워커 · 수집 파이프라인이 함께 쓰는 데이터 형식

export interface Branch {
  /** 수불처 코드 (예: "001") */
  code: string;
  /** 지점명 (예: "광화문") */
  name: string;
  /** 화면 표시명 (예: "광화문점") */
  label: string;
  /** 사업단 (예: "강북사업단") */
  division: string;
  /** 시·도 (예: "서울") */
  region: string;
  address: string;
  lat: number;
  lng: number;
}

export type CategoryKey =
  | "korean"
  | "chinese"
  | "japanese"
  | "western"
  | "asian"
  | "snack"
  | "fastfood"
  | "healthy"
  | "dessert"
  | "pub"
  | "etc";

/**
 * 점심(평일 12~13시) 영업 판단 결과
 * - open: 영업시간으로 확인됨
 * - likely: 리뷰상 점심 영업으로 보임
 * - unknown: 정보 없음 (일반 음식점이라 대체로 영업)
 * - unlikely: 저녁 위주이거나 점심 시간에 닫음
 * - closed: 임시 휴업 등
 */
export type LunchStatus = "open" | "likely" | "unknown" | "unlikely" | "closed";

export type BadgeType =
  | "new_open"
  | "event"
  | "seasonal_menu"
  | "new_menu"
  | "discount"
  | "lunch_special";

export interface Badge {
  type: BadgeType;
  /** 짧은 표시 문구 (예: "11월 오픈") */
  label: string;
  /** 근거 요약 */
  detail: string;
  /** 근거가 된 리뷰 날짜 YYYY-MM-DD */
  evidenceDate: string | null;
}

export interface BlogPost {
  title: string;
  link: string;
  date: string | null;
}

export interface NaverInfo {
  /** 네이버 블로그 검색 결과 수 (가게 이름 + 동네) */
  blogTotal: number;
  /** 최근 30일 안에 올라온 글 수 (최신 10개 기준) */
  recentPosts: number;
  latestPostDate: string | null;
  posts: BlogPost[];
  query: string;
  checkedAt: string;
}

export interface GoogleInfo {
  rating: number | null;
  ratingCount: number | null;
  /** 평일 12~13시 영업 여부 (영업시간 기준) */
  openAtLunch: boolean | null;
  hoursText: string[] | null;
  mapsUrl: string | null;
  businessStatus: string | null;
  checkedAt: string;
}

export interface AiInsight {
  summary: string;
  signatureMenus: string[];
  priceHint: string | null;
  badges: Badge[];
  lunch: "yes" | "no" | "unknown";
  lunchNote: string | null;
  tags: string[];
  analyzedAt: string;
  model: string;
  /** 분석에 쓴 블로그 글 중 가장 최근 글 날짜 — 이후 새 글이 쌓이면 다시 분석 */
  sourceLatestPost: string | null;
}

export interface Place {
  /** 카카오 장소 ID */
  id: string;
  name: string;
  category: CategoryKey;
  /** 예: "한식 > 국밥" */
  categoryPath: string;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
  /** 지점에서 직선거리 (m) */
  distance: number;
  /** 예상 도보 시간 (분) */
  walkMin: number;
  kakaoUrl: string;
  /** 이 파이프라인이 처음 본 날짜 YYYY-MM-DD */
  firstSeen: string;
  naver: NaverInfo | null;
  google: GoogleInfo | null;
  ai: AiInsight | null;
  lunch: LunchStatus;
  lunchReason: string;
  /** AI 예산이 모자라 분석을 미룬 경우 (다음 수집 때 우선 처리) */
  aiPending?: boolean;
}

export interface BranchPlaces {
  branch: string;
  generatedAt: string;
  radius: number;
  sources: string[];
  places: Place[];
}

export interface DataIndex {
  generatedAt: string | null;
  /** 첫 수집일. 이 날 이후 처음 보인 가게만 '지도 신규'로 표시 */
  baselineDate: string | null;
  branches: Record<string, { updatedAt: string; count: number }>;
}
