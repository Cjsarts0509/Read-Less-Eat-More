import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_KEY } from "../shared/categories";
import type { Branch, BranchPlaces, CategoryKey, DataIndex } from "../shared/types";
import type { MenuReport, ReviewSummary, WeatherResponse } from "../shared/api";
import { nearestBranch } from "../shared/geo";
import { BookShelf } from "./components/BookShelf";
import { BranchMap } from "./components/BranchMap";
import { CategoryTabs, FilterBar } from "./components/FilterBar";
import { PlaceCard } from "./components/PlaceCard";
import { PlaceDetail } from "./components/PlaceDetail";
import { LibrarianChat } from "./components/LibrarianChat";
import { PublishStage } from "./components/PublishStage";
import { RoomPage } from "./components/RoomPage";
import { WeatherBand } from "./components/WeatherBand";
import { createRoom, fetchMenus, fetchReviews, fetchWeather } from "./lib/api";
import { loadBranches, loadConfig, loadIndex, loadPlaces, todayKst, type AppConfig } from "./lib/data";
import {
  applyFilters,
  countByCategory,
  DEFAULT_FILTERS,
  inhouseTop,
  SORT_LABEL,
  sortPlaces,
  type Ctx,
  type Filters,
  type SortKey,
} from "./lib/filters";
import { sfx } from "./lib/sfx";
import { readStore, writeStore } from "./lib/storage";

type PickView = "shelf" | "map";
type ShelfView = "list" | "map";

const STEPS = [
  { n: 1, label: "지점", title: "전국 지점 책장" },
  { n: 2, label: "장르", title: "오늘의 식사 장르" },
  { n: 3, label: "편찬", title: "오늘의 한 끼 편찬" },
  { n: 4, label: "서가", title: "주변 서가" },
] as const;

/** 미디어 쿼리 상태 */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return on;
}

/** 스와이프로 책장 넘기기에서 뺄 곳 (지도 · 가로 스크롤 · 입력칸 · 팝업) */
const NO_SWIPE = ".no-swipe, .leaflet-container, .shelf__track, input, textarea, select, .sheet";
type PlacesState = { status: "idle" } | { status: "loading" } | { status: "missing" } | { status: "ready"; data: BranchPlaces };

const PAGE = 48;
const params = new URLSearchParams(window.location.search);
const DEMO = params.has("demo");
const ROOM = (params.get("room") ?? "").toUpperCase();

const DEMO_WEATHER: WeatherResponse = {
  available: true,
  day: "",
  tmin: 3,
  tmax: 8,
  sky: "흐림",
  precip: "비",
  pop: 70,
  mood: "rain",
  line: "☔ (샘플) 비 소식 — 가까운 국물 서가부터 펼쳐 둘게요",
  boost: { keywords: ["국밥", "탕", "찌개", "칼국수", "짬뽕", "라멘", "우동", "샤브"], maxWalk: 7, label: "비 오는 날" },
};

const TICKER = [
  "📚 사람은 책을 만들고, 점심은 사람을 만든다",
  "점심은 사람을 만든다 · LUNCH MAKES THE PERSON",
  "완독보다 완뚝! 절판은 있어도 절식은 없다",
  "주의: 3회 이상 재추첨 시 변심 반품 불가 도장이 날인됩니다",
  "신규 오픈 · 이벤트 · 시즌 메뉴는 AI 사서가 매일 아침 입고",
];

function formatDate(iso: string, withWeekday = true): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    ...(withWeekday ? { weekday: "short" as const } : {}),
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

