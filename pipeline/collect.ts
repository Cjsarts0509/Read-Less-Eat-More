/**
 * 모든 지점의 주변 식당을 모아 public/data/places/{지점코드}.json 으로 저장한다.
 *
 *   KAKAO_REST_API_KEY=... NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... ANTHROPIC_API_KEY=... npm run collect
 *
 * 환경 변수 (괄호 안은 기본값)
 *   KAKAO_REST_API_KEY      필수. 카카오 로컬 API
 *   NAVER_CLIENT_ID/SECRET  권장. 네이버 블로그 검색 (인기도 · 최신 글)
 *   ANTHROPIC_API_KEY       권장. Claude 분석 (신규 오픈 · 이벤트 · 시즌 메뉴 · 점심 정보)
 *   CLAUDE_MODEL            (claude-opus-5-5)
 *   GOOGLE_PLACES_API_KEY   선택. 별점 · 영업시간 (GOOGLE_MAX_PER_BRANCH 와 함께)
 *   BRANCHES                쉼표로 지점 코드 제한 (전체)
 *   RADIUS_M (1000) · MAX_PLACES_PER_BRANCH (400) · NAVER_REFRESH_DAYS (3) · NAVER_DAILY_BUDGET (20000)
 *   AI_MAX_PLACES_PER_RUN (300) · AI_BATCH_SIZE (8)
 *   GOOGLE_MAX_PER_BRANCH (키가 있으면 28) · GOOGLE_REFRESH_DAYS (60) · GOOGLE_DAILY_BUDGET (45)
 *     — 지점 36곳 × 28 ≈ 1,000곳, 하루 45건 × 평일 22일 ≈ 990건으로 Google 무료 한도(월 1,000건) 안
 *   WEB_SEARCH_MAX_PER_RUN (20) — 가까운 가게의 영업시간 · 휴무 · 배달 전용 여부를 Claude 웹 검색으로 조사 (0 이면 끔)
 *   WEB_MODEL               웹 조사에 쓸 모델 (CLAUDE_MODEL 과 같음)
 *   DAUM_DAILY_BUDGET (10000) — 다음 블로그 · 카페 리뷰 검색 (카카오 키, 0 이면 끔)
 *   DRIVE_RADIUS_M (6000) · MAX_DRIVE_PLACES (300) — 차량 모드용으로 도보 반경 밖 「맛집」 검색 결과를 더 모은다 (0 이면 끔)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Branch, BranchPlaces, DataIndex } from "../shared/types";
import { collectBranch, DEFAULT_CONFIG, serializeBranchPlaces, type Budget, type CollectConfig, type Deps } from "./core";
import { createClaudeAnalyzer } from "./sources/claude";
import { lookupGoogle } from "./sources/google";
import { searchDaum } from "./sources/daum";
import { collectNearby, geocodeAddress, searchKeywordPlaces } from "./sources/kakao";
import { searchBlog } from "./sources/naver";
import { createWebSearcher } from "./sources/websearch";

const DATA_DIR = path.resolve("public/data");

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} 값이 올바르지 않습니다: ${v}`);
  return Math.floor(n);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 한국 시간 기준 오늘 날짜 */
export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

