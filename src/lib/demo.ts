/**
 * 샘플 화면용 가짜 데이터. 실제 식당이 아니며, ?demo=1 일 때만 쓴다.
 * API 키를 넣기 전에도 화면 구성을 확인할 수 있게 하려는 용도.
 */
import { walkMinutes } from "../../shared/geo";
import { computeLunch } from "../../shared/insights";
import type { Badge, Branch, BranchPlaces, CategoryKey, Place } from "../../shared/types";
import { hashString, mulberry32 } from "./random";

const TEMPLATES: Array<[CategoryKey, string, string, string[], string]> = [
  ["korean", "한식 > 국밥", "든든 국밥", ["수육국밥", "순대국", "모둠수육"], "맑은 뚝배기의 고독"],
  ["korean", "한식 > 찌개,전골", "엄마손 찌개", ["김치찌개", "제육볶음", "계란말이"], "김치찌개 순수이성비판"],
  ["korean", "한식 > 냉면", "평양 면옥", ["물냉면", "비빔냉면", "만두"], "메밀면의 시간과 존재"],
  ["korean", "한식 > 육류,고기", "숯불 정육식당", ["점심 불고기", "된장찌개", "육회비빔밥"], "불고기의 뜨거운 서사"],
  ["korean", "한식 > 한정식", "소반 정식", ["제철 정식", "보리굴비", "떡갈비"], "한 상 차림의 품격"],
  ["chinese", "중식 > 중국요리", "홍매 반점", ["짬뽕", "탕수육", "볶음밥"], "짬뽕 국물의 변증법"],
  ["chinese", "중식 > 딤섬", "딤딤섬", ["새우 하가우", "샤오롱바오", "우육면"], "딤섬 한 판의 우주"],
  ["japanese", "일식 > 돈까스,우동", "바삭 돈카츠", ["로스카츠", "히레카츠", "카레우동"], "돈카츠 미학 개론"],
  ["japanese", "일식 > 초밥,롤", "오늘의 초밥", ["점심 초밥 세트", "연어덮밥", "미니우동"], "초밥 열두 점의 정석"],
  ["japanese", "일식 > 라멘", "멘야 하나", ["돈코츠 라멘", "츠케멘", "차슈덮밥"], "라멘의 구조주의"],
  ["western", "양식 > 이탈리안", "트라토리아 몰토", ["봉골레", "마르게리타", "리조또"], "봉골레의 낭만주의"],
  ["western", "양식 > 스테이크", "그릴 하우스", ["런치 스테이크", "버섯 수프", "샐러드"], "스테이크 굽기의 기술"],
  ["asian", "아시아음식 > 베트남음식", "포 사이공", ["양지 쌀국수", "분짜", "반미"], "쌀국수 호로록 에세이"],
  ["asian", "아시아음식 > 인도음식", "마살라 키친", ["버터치킨 커리", "난", "라씨"], "커리 향 여행기"],
  ["snack", "분식 > 떡볶이", "골목 떡볶이", ["떡볶이", "튀김", "김밥"], "떡볶이 시학"],
  ["snack", "분식 > 김밥", "한 줄 김밥", ["참치김밥", "라볶이", "쫄면"], "김밥 한 줄의 단편선"],
  ["fastfood", "패스트푸드 > 햄버거", "버거 스탠드", ["치즈버거", "감자튀김", "밀크셰이크"], "수제버거 자유론"],
  ["healthy", "샐러드", "그린 보울", ["닭가슴살 샐러드", "포케", "그릭요거트"], "채소의 가벼운 철학"],
  ["dessert", "간식 > 제과,베이커리", "아침 빵집", ["소금빵", "샌드위치", "커피"], "소금빵 산문집"],
  ["pub", "술집 > 일본식주점", "이자카야 달", ["점심 사케동", "가라아게", "하이볼"], "낮의 이자카야"],
  ["etc", "샤브샤브", "채소 샤브", ["월남쌈 샤브", "칼국수", "죽"], "샤브샤브 삼부작"],
];

