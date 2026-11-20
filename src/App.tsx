import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_KEY } from "../shared/categories";
import type { Branch, BranchPlaces, CategoryKey, DataIndex } from "../shared/types";
import type { MenuReport, WeatherResponse } from "../shared/api";
import { BookShelf } from "./components/BookShelf";
import { BranchMap } from "./components/BranchMap";
import { CategoryTabs, FilterBar } from "./components/FilterBar";
import { PlaceCard } from "./components/PlaceCard";
import { LibrarianChat } from "./components/LibrarianChat";
import { PublishStage } from "./components/PublishStage";
import { RoomPage } from "./components/RoomPage";
import { WeatherBand } from "./components/WeatherBand";
import { createRoom, fetchMenus, fetchWeather } from "./lib/api";
import { loadBranches, loadConfig, loadIndex, loadPlaces, todayKst, type AppConfig } from "./lib/data";
import { applyFilters, countByCategory, DEFAULT_FILTERS, SORT_LABEL, sortPlaces, type Ctx, type Filters, type SortKey } from "./lib/filters";
import { sfx } from "./lib/sfx";
import { readStore, writeStore } from "./lib/storage";

type PickView = "shelf" | "map";
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
  const [highlight, setHighlight] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [sound, setSound] = useState(sfx.enabled);
  const [toast, setToast] = useState<{ msg: string; icon: string; n: number } | null>(null);
  const areaMapRef = useRef<HTMLDivElement>(null);
  const today = todayKst();

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
    if (selected && config.store && !DEMO) void fetchMenus(selected.code).then(setMenus);
  }, [selected, config.store]);
  useEffect(refreshMenus, [refreshMenus]);
  useEffect(() => {
    const { walk, lunchOnly, sort } = filters;
    writeStore("rlem:filters", { walk, lunchOnly, sort });
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

  const ctx: Ctx = useMemo(() => ({ today, baselineDate: DEMO ? null : (index?.baselineDate ?? null) }), [today, index]);
  const all = places.status === "ready" ? places.data.places : [];
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

  const selectBranch = useCallback((code: string | null) => setSelectedCode(code), []);

  const showOnMap = useCallback((id: string) => {
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    areaMapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const showCard = useCallback(
    (id: string) => {
      const idx = sorted.findIndex((p) => p.id === id);
      if (idx < 0) {
        setTab("all");
        setFilters((f) => ({ ...f, walk: 0, lunchOnly: false, query: "", news: [] }));
      } else if (idx >= visible) {
        setVisible(idx + PAGE);
      }
      setHighlight(id);
      window.setTimeout(() => document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2600);
    },
    [sorted, visible],
  );

  const tabLabel = tab === "all" ? "전체 랜덤" : CATEGORY_BY_KEY[tab].label;
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

  return (
    <div className="app">
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
              {sound ? "🔊 책장 효과음 ON" : "🔇 책장 효과음 OFF"}
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
        {/* STEP 01 지점 책장 */}
        <section className="panel" aria-labelledby="s1">
          <div className="step-row">
            <div className="step-head">
              <span className="step">STEP 01</span>
              <h2 id="s1" className="h2">
                전국 지점 책장 <small>(지점 선택)</small>
              </h2>
            </div>
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
          <p className="hint">{pickView === "shelf" ? "책등을 클릭하면 해당 지점 서가가 열립니다 👆" : "지도에서 지점 핀을 누르세요 📍"}</p>
          {pickView === "shelf" ? (
            <BookShelf branches={branches} index={index} selected={selected} onSelect={selectBranch} />
          ) : (
            <BranchMap
              mode="branches"
              branches={branches}
              selected={selected}
              places={[]}
              walk={0}
              focus={null}
              onSelectBranch={selectBranch}
              onShowCard={() => {}}
            />
          )}
        </section>

        {!selected && (
          <div className="panel empty-panel">
            <p className="h2">👆 먼저 책장에서 지점 책등을 하나 뽑아 주세요</p>
            <p className="muted">걸어서 갈 만한 식당을 모아 오늘의 한 끼를 편찬해 드립니다.</p>
          </div>
        )}
        {selected && places.status === "loading" && <div className="panel skeleton" aria-busy="true" />}
        {selected && places.status === "missing" && (
          <div className="panel empty-panel">
            <p className="h2">📦 {selected.label} 서가는 아직 입고 전이에요</p>
            <p className="muted">
              매일 아침 자동으로 식당을 모으고, 관리자가 GitHub Actions 의 「식당 데이터 수집」을 실행하면 바로 채워집니다.
            </p>
            <a className="bbtn" href={`?demo=1&b=${selected.code}`}>
              샘플 화면 먼저 보기
            </a>
          </div>
        )}

        {selected && places.status === "ready" && (
          <>
            {/* STEP 02 장르 책갈피 */}
            <section className="panel" aria-labelledby="s2">
              <div className="step-row">
                <div className="step-head">
                  <span className="step step--green">STEP 02</span>
                  <h2 id="s2" className="h2">
                    오늘의 식사 장르 책갈피
                  </h2>
                </div>
                <span className="count-pill">
                  선택된 장르: {tabLabel} ({sorted.length}권)
                </span>
              </div>
              <CategoryTabs active={tab} counts={counts} onChange={setTab} />
              <FilterBar filters={filters} onChange={setFilters} />
            </section>

            <WeatherBand weather={weather} branchLabel={selected.label} on={weatherOn} onToggle={setWeatherOn} />

            {/* STEP 03 편찬 */}
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

            {config.ai && !DEMO && (
              <div className="panel">
                <LibrarianChat
                  branch={selected}
                  candidates={sorted.length ? sorted : all}
                  weatherText={weatherText}
                  timeBudget={filters.timeBudget}
                  onShowOnMap={showOnMap}
                />
              </div>
            )}

            {/* STEP 04 서가 지도 · 목록 */}
            <section className="panel" aria-labelledby="s4">
              <div className="step-row">
                <div className="step-head">
                  <span className="step step--navy">STEP 04</span>
                  <h2 id="s4" className="h2">
                    {selected.label} 주변 서가 <small>{sorted.length}권</small>
                  </h2>
                </div>
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
              <p className="hint">
                📍 {selected.address}
                {filters.walk ? ` · 점선 안이 도보 ${filters.walk}분 거리` : ""}
              </p>
              <div ref={areaMapRef}>
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

              {sorted.length === 0 ? (
                <p className="empty">조건에 맞는 식당이 없어요. 도보 거리를 늘리거나 책갈피를 바꿔 보세요.</p>
              ) : (
                <div className="grid">
                  {sorted.slice(0, visible).map((p) => (
                    <PlaceCard
                      key={p.id}
                      place={p}
                      ctx={ctx}
                      highlighted={highlight === p.id}
                      onShowOnMap={showOnMap}
                      menus={menus[p.id]}
                      upload={upload}
                    />
                  ))}
                </div>
              )}
              {sorted.length > visible && (
                <button type="button" className="bbtn more" onClick={() => setVisible((v) => v + PAGE)}>
                  {sorted.length - visible}권 더 꺼내 보기
                </button>
              )}
            </section>
          </>
        )}
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
            AI 사서평과 새 소식은 블로그 글로 자동 생성되어 틀릴 수 있어요. 방문 전 네이버 지도에서 영업시간을 확인해 주세요.
          </p>
        </footer>
      </div>

      {toast && (
        <div key={toast.n} className="toast" role="status">
          <span aria-hidden>{toast.icon}</span> {toast.msg}
        </div>
      )}
    </div>
  );
}