async function main() {
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (!kakaoKey) {
    console.error("❌ KAKAO_REST_API_KEY 가 없습니다. README 의 'API 키 준비' 를 참고하세요.");
    process.exit(1);
  }
  const naverId = process.env.NAVER_CLIENT_ID;
  const naverSecret = process.env.NAVER_CLIENT_SECRET;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;

  const cfg: CollectConfig = {
    ...DEFAULT_CONFIG,
    radius: envInt("RADIUS_M", DEFAULT_CONFIG.radius),
    maxPlaces: envInt("MAX_PLACES_PER_BRANCH", DEFAULT_CONFIG.maxPlaces),
    naverRefreshDays: envInt("NAVER_REFRESH_DAYS", DEFAULT_CONFIG.naverRefreshDays),
    googleMaxPerBranch: googleKey ? envInt("GOOGLE_MAX_PER_BRANCH", 28) : 0,
    googleRefreshDays: envInt("GOOGLE_REFRESH_DAYS", DEFAULT_CONFIG.googleRefreshDays),
    aiBatchSize: Math.max(1, envInt("AI_BATCH_SIZE", DEFAULT_CONFIG.aiBatchSize)),
    driveRadius: envInt("DRIVE_RADIUS_M", DEFAULT_CONFIG.driveRadius),
    maxDrivePlaces: envInt("MAX_DRIVE_PLACES", DEFAULT_CONFIG.maxDrivePlaces),
  };

  const now = new Date();
  const today = todayKst(now);
  let kakaoCalls = 0;
  const webSearch = anthropicKey
    ? createWebSearcher({ apiKey: anthropicKey, model: process.env.WEB_MODEL || process.env.CLAUDE_MODEL })
    : null;
  const regionCity = new Map<string, string>();

  let daumHoursOff = false;
  const deps: Deps = {
    today,
    nowIso: now.toISOString(),
    kakao: (b) =>
      collectNearby({ apiKey: kakaoKey, center: { lat: b.lat, lng: b.lng }, radius: cfg.radius, onRequest: () => kakaoCalls++ }),
    kakaoDrive: (b, radius) =>
      searchKeywordPlaces({ apiKey: kakaoKey, center: { lat: b.lat, lng: b.lng }, radius, onRequest: () => kakaoCalls++ }),
    naver: naverId && naverSecret ? (q, o) => searchBlog(q, { clientId: naverId, clientSecret: naverSecret }, fetch, o) : null,
    google: googleKey ? (p) => lookupGoogle(p, googleKey, today) : null,
    analyzer: anthropicKey ? createClaudeAnalyzer({ apiKey: anthropicKey, model: process.env.CLAUDE_MODEL }) : null,
    web: webSearch ? (p) => webSearch(p, today, regionCity.get(p.id)) : null,
    reviewSources: [
      ...(naverId && naverSecret
        ? [
            {
              key: "naverCafe" as const,
              pool: "naver" as const,
              search: (q: string) =>
                searchBlog(q, { clientId: naverId, clientSecret: naverSecret }, fetch, { kind: "cafe", sort: "sim", display: 30 }),
            },
          ]
        : []),
      { key: "daumBlog" as const, pool: "daum" as const, search: (q: string) => searchDaum("blog", q, kakaoKey), exclude: /blog\.naver\.com/ },
      { key: "daumCafe" as const, pool: "daum" as const, search: (q: string) => searchDaum("cafe", q, kakaoKey), exclude: /cafe\.naver\.com/ },
    ],
    // 영업시간: 네이버에서 못 찾은 곳을 다음 웹문서로 한 번 더 (한도 초과 · 인증 오류면 이번 수집 동안 끈다)
    daumHours: async (q: string) => {
      if (daumHoursOff) throw Object.assign(new Error("다음 웹문서 검색 꺼짐"), { status: 429 });
      try {
        return await searchDaum("web", q, kakaoKey);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403 || status === 429) {
          daumHoursOff = true;
          console.warn(`⚠️  다음 웹문서 검색을 이번 수집 동안 끕니다 (HTTP ${status})`);
        }
        throw err;
      }
    },
    log: (m) => console.log(m),
  };

  const branchesFile = path.join(DATA_DIR, "branches.json");
  const allBranches = (await readJson<Branch[]>(branchesFile)) ?? [];

  // 좌표가 대략인 지점(엑셀에 없던 본사 등)은 카카오 주소 검색으로 맞춘다
  let fixed = 0;
  for (const b of allBranches.filter((x) => x.coordSource === "approx")) {
    try {
      const geo = await geocodeAddress(kakaoKey, b.address);
      if (geo) {
        console.log(`📍 ${b.label} 좌표 보정: ${b.lat},${b.lng} → ${geo.lat},${geo.lng}`);
        Object.assign(b, geo, { coordSource: "kakao" as const });
        fixed++;
      } else {
        console.warn(`⚠️  ${b.label} 주소로 좌표를 찾지 못해 대략 좌표로 수집합니다: ${b.address}`);
      }
    } catch (err) {
      console.warn(`⚠️  ${b.label} 좌표 보정 실패: ${(err as Error).message}`);
    }
  }
  if (fixed) await writeFile(branchesFile, JSON.stringify(allBranches, null, 2) + "\n", "utf8");
  const only = (process.env.BRANCHES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let branches = only.length ? allBranches.filter((b) => only.includes(b.code) || only.includes(b.name)) : allBranches;
  // 날마다 시작 지점을 돌려 예산을 고르게 나눈다
  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  if (branches.length > 1) {
    const k = dayIndex % branches.length;
    branches = [...branches.slice(k), ...branches.slice(0, k)];
  }

  console.log(`📅 ${today} · 지점 ${branches.length}곳 · 반경 ${cfg.radius}m`);
  console.log(
    `   네이버 ${deps.naver ? "ON" : "OFF"} · Claude ${deps.analyzer ? `ON (${deps.analyzer.model})` : "OFF"} · Google ${cfg.googleMaxPerBranch ? `ON (상위 ${cfg.googleMaxPerBranch})` : "OFF"}`,
  );

  const total: Budget = {
    naver: envInt("NAVER_DAILY_BUDGET", 20000),
    google: envInt("GOOGLE_DAILY_BUDGET", 45),
    ai: envInt("AI_MAX_PLACES_PER_RUN", 300),
    web: anthropicKey ? envInt("WEB_SEARCH_MAX_PER_RUN", 20) : 0,
    daum: envInt("DAUM_DAILY_BUDGET", 10000),
    daumHours: envInt("DAUM_HOURS_DAILY_BUDGET", 8000),
  };
  const remaining = { ...total };

  await mkdir(path.join(DATA_DIR, "places"), { recursive: true });
  const indexFile = path.join(DATA_DIR, "index.json");
  const index: DataIndex = (await readJson<DataIndex>(indexFile)) ?? { generatedAt: null, baselineDate: null, branches: {} };

  let failures = 0;
  for (const [i, branch] of branches.entries()) {
    // 남은 예산을 남은 지점 수로 나눠 한 지점이 다 쓰지 못하게 한다 (안 쓴 몫은 다음 지점으로)
    const left = branches.length - i;
    const share: Budget = {
      naver: Math.ceil(remaining.naver / left),
      google: Math.ceil(remaining.google / left),
      ai: Math.ceil(remaining.ai / left),
      web: Math.ceil((remaining.web ?? 0) / left),
      daum: Math.ceil((remaining.daum ?? 0) / left),
      daumHours: Math.ceil((remaining.daumHours ?? 0) / left),
    };
    const before = { ...share };
    const file = path.join(DATA_DIR, "places", `${branch.code}.json`);
    const prev = await readJson<BranchPlaces>(file);
    for (const p of prev?.places ?? []) regionCity.set(p.id, branch.region);
    try {
      const { data, stats } = await collectBranch(branch, prev, cfg, deps, share);
      await writeFile(file, serializeBranchPlaces(data), "utf8");
      index.branches[branch.code] = { updatedAt: data.generatedAt, count: data.places.length };
      console.log(
        `✅ ${branch.label.padEnd(8)} 카카오 ${stats.kakao} → ${stats.kept}곳 · 네이버 ${stats.naverCalls} · Google ${stats.googleCalls} · AI ${stats.aiAnalyzed}${stats.aiPending ? ` (대기 ${stats.aiPending})` : ""} · 영업시간 ${stats.hoursFound}/${stats.hoursCalls} (다음 ${stats.hoursDaumFound}/${stats.hoursDaumCalls}) · 다른 리뷰 ${stats.extraCalls} · 웹 ${stats.webChecked}${stats.errors ? ` · 오류 ${stats.errors}` : ""}`,
      );
    } catch (err) {
      failures++;
      console.error(`❌ ${branch.label}: ${(err as Error).message}`);
    }
    remaining.naver -= before.naver - share.naver;
    remaining.google -= before.google - share.google;
    remaining.ai -= before.ai - share.ai;
    remaining.web = (remaining.web ?? 0) - ((before.web ?? 0) - (share.web ?? 0));
    remaining.daum = (remaining.daum ?? 0) - ((before.daum ?? 0) - (share.daum ?? 0));
    remaining.daumHours = (remaining.daumHours ?? 0) - ((before.daumHours ?? 0) - (share.daumHours ?? 0));
  }

  index.generatedAt = now.toISOString();
  index.baselineDate ??= today;
  await writeFile(indexFile, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log(
    `\n카카오 요청 ${kakaoCalls}회 · 네이버 ${total.naver - remaining.naver}회 · AI 분석 ${total.ai - remaining.ai}곳 · 웹 검색 ${(total.web ?? 0) - (remaining.web ?? 0)}곳 · 실패 지점 ${failures}`,
  );
  if (failures === branches.length && branches.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
