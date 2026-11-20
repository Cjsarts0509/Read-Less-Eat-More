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
  /** 좌표 출처. "approx" 이면 다음 수집 때 카카오 주소 검색으로 정확한 좌표를 맞춘다 */
  coordSource?: "bookgrid" | "approx" | "kakao";
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
  /** 블로그 글 제목 · 요약의 낱말로 찾은 것 (AI 확인 전) */
  auto?: boolean;
  /** 근거 글 주소 */
  link?: string;
}

export interface BlogPost {
  title: string;
  link: string;
  date: string | null;
}

export interface NaverInfo {
  /** 네이버 블로그 검색 결과 수 (가게 이름 + 동네) */
  blogTotal: number;
  /** 최신 글 중 협찬 · 체험단 표현이 보이는 글 수 (키워드 기준) */
  sponsoredHint?: number;
  /** 검색 결과 수 (가게와 무관한 글 포함, 참고용) */
  rawTotal?: number;
  /** 최신 글 중 이 가게 이야기로 보이는 글 비율 0~1. blogTotal 은 rawTotal × 이 비율 */
  relevance?: number;
  /** 이름이 한두 글자라 흔한 낱말과 섞여 검색 수를 믿기 어려움 (blogTotal 은 관련 글 수만) */
  ambiguous?: boolean;
  /** 데이터 형식 버전 (바뀌면 다시 조회) */
  v?: number;
  /** 최근 30일 안에 올라온 글 수 (최신 10개 기준) */
  recentPosts: number;
  latestPostDate: string | null;
  posts: BlogPost[];
  query: string;
  checkedAt: string;
}

/** 블로그 말고 다른 곳의 리뷰 한 갈래 */
export interface ReviewSourceInfo {
  /** 이 가게 이야기로 보이는 글 수 (어림) */
  total: number;
  /** 대표 글 (최대 3) */
  posts: BlogPost[];
}

/** 네이버 카페 · 다음(티스토리 · 다음 블로그 · 브런치) · 다음 카페 리뷰 */
export interface ExtraReviews {
  naverCafe?: ReviewSourceInfo;
  daumBlog?: ReviewSourceInfo;
  daumCafe?: ReviewSourceInfo;
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
  /** 매장 식사 가능 · 배달 여부 */
  dineIn?: boolean | null;
  delivery?: boolean | null;
  checkedAt: string;
}

/** 영업시간 (평일 기준). 시각은 "HH:MM", 자정을 넘기면 "26:00" 처럼 24 이상 */
export interface HoursInfo {
  open: string | null;
  close: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  lastOrder: string | null;
  /** 정기 휴무 (예: "일요일", "토·일요일", "연중무휴") */
  closedDays: string | null;
  /** 근거 문장 */
  text: string;
  /** blog: 블로그 '영업시간' 검색, web: AI 웹 조사, google: Google 지도 */
  source: "blog" | "web" | "google";
  /** 근거 글 날짜 */
  date: string | null;
  link: string | null;
  checkedAt: string;
}

export type ClosureState = "open" | "closed" | "moved" | "temporarily_closed" | "unknown";
export type WaitLevel = "none" | "short" | "long" | "unknown";
export type Pace = "fast" | "normal" | "slow" | "unknown";

export interface PricePoint {
  item: string;
  price: number;
  date: string | null;
  source: "blog" | "photo" | "web";
}

export interface WebInfo {
  summary: string | null;
  openedOn: string | null;
  hours: string | null;
  /** 웹에서 찾은 영업시간을 나눠 담은 것 */
  breakTime?: string | null;
  lastOrder?: string | null;
  closedDays?: string | null;
  lunch: "yes" | "no" | "unknown";
  closure: ClosureState;
  /** 매장에서 먹을 수 있는가 (no = 배달 · 포장 전문) */
  dineIn?: "yes" | "no" | "unknown";
  menus: string[];
  /** 대표 메뉴 1인 가격 */
  menuPrice?: { item: string; price: number } | null;
  /** 좌석 · 단체석 안내 */
  seats?: string | null;
  /** 네이버 지도 가게 번호 (찾았을 때만) */
  naverPlaceId?: string | null;
  sources: Array<{ title: string; url: string }>;
  checkedAt: string;
}

export interface AiInsight {
  /** 가게를 책 제목처럼 패러디한 제목 (예: "맑은 뚝배기의 고독") */
  bookTitle?: string;
  summary: string;
  signatureMenus: string[];
  priceHint: string | null;
  badges: Badge[];
  lunch: "yes" | "no" | "unknown";
  lunchNote: string | null;
  tags: string[];
  /** 폐업 · 이전 · 휴업 단서 */
  closure?: { state: ClosureState; note: string | null; evidenceDate: string | null };
  /** 웨이팅 */
  waiting?: { level: WaitLevel; bestTime: string | null; note: string | null };
  /** 식사 속도 (회전율) */
  pace?: Pace;
  /** 매장 식사 가능 여부 (no = 배달 · 포장 전문) */
  dineIn?: "yes" | "no" | "unknown";
  /** 분석한 글 중 협찬 · 체험단으로 보이는 글 비율 0~1 */
  adRatio?: number;
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
  /** 차량 모드용으로 모은 곳(도보 반경 밖)을 마지막으로 검색에서 본 날 */
  lastSeen?: string;
  naver: NaverInfo | null;
  google: GoogleInfo | null;
  ai: AiInsight | null;
  lunch: LunchStatus;
  lunchReason: string;
  /** 블로그 · 사진 · 웹에서 모은 메뉴 가격 기록 */
  priceHistory?: PricePoint[];
  /** 최근 가격이 바뀐 메뉴 */
  priceChange?: { item: string; from: number; to: number; date: string | null } | null;
  /** 블로그 글이 적은 새 가게를 웹 검색으로 보강한 정보 */
  web?: WebInfo | null;
  /** 영업시간 (Google > 웹 조사 > 블로그 순으로 믿는다) */
  hours?: HoursInfo | null;
  /** 블로그 '영업시간' 검색을 마지막으로 한 날 (못 찾았어도 기록) */
  hoursCheckedAt?: string;
  /** 배달 · 포장 전문점이라 매장에서 먹을 수 없음 */
  deliveryOnly?: boolean;
  /** AI 예산이 모자라 분석을 미룬 경우 (다음 수집 때 우선 처리) */
  aiPending?: boolean;
  /** 블로그 글 낱말로 찾은 새 소식 (AI 분석 전에도 보이도록) */
  autoBadges?: Badge[];
  /** 블로그 말고 다른 곳의 리뷰 */
  extraReviews?: ExtraReviews;
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