const LUNCH_NOTES = ["11:30 오픈, 12시엔 줄 서요", "브레이크타임 15~17시", "점심엔 회전이 빨라요", null, null];
const TAGS = ["혼밥", "단체석", "빠른 회전", "웨이팅", "가성비", "조용함", "포장"];

export function makeDemoPlaces(branch: Branch, today = new Date().toISOString().slice(0, 10)): BranchPlaces {
  const rng = mulberry32(hashString(branch.code));
  const places: Place[] = [];
  const count = 56;
  for (let i = 0; i < count; i++) {
    const [category, path, base, menus, bookTitle] = TEMPLATES[i % TEMPLATES.length]!;
    const angle = rng() * Math.PI * 2;
    const dist = 60 + Math.sqrt(rng()) * 900;
    const lat = branch.lat + (dist * Math.sin(angle)) / 111_320;
    const lng = branch.lng + (dist * Math.cos(angle)) / (111_320 * Math.cos((branch.lat * Math.PI) / 180));
    const blogTotal = Math.floor(rng() ** 2 * 3000);
    const badges: Badge[] = [];
    const roll = rng();
    const daysAgo = (d: number) => new Date(Date.parse(today) - d * 86_400_000).toISOString().slice(0, 10);
    if (roll < 0.1) badges.push({ type: "new_open", label: "이달 오픈", detail: "새로 문 열었다는 후기가 있어요 (샘플)", evidenceDate: daysAgo(8) });
    else if (roll < 0.2) badges.push({ type: "event", label: "리뷰 이벤트", detail: "리뷰 쓰면 음료 증정 (샘플)", evidenceDate: daysAgo(5) });
    else if (roll < 0.3) badges.push({ type: "seasonal_menu", label: "겨울 메뉴 개시", detail: "계절 한정 메뉴가 나왔어요 (샘플)", evidenceDate: daysAgo(12) });
    if (rng() < 0.25) badges.push({ type: "lunch_special", label: "점심 특선", detail: "평일 점심 세트 (샘플)", evidenceDate: null });

    const place: Place = {
      id: `demo-${branch.code}-${i}`,
      name: `${base} ${i >= TEMPLATES.length ? `${Math.floor(i / TEMPLATES.length) + 1}호점 ` : ""}(샘플)`,
      category,
      categoryPath: path,
      address: branch.address.split(",")[0]!,
      phone: null,
      lat,
      lng,
      distance: Math.round(dist),
      walkMin: walkMinutes(dist),
      kakaoUrl: "",
      firstSeen: today,
      naver: {
        blogTotal,
        recentPosts: Math.floor(rng() * 12),
        latestPostDate: daysAgo(Math.floor(rng() * 20)),
        posts: [],
        query: base,
        checkedAt: today,
      },
      google:
        rng() < 0.6
          ? {
              rating: Math.round((3.6 + rng() * 1.3) * 10) / 10,
              ratingCount: Math.floor(rng() * 400),
              openAtLunch: category === "pub" ? rng() < 0.3 : true,
              hoursText: null,
              mapsUrl: null,
              businessStatus: "OPERATIONAL",
              checkedAt: today,
            }
          : null,
      ai: {
        bookTitle,
        summary: `${menus[0]}이(가) 대표인 ${path.split(" > ").at(-1)} 집 (샘플 설명)`,
        signatureMenus: menus,
        priceHint: ["9천원대", "1만~1.3만원", "1.5만원 안팎"][Math.floor(rng() * 3)]!,
        badges,
        lunch: category === "pub" ? "no" : "yes",
        lunchNote: LUNCH_NOTES[Math.floor(rng() * LUNCH_NOTES.length)] ?? null,
        tags: TAGS.filter(() => rng() < 0.3).slice(0, 3),
        analyzedAt: today,
        model: "demo",
        sourceLatestPost: today,
      },
      lunch: "unknown",
      lunchReason: "",
    };
    const lunch = computeLunch(place);
    place.lunch = lunch.status;
    place.lunchReason = lunch.reason;
    places.push(place);
  }
  places.sort((a, b) => a.distance - b.distance);
  return { branch: branch.code, generatedAt: new Date().toISOString(), radius: 1000, sources: ["demo"], places };
}
