/**
 * 심심풀이: 오늘의 점심 운세 · 오늘의 밸런스 게임.
 * 운세는 날짜 + 사람(브라우저 키)으로 정해져 하루 동안 같다. 밸런스 게임은 날짜로 질문이 정해진다.
 */
import type { CategoryKey } from "./types";

export const BALANCE_QUESTIONS: Array<{ q: string; a: string; b: string }> = [
  { q: "중식의 영원한 숙제", a: "🍜 짜장면", b: "🌶️ 짬뽕" },
  { q: "탕수육은", a: "🫗 부먹", b: "🥢 찍먹" },
  { q: "국밥에 밥은", a: "🍚 처음부터 말아서", b: "🥄 따로 떠서" },
  { q: "오늘 점심 줄 서기", a: "⏳ 맛집이면 30분도", b: "🏃 바로 앉는 곳" },
  { q: "회의 전 점심", a: "🥗 가볍게", b: "🍖 든든하게" },
  { q: "냉면은", a: "🧊 물냉면", b: "🔥 비빔냉면" },
  { q: "돈가스는", a: "🇯🇵 두툼한 일식", b: "🇰🇷 얇은 경양식" },
  { q: "점심 메뉴 정하기", a: "🎲 뽑기에 맡긴다", b: "🧐 내가 고른다" },
  { q: "김치찌개 vs 된장찌개", a: "🥘 김치찌개", b: "🍲 된장찌개" },
  { q: "후식은", a: "☕ 아이스 아메리카노", b: "🍦 달달한 디저트" },
  { q: "혼밥 자리는", a: "🪟 창가 바 자리", b: "🪑 구석 2인석" },
  { q: "라면에 밥을", a: "🍚 말아 먹는다", b: "🙅 국물만" },
  { q: "제육볶음 vs 불고기", a: "🌶️ 제육", b: "🍯 불고기" },
  { q: "비 오는 날 점심", a: "🍜 칼국수", b: "🥞 파전" },
  { q: "삼겹살 점심 특선", a: "🥓 당연히 간다", b: "😵 오후가 걱정" },
  { q: "초밥은", a: "🍣 연어", b: "🐟 광어" },
  { q: "점심 산책", a: "🚶 먼 맛집까지 걷기", b: "🏢 건물 안에서 해결" },
  { q: "카레는", a: "🍛 일본식", b: "🫓 인도식" },
  { q: "만두는", a: "🥟 찐만두", b: "🍳 군만두" },
  { q: "수제비 vs 칼국수", a: "🥣 수제비", b: "🍜 칼국수" },
  { q: "점심시간 마지막 10분", a: "☕ 카페에서 수다", b: "😴 책상에서 쪽잠" },
  { q: "마라탕 맵기", a: "🔥 3단계 이상", b: "🙂 0~1단계" },
  { q: "햄버거 세트 음료", a: "🥤 콜라", b: "🧃 사이다/제로" },
  { q: "회식 다음 날 점심", a: "🍲 해장국", b: "🍕 기름진 걸로 해장" },
  { q: "쌀국수 고기", a: "🐄 양지", b: "🐂 차돌" },
  { q: "비빔밥은", a: "🔥 돌솥", b: "🥣 그냥 대접" },
  { q: "칼국수 김치", a: "🥬 겉절이", b: "🫙 익은 김치" },
  { q: "샐러드 점심", a: "🥗 건강해지는 기분", b: "🍞 오후 3시에 배고픔" },
  { q: "새로 생긴 가게", a: "🆕 무조건 도전", b: "⭐ 후기 쌓이면 간다" },
  { q: "점심 메뉴 결정권", a: "👑 막내가 정한다", b: "🧓 선배가 정한다" },
];

/** 날짜(YYYY-MM-DD)로 고르는 오늘의 질문 */
export function balanceOfDay(day: string): { index: number; q: string; a: string; b: string } {
  const days = Math.floor(Date.parse(day + "T00:00:00Z") / 86_400_000);
  const index = ((days % BALANCE_QUESTIONS.length) + BALANCE_QUESTIONS.length) % BALANCE_QUESTIONS.length;
  return { index, ...BALANCE_QUESTIONS[index]! };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const LINES = [
  "국물 한 숟갈이 오후 결재를 부릅니다",
  "새로 문 연 가게에서 귀인을 만납니다",
  "오늘은 걸음 수만큼 맛이 깊어집니다",
  "매운맛이 쌓인 스트레스를 이깁니다",
  "줄 선 집에 오늘의 정답이 있습니다",
  "혼밥 운이 좋습니다. 창가 자리를 노리세요",
  "가성비의 신이 당신 편입니다",
  "디저트 배는 따로 있다는 걸 증명할 날",
  "누군가 오늘 커피를 삽니다. 먼저 일어나지 마세요",
  "처음 가 보는 골목에 숨은 명작이 있습니다",
  "익숙한 단골집이 오늘따라 더 맛있습니다",
  "점심 특선을 놓치면 후회합니다",
  "밥 한 공기 추가가 오후의 집중력을 살립니다",
  "동료의 추천을 믿으세요. 오늘은 맞습니다",
  "11시 50분 출발이 모든 웨이팅을 이깁니다",
  "오늘의 점심이 오후 회의를 부드럽게 만듭니다",
  "볶음보다 찜, 튀김보다 구이가 길합니다",
  "면이 당긴다면 그건 운명입니다",
  "오늘 고른 메뉴가 이번 주 최고의 한 끼가 됩니다",
  "가벼운 점심이 퇴근길을 가볍게 합니다",
];

const LUCKY_GENRES: CategoryKey[] = ["korean", "chinese", "japanese", "western", "asian", "snack", "fastfood", "healthy"];
const DIRECTIONS = ["북쪽", "북동쪽", "동쪽", "남동쪽", "남쪽", "남서쪽", "서쪽", "북서쪽"];

export interface LunchFortune {
  line: string;
  genre: CategoryKey;
  direction: string;
  /** 행운의 출발 시각 "11:52" */
  departAt: string;
  /** 오늘의 점수 70~100 */
  score: number;
}

/** 오늘의 점심 운세 (날짜 + 사람마다 하루 동안 같다) */
export function fortuneOf(day: string, who: string): LunchFortune {
  const h = hash(`${day}:${who}`);
  const pick = <T>(xs: T[], salt: number) => xs[hash(`${h}:${salt}`) % xs.length]!;
  const minute = 40 + (hash(`${h}:t`) % 25); // 11:40 ~ 12:04
  const departAt = minute < 60 ? `11:${String(minute).padStart(2, "0")}` : `12:${String(minute - 60).padStart(2, "0")}`;
  return {
    line: pick(LINES, 1),
    genre: pick(LUCKY_GENRES, 2),
    direction: pick(DIRECTIONS, 3),
    departAt,
    score: 70 + (hash(`${h}:s`) % 31),
  };
}