function Marquee() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="marquee" aria-hidden>
      <div className="marquee__track">
        {items.map((t, i) => (
          <span key={i} className="marquee__item">
            {t}
            <span className={i % 2 ? "marquee__dot--t" : "marquee__dot--m"}>{i % 2 ? "●" : "★"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [config, setConfig] = useState<AppConfig>({ ai: false, store: false });
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [weatherOn, setWeatherOn] = useState<boolean>(() => readStore("lmp:weatherOn", true));
  const [menus, setMenus] = useState<Record<string, MenuReport[]>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewSummary>>({});
  const [locating, setLocating] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(() => params.get("b") ?? readStore<string | null>("rlem:branch", null));
  const [pickView, setPickView] = useState<PickView>(() => readStore<PickView>("rlem:pickView", "shelf"));
  const [places, setPlaces] = useState<PlacesState>({ status: "idle" });
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    ...readStore<Partial<Filters>>("rlem:filters", {}),
    query: "",
    news: [],
  }));
  const [tab, setTab] = useState<CategoryKey | "all">("all");
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [sound, setSound] = useState(sfx.enabled);
  const [toast, setToast] = useState<{ msg: string; icon: string; n: number } | null>(null);
  const areaMapRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const today = todayKst();
  // 책장 넘기기: 지점을 이미 골라 둔 사람은 장르부터
  const [step, setStep] = useState<number>(() => (selectedCode ? 2 : 1));
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [oneHand, setOneHand] = useState<boolean>(() => readStore("lmp:onehand", false));
  const [detailId, setDetailId] = useState<string | null>(null);
  const [shelfView, setShelfView] = useState<ShelfView>("list");
  const [chatOpen, setChatOpen] = useState(false);
  const wide = useMedia("(min-width: 1180px)");
  const touch = useRef<{ x: number; y: number; ok: boolean } | null>(null);

  useEffect(() => {
    void loadBranches().then((b) => setBranches(b ?? []));
    void loadIndex().then(setIndex);
    if (!DEMO) void loadConfig().then(setConfig);
  }, []);

  const selected = useMemo(() => branches.find((b) => b.code === selectedCode) ?? null, [branches, selectedCode]);

  useEffect(() => {
    writeStore("rlem:branch", selectedCode);
    const url = new URL(window.location.href);
    if (selectedCode) url.searchParams.set("b", selectedCode);
    else url.searchParams.delete("b");
    window.history.replaceState(null, "", url);
  }, [selectedCode]);

  useEffect(() => writeStore("rlem:pickView", pickView), [pickView]);
  useEffect(() => writeStore("lmp:weatherOn", weatherOn), [weatherOn]);

  // 날씨 띠지 · 직원이 올린 메뉴판
  useEffect(() => {
    setWeather(null);
    setMenus({});
    setReviews({});
    if (!selected) return;
    if (DEMO) {
      setWeather(DEMO_WEATHER);
      return;
    }
    let alive = true;
    void fetchWeather(selected.code).then((w) => alive && setWeather(w));
    return () => {
      alive = false;
    };
  }, [selected]);

  const refreshMenus = useCallback(() => {
    if (selected && config.store && !DEMO) {
      void fetchMenus(selected.code).then(setMenus);
      void fetchReviews(selected.code).then(setReviews);
    }
  }, [selected, config.store]);
  useEffect(refreshMenus, [refreshMenus]);
  useEffect(() => {
    const { walk, lunchOnly, sort } = filters;
    writeStore("rlem:filters", { walk, lunchOnly, sort, budget: filters.budget });
    setVisible(PAGE);
  }, [filters]);

  useEffect(() => {
    if (!selected) {
      setPlaces({ status: "idle" });
      return;
    }
    let alive = true;
    setPlaces({ status: "loading" });
    setTab("all");
    setFocus(null);
    void loadPlaces(selected, DEMO).then((data) => {
      if (alive) setPlaces(data ? { status: "ready", data } : { status: "missing" });
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((msg: string, icon = "✅") => setToast((t) => ({ msg, icon, n: (t?.n ?? 0) + 1 })), []);

  const ctx: Ctx = useMemo(
    () => ({ today, baselineDate: DEMO ? null : (index?.baselineDate ?? null), reviews, menus, budget: filters.budget }),
    [today, index, reviews, menus, filters.budget],
  );
  // 배달 · 포장 전문점은 목록 · 지도 · 뽑기에서 뺀다
  const all = useMemo(() => (places.status === "ready" ? places.data.places.filter((p) => !p.deliveryOnly) : []), [places]);
  const hiddenDelivery = places.status === "ready" ? places.data.places.length - all.length : 0;
  const filtered = useMemo(() => applyFilters(all, filters, ctx), [all, filters, ctx]);
  const counts = useMemo(() => countByCategory(filtered), [filtered]);
  const inTab = useMemo(() => (tab === "all" ? filtered : filtered.filter((p) => p.category === tab)), [filtered, tab]);
  const sorted = useMemo(() => sortPlaces(inTab, filters.sort, ctx), [inTab, filters.sort, ctx]);
  const hasRating = useMemo(() => all.some((p) => p.google?.rating != null), [all]);

  const mapPlaces = useMemo(() => {
    if (!focus || sorted.some((p) => p.id === focus.id)) return sorted;
    const extra = all.find((p) => p.id === focus.id);
    return extra ? [...sorted, extra] : sorted;
  }, [sorted, focus, all]);

  // 지점 목록을 불러오기 전에도 주소 · 저장값으로 고른 지점이 있으면 넘길 수 있게
  const maxStep = selectedCode ? 4 : 1;
  // 지점을 고른 직후(같은 틱)에 넘겨도 최신 한도를 보도록 ref 로 읽는다
  const maxStepRef = useRef(maxStep);
  maxStepRef.current = maxStep;
  const go = useCallback(
    (n: number) => {
      const next = Math.max(1, Math.min(n, maxStepRef.current));
      setStep((cur) => {
        if (next === cur) return cur;
        setDir(next > cur ? "next" : "prev");
        sfx.pageFlip(next);
        return next;
      });
      // 넘긴 페이지의 첫머리로
      window.requestAnimationFrame(() => {
        const top = pagerRef.current?.getBoundingClientRect().top ?? 0;
        if (top < 0 || top > window.innerHeight * 0.5) window.scrollTo({ top: Math.max(0, window.scrollY + top - 8), behavior: "smooth" });
      });
    },
    [],
  );
  useEffect(() => writeStore("lmp:onehand", oneHand), [oneHand]);
  useEffect(() => {
    if (step > maxStep) setStep(maxStep);
  }, [step, maxStep]);

  /** 책장에서 지점을 고르면 다음 장(장르)으로 넘긴다 */
  const pickBranch = useCallback(
    (code: string | null) => {
      setSelectedCode(code);
      if (code) window.setTimeout(() => go(2), 380);
    },
    [go],
  );
  /**
   * 위치로 가장 가까운 지점 찾기.
   * ask: 위치 권한을 묻고 가장 가까운 지점을 열어 다음 장으로 · silent: 이미 허용된 경우에만, 1.5km 안의 다른 지점이면 바꾼다
   */
  const selectedRef = useRef(selectedCode);
  useEffect(() => {
    selectedRef.current = selectedCode;
  }, [selectedCode]);
  const locate = useCallback(
    (mode: "ask" | "silent") => {
      if (!("geolocation" in navigator) || !branches.length) {
        if (mode === "ask") showToast("이 브라우저는 위치를 알려 주지 않아요. 책장에서 골라 주세요.", "⚠️");
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          const near = nearestBranch(branches, { lat: pos.coords.latitude, lng: pos.coords.longitude });
          if (!near) return;
          const dist = near.distance >= 1000 ? `${(near.distance / 1000).toFixed(1)}km` : `${near.distance}m`;
          if (mode === "silent") {
            if (near.distance <= 1500 && near.branch.code !== selectedRef.current) {
              setSelectedCode(near.branch.code);
              showToast(`지금 계신 곳에서 가까운 ${near.branch.label} 서가를 열었어요 (${dist})`, "📍");
            }
            return;
          }
          if (near.distance > 30000) {
            showToast(`근처에 지점이 없어요 · 가장 가까운 곳은 ${near.branch.label} (${dist})`, "📍");
            return;
          }
          showToast(`가장 가까운 ${near.branch.label} 서가를 열었어요 (${dist})`, "📍");
          pickBranch(near.branch.code);
        },
        (err) => {
          setLocating(false);
          if (mode === "ask") showToast(err.code === 1 ? "위치 권한이 꺼져 있어요. 책장에서 골라 주세요." : "위치를 찾지 못했어요. 책장에서 골라 주세요.", "⚠️");
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60_000 },
      );
    },
    [branches, pickBranch, showToast],
  );
  // 처음 온 사람은 위치로 바로 가까운 지점을, 위치를 이미 허용한 사람은 다른 지점 근처에 있을 때만 바꿔 준다
  const autoLocated = useRef(false);
  useEffect(() => {
    if (autoLocated.current || !branches.length || ROOM || DEMO || params.has("b")) return;
    autoLocated.current = true;
    if (!selectedRef.current) {
      locate("ask");
      return;
    }
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((st) => st.state === "granted" && locate("silent"))
      .catch(() => {});
  }, [branches, locate]);

  /** 서가 지도에서 다른 지점 핀을 누르면 지점만 바꾼다 */
  const selectBranch = useCallback((code: string | null) => setSelectedCode(code), []);

  /** 장르를 고르면 다음 장(편찬)으로 */
  const pickGenre = useCallback(
    (k: CategoryKey | "all") => {
      setTab(k);
      window.setTimeout(() => go(3), 260);
    },
    [go],
  );

  const showOnMap = useCallback(
    (id: string) => {
      setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
      setShelfView("map");
      go(4);
      window.setTimeout(() => areaMapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 420);
    },
    [go],
  );

  /** 지도 핀 · 카드 → 상세 팝업 */
  const showCard = useCallback((id: string) => setDetailId(id), []);
  const closeDetail = useCallback(() => setDetailId(null), []);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]!;
    touch.current = { x: t.clientX, y: t.clientY, ok: !(e.target as HTMLElement).closest(NO_SWIPE) };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s0 = touch.current;
    touch.current = null;
    if (!s0?.ok) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - s0.x;
    const dy = t.clientY - s0.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(step + (dx < 0 ? 1 : -1));
  };

  const tabLabel = tab === "all" ? "전체" : CATEGORY_BY_KEY[tab].label;
  const detailPlace = detailId ? (all.find((p) => p.id === detailId) ?? null) : null;
  const bestsellers = inhouseTop(all, ctx);
  const poolDesc = `${filters.walk ? `도보 ${filters.walk}분` : "반경 전체"} · ${tabLabel}${filters.lunchOnly ? " · 점심 영업" : ""}`;
  const branchInfo = selected ? index?.branches[selected.code] : undefined;
  const sorts = (Object.keys(SORT_LABEL) as SortKey[]).filter((s) => s !== "rating" || hasRating);
  const weatherText = weather?.available ? `${weather.precip || weather.sky} · ${weather.tmin}~${weather.tmax}℃ · 강수확률 ${weather.pop ?? "?"}%` : undefined;
  const canRoom = config.store && config.ai && !DEMO;
  const upload = config.store && config.ai && !DEMO && selected ? { branch: selected.code, onDone: refreshMenus } : null;

  const openRoom = async () => {
    if (!selected) return;
    try {
      const { code } = await createRoom(selected.code, `${selected.label} 점심`);
      window.location.href = `/?room=${code}`;
    } catch (err) {
      showToast((err as Error).message, "⚠️");
    }
  };

  const ready = Boolean(selected && places.status === "ready");
  const stepTitle = STEPS[step - 1]!.title;

  /** 2~4장: 서가가 아직 준비되지 않았으면 안내 */
  const notReady = !selected ? (
    <div className="panel empty-panel">
      <p className="h2">👈 먼저 책장에서 지점 책등을 하나 뽑아 주세요</p>
      <p className="muted">걸어서 갈 만한 식당을 모아 오늘의 한 끼를 편찬해 드립니다.</p>
    </div>
  ) : places.status === "loading" ? (
    <div className="panel skeleton" aria-busy="true" />
  ) : places.status === "missing" ? (
    <div className="panel empty-panel">
      <p className="h2">📦 {selected.label} 서가는 아직 입고 전이에요</p>
      <p className="muted">매일 아침 자동으로 식당을 모으고, 관리자가 GitHub Actions 의 「식당 데이터 수집」을 실행하면 바로 채워집니다.</p>
      <a className="bbtn" href={`?demo=1&b=${selected.code}`}>
        샘플 화면 먼저 보기
      </a>
    </div>
  ) : null;

  /** 단계마다 엄지가 닿는 아래쪽 큰 버튼 */
  const dockAction =
    step === 1
      ? selected && { label: `${selected.label}으로 다음 장 ›`, run: () => go(2) }
      : step === 2
        ? ready && { label: `📖 ${tabLabel} ${sorted.length}곳으로 편찬하러 가기 ›`, run: () => go(3) }
        : step === 3
          ? ready && { label: "📖 오늘의 한 끼 편찬하기", run: () => document.querySelector<HTMLButtonElement>(".publish-btn")?.click() }
          : ready && !wide && {
              label: shelfView === "list" ? "🗺️ 지도로 보기" : "📚 목록으로 보기",
              run: () => setShelfView((v) => (v === "list" ? "map" : "list")),
            };

  const stepNav = (
    <nav className="stepnav" aria-label="단계 이동">
      <button type="button" className="stepnav__arrow" onClick={() => go(step - 1)} disabled={step === 1} aria-label="이전 장">
        ‹
      </button>
      <ol className="stepnav__list">
        {STEPS.map((s) => (
          <li key={s.n}>
            <button
              type="button"
              className={`stepnav__btn${step === s.n ? " stepnav__btn--on" : ""}${s.n < step ? " stepnav__btn--done" : ""}`}
              aria-current={step === s.n ? "step" : undefined}
              disabled={s.n > maxStep}
              onClick={() => go(s.n)}
            >
              <span className="stepnav__no">{String(s.n).padStart(2, "0")}</span>
              <span className="stepnav__label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="stepnav__arrow" onClick={() => go(step + 1)} disabled={step >= maxStep} aria-label="다음 장">
        ›
      </button>
      <button
        type="button"
        className={`stepnav__hand${oneHand ? " stepnav__hand--on" : ""}`}
        aria-pressed={oneHand}
        onClick={() => setOneHand((v) => !v)}
        title="한손 모드: 화면을 아래로 내려 엄지로 닿게 해요"
      >
        ✋<span>한손</span>
      </button>
    </nav>
  );

  return (
    <div className={`app${oneHand ? " app--onehand" : ""}${ROOM ? "" : " app--paged"}`}>
      <Marquee />

      <div className="wrap">
        {/* 머리: 에디토리얼 표지 */}
        <header className="panel panel--lg hero">
          <div className="hero__row">
            <div className="hero__pills">
              <span className="pill-green">
                <span className="ping" aria-hidden />
                전국 식도락 출판사 · KDC-LUNCH
              </span>
              <button type="button" className="sticker" onClick={() => showToast("사람은 책을 만들고, 점심은 사람을 만든다!", "🏷️")}>
                🏷️ 교보먹고 에디션
              </button>
            </div>
            <button
              type="button"
              className="bbtn bbtn--sm"
              aria-pressed={sound}
              onClick={() => {
                sfx.setEnabled(!sound);
                setSound(!sound);
                if (!sound) sfx.spinePop();
              }}
            >
              {sound ? "🔊 효과음" : "🔇 효과음"}
            </button>
          </div>

          <div className="hero__main">
            <div>
              <p className="kicker">LUNCH MAKES THE PERSON — 전국 지점 점심 큐레이션</p>
              <h1 className="hero__title">
                점심은 <mark>사람을</mark> 만든다
              </h1>
              <p className="hero__lead">
                “사람은 책을 만들고, 점심은 사람을 만든다.” 오늘 근무하는 지점의 책등을 뽑아 12시의 필독 메뉴를 편찬하세요.
              </p>
            </div>
            <div className="stock" aria-live="polite">
              <div className="stock__head">
                <span>{formatDate(new Date().toISOString())} 식사재고</span>
                <span className="stock__ok">● {places.status === "ready" ? "정상출고" : selected ? "입고 대기" : "대기"}</span>
              </div>
              <div className="stock__branch">
                <b>{selected?.label ?? "지점 미선택"}</b> <span>{selected ? "서가 연결됨" : "책등을 골라 주세요"}</span>
              </div>
              <div className="stock__count">
                {places.status === "ready"
                  ? `보유 도서(식당): ${all.length}권${!DEMO && branchInfo ? ` · ${formatDate(branchInfo.updatedAt, false)} 입고` : ""}`
                  : places.status === "missing"
                    ? "아직 입고 전이에요"
                    : `전국 ${branches.length}개 지점 서가`}
              </div>
            </div>
          </div>
        </header>

        {ROOM && <RoomPage code={ROOM} branches={branches} onToast={showToast} />}

        {!ROOM && DEMO && (
          <div className="banner" role="note">
            <b>샘플 화면</b> — 실제 식당이 아닌 예시 데이터예요. <a href={window.location.pathname}>실제 데이터 보기</a>
          </div>
        )}

        {!ROOM && (
          <>
            <div className="stepbar">{stepNav}</div>

            <div ref={pagerRef} className="pager" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <div key={step} className={`page page--${dir}`} aria-label={`STEP 0${step} ${stepTitle}`}>
                {/* STEP 01 지점 책장 */}
                {step === 1 && (
                  <section className="panel" aria-labelledby="s1">
                    <div className="step-row">
                      <div className="step-head">
                        <span className="step">STEP 01</span>
                        <h2 id="s1" className="h2">
                          전국 지점 책장 <small>지점 선택</small>
                        </h2>
                      </div>
                      <div className="pick-tools">
                      <button type="button" className="bbtn bbtn--sm bbtn--green" onClick={() => locate("ask")} disabled={locating}>
                        📍 {locating ? "위치 찾는 중…" : "내 위치로 찾기"}
                      </button>
                      <div className="seg seg--tight" role="radiogroup" aria-label="지점 고르는 방식">
                        {(["shelf", "map"] as const).map((v) => (
                          <button
                            type="button"
                            key={v}
                            role="radio"
                            aria-checked={pickView === v}
                            className={`seg__btn${pickView === v ? " seg__btn--on" : ""}`}
                            onClick={() => setPickView(v)}
                          >
                            {v === "shelf" ? "📚 책장" : "🗺️ 지도"}
                          </button>
                        ))}
                      </div>
                      </div>
                    </div>
                    <p className="hint">
                      {pickView === "shelf" ? "책등을 누르면 다음 장으로 넘어가요 👆" : "지도에서 지점 핀을 누르세요 📍"}
                    </p>
                    {pickView === "shelf" ? (
                      <BookShelf branches={branches} index={index} selected={selected} onSelect={pickBranch} />
                    ) : (
                      <BranchMap
                        mode="branches"
                        branches={branches}
                        selected={selected}
                        places={[]}
                        walk={0}
                        focus={null}
                        onSelectBranch={pickBranch}
                        onShowCard={() => {}}
                      />
                    )}
                  </section>
                )}

                {/* STEP 02 장르 · 조건 */}
                {step === 2 &&
                  (ready && selected ? (
                    <section className="panel" aria-labelledby="s2">
                      <div className="step-row">
                        <div className="step-head">
                          <span className="step step--green">STEP 02</span>
                          <h2 id="s2" className="h2">
                            오늘의 식사 장르 <small>{selected.label}</small>
                          </h2>
                        </div>
                      </div>
                      <FilterBar filters={filters} onChange={setFilters} />
                      <p className="hint hint--tight">장르를 누르면 바로 편찬 단계로 넘어가요 👇</p>
                      <CategoryTabs active={tab} counts={counts} onChange={pickGenre} />
                      <div className="page-cta">
                        <button type="button" className="bbtn" onClick={() => go(3)}>
                          📖 {tabLabel} {sorted.length}곳으로 편찬하러 가기 ›
                        </button>
                      </div>
                    </section>
                  ) : (
                    notReady
                  ))}

                {/* STEP 03 편찬 (뽑기) */}
                {step === 3 &&
                  (ready && selected ? (
                    <>
                      <WeatherBand weather={weather} branchLabel={selected.label} on={weatherOn} onToggle={setWeatherOn} />
                      <PublishStage
                        key={selected.code}
                        branch={selected}
                        pool={sorted}
                        allPlaces={all}
                        ctx={ctx}
                        poolDesc={poolDesc}
                        onShowOnMap={showOnMap}
                        onToast={showToast}
                        weather={weatherOn ? weather : null}
                        onOpenRoom={canRoom ? openRoom : null}
                      />
                      <div className="page-cta">
                        <button type="button" className="bbtn bbtn--ghost" onClick={() => go(2)}>
                          ‹ 장르 다시 고르기
                        </button>
                        <button type="button" className="bbtn" onClick={() => go(4)}>
                          📚 {sorted.length}곳 서가 전체 보기 ›
                        </button>
                      </div>
                    </>
                  ) : (
                    notReady
                  ))}

                {/* STEP 04 서가 지도 · 목록 */}
                {step === 4 &&
                  (ready && selected ? (
                    <section className="panel" aria-labelledby="s4">
                      <div className="step-row">
                        <div className="step-head">
                          <span className="step step--navy">STEP 04</span>
                          <h2 id="s4" className="h2">
                            {selected.label} 주변 서가 <small>{sorted.length}권</small>
                          </h2>
                        </div>
                        <div className="shelf-tools">
                          {!wide && (
                            <div className="seg seg--tight" role="radiogroup" aria-label="보기 방식">
                              {(["list", "map"] as const).map((v) => (
                                <button
                                  type="button"
                                  key={v}
                                  role="radio"
                                  aria-checked={shelfView === v}
                                  className={`seg__btn${shelfView === v ? " seg__btn--on" : ""}`}
                                  onClick={() => setShelfView(v)}
                                >
                                  {v === "list" ? "📚 목록" : "🗺️ 지도"}
                                </button>
                              ))}
                            </div>
                          )}
                          <label className="select">
                            <span className="sr-only">정렬</span>
                            <select
                              value={filters.sort}
                              onChange={(e) => {
                                sfx.tagClick();
                                setFilters({ ...filters, sort: e.target.value as SortKey });
                              }}
                            >
                              {sorts.map((s) => (
                                <option key={s} value={s}>
                                  {SORT_LABEL[s]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                      <p className="hint">
                        {tabLabel} · {filters.walk ? `도보 ${filters.walk}분` : "반경 전체"}
                        {filters.lunchOnly ? " · 점심 영업" : ""}
                        {hiddenDelivery > 0 && ` · 배달 · 포장 전문 ${hiddenDelivery}곳 제외`}
                        {" · "}
                        <button type="button" className="linkish" onClick={() => go(2)}>
                          조건 바꾸기
                        </button>
                      </p>
                      {bestsellers.length > 0 && (
                        <div className="bestsellers no-swipe" aria-label="사내 베스트셀러">
                          <span className="bestsellers__label">🏆 사내 베스트셀러</span>
                          {bestsellers.map((p, i) => (
                            <button type="button" key={p.id} className="bestsellers__item" onClick={() => showCard(p.id)}>
                              <b>{i + 1}</b> {p.name} <span>★{reviews[p.id]!.avg.toFixed(1)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="shelf-area">
                        {(wide || shelfView === "map") && (
                          <div ref={areaMapRef} className="shelf-area__map">
                            <BranchMap
                              mode="area"
                              branches={branches}
                              selected={selected}
                              places={mapPlaces}
                              walk={filters.walk}
                              focus={focus}
                              onSelectBranch={selectBranch}
                              onShowCard={showCard}
                            />
                          </div>
                        )}

                        {(wide || shelfView === "list") && (
                          <div className="shelf-area__list">
                            {sorted.length === 0 ? (
                              <p className="empty">조건에 맞는 식당이 없어요. 도보 거리를 늘리거나 장르를 바꿔 보세요.</p>
                            ) : (
                              <div className="grid">
                                {sorted.slice(0, visible).map((p) => (
                                  <PlaceCard key={p.id} place={p} ctx={ctx} highlighted={focus?.id === p.id} onOpen={showCard} />
                                ))}
                              </div>
                            )}
                            {sorted.length > visible && (
                              <button type="button" className="bbtn more" onClick={() => setVisible((v) => v + PAGE)}>
                                {sorted.length - visible}권 더 꺼내 보기
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  ) : (
                    notReady
                  ))}
              </div>
            </div>
          </>
        )}

        <footer className="footer">
          <p className="footer__motto">점심은 사람을 만든다 · Lunch Makes the Person</p>
          <p>
            식당 목록 <b>카카오 로컬</b> · 블로그 리뷰 <b>네이버 검색</b> · 책 제목·사서평·새 소식 <b>Claude</b>
            {all.some((p) => p.google) && (
              <>
                {" "}
                · 평점·영업시간 <b>Google</b>
              </>
            )}{" "}
            · 지도 <b>OpenStreetMap</b>
          </p>
          <p className="muted">
            AI 사서평 · 새 소식 · 영업시간은 블로그 글과 웹 검색으로 자동 정리되어 틀릴 수 있어요. 방문 전 지도 앱에서 한 번 더 확인해 주세요.
          </p>
        </footer>
      </div>

      {/* 휴대폰: 엄지가 닿는 아래쪽 독 (큰 버튼 + 단계 이동 + 한손 모드) */}
      {!ROOM && (
        <div className="dock">
          {dockAction && (
            <button type="button" className="dock__action" onClick={dockAction.run}>
              {dockAction.label}
            </button>
          )}
          {stepNav}
        </div>
      )}

      {/* AI 사서: 떠 있는 버튼 → 시트 */}
      {!ROOM && ready && selected && config.ai && !DEMO && (
        <>
          <button type="button" className="fab" onClick={() => setChatOpen(true)} aria-label="AI 사서에게 물어보기">
            💬<span>사서</span>
          </button>
          {chatOpen && (
            <div className="sheet-backdrop" onClick={() => setChatOpen(false)}>
              <div className="sheet sheet--chat no-swipe" role="dialog" aria-modal="true" aria-label="AI 사서" onClick={(e) => e.stopPropagation()}>
                <div className="sheet__grip" aria-hidden />
                <header className="sheet__head">
                  <h2 className="sheet__title">💬 AI 사서에게 물어보기</h2>
                  <button type="button" className="sheet__close" onClick={() => setChatOpen(false)} aria-label="닫기">
                    ✕
                  </button>
                </header>
                <div className="sheet__body">
                  <LibrarianChat
                    branch={selected}
                    candidates={sorted.length ? sorted : all}
                    weatherText={weatherText}
                    timeBudget={filters.timeBudget}
                    onShowOnMap={(id) => {
                      setChatOpen(false);
                      showCard(id);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {detailPlace && selected && (
        <PlaceDetail
          place={detailPlace}
          ctx={ctx}
          branch={selected.code}
          menus={menus[detailPlace.id]}
          upload={upload}
          live={config.ai && config.store && !DEMO}
          canReview={config.store && !DEMO}
          onReviewSaved={(id, s) => setReviews((r) => (s ? { ...r, [id]: s } : r))}
          onClose={closeDetail}
          onShowOnMap={showOnMap}
        />
      )}

      {toast && (
        <div key={toast.n} className="toast" role="status">
          <span aria-hidden>{toast.icon}</span> {toast.msg}
        </div>
      )}
    </div>
  );
}
