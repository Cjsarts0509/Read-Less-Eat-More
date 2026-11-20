import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_KEY } from "../shared/categories";
import type { Branch, BranchPlaces, CategoryKey, DataIndex } from "../shared/types";
import { AskAI } from "./components/AskAI";
import { BranchList } from "./components/BranchList";
import { BranchMap } from "./components/BranchMap";
import { CategoryTabs, FilterBar } from "./components/FilterBar";
import { PlaceCard } from "./components/PlaceCard";
import { RandomPick } from "./components/RandomPick";
import { loadBranches, loadConfig, loadIndex, loadPlaces, todayKst, type AppConfig } from "./lib/data";
import { applyFilters, countByCategory, DEFAULT_FILTERS, sortPlaces, type Ctx, type Filters } from "./lib/filters";
import { readStore, writeStore } from "./lib/storage";

type View = "map" | "list";
type PlacesState = { status: "idle" } | { status: "loading" } | { status: "missing" } | { status: "ready"; data: BranchPlaces };

const PAGE = 48;
const params = new URLSearchParams(window.location.search);
const DEMO = params.has("demo");

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" }).format(d);
}

export function App() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [config, setConfig] = useState<AppConfig>({ ai: false });
  const [selectedCode, setSelectedCode] = useState<string | null>(() => params.get("b") ?? readStore<string | null>("rlem:branch", null));
  const [view, setView] = useState<View>(() => readStore<View>("rlem:view", "map"));
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
  const mapRef = useRef<HTMLDivElement>(null);
  const today = todayKst();

  useEffect(() => {
    void loadBranches().then((b) => setBranches(b ?? []));
    void loadIndex().then(setIndex);
    if (!DEMO) void loadConfig().then(setConfig);
  }, []);

  const selected = useMemo(() => branches.find((b) => b.code === selectedCode) ?? null, [branches, selectedCode]);

  // 고른 지점을 주소창과 브라우저에 기억
  useEffect(() => {
    writeStore("rlem:branch", selectedCode);
    const url = new URL(window.location.href);
    if (selectedCode) url.searchParams.set("b", selectedCode);
    else url.searchParams.delete("b");
    window.history.replaceState(null, "", url);
  }, [selectedCode]);

  useEffect(() => writeStore("rlem:view", view), [view]);
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

  const ctx: Ctx = useMemo(() => ({ today, baselineDate: DEMO ? null : (index?.baselineDate ?? null) }), [today, index]);
  const all = places.status === "ready" ? places.data.places : [];
  const filtered = useMemo(() => applyFilters(all, filters, ctx), [all, filters, ctx]);
  const counts = useMemo(() => countByCategory(filtered), [filtered]);
  const inTab = useMemo(() => (tab === "all" ? filtered : filtered.filter((p) => p.category === tab)), [filtered, tab]);
  const sorted = useMemo(() => sortPlaces(inTab, filters.sort, ctx), [inTab, filters.sort, ctx]);
  const hasRating = useMemo(() => all.some((p) => p.google?.rating != null), [all]);

  // 지도에는 지금 목록 + (목록 밖이라도) 지도로 보려는 가게
  const mapPlaces = useMemo(() => {
    if (!focus || sorted.some((p) => p.id === focus.id)) return sorted;
    const extra = all.find((p) => p.id === focus.id);
    return extra ? [...sorted, extra] : sorted;
  }, [sorted, focus, all]);

  const selectBranch = useCallback((code: string | null) => setSelectedCode(code), []);

  const showOnMap = useCallback((id: string) => {
    setView("map");
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      window.setTimeout(() => {
        document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
      window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2600);
    },
    [sorted, visible],
  );

  const tabLabel = tab === "all" ? "전체" : CATEGORY_BY_KEY[tab].label;
  const walkLabel = filters.walk ? `도보 ${filters.walk}분` : "반경 전체";
  const poolLabel = `${walkLabel} · ${tabLabel}${filters.lunchOnly ? " · 점심 영업" : ""} 조건의 ${sorted.length}곳에서 뽑아요`;
  const branchInfo = selected ? index?.branches[selected.code] : undefined;

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__inner">
          <a className="brand" href="/" aria-label="읽지 않고 먹습니다 처음으로">
            <span className="brand__mark" aria-hidden>
              <svg viewBox="0 0 64 64" width="40" height="40">
                <rect width="64" height="64" rx="14" fill="currentColor" />
                <path d="M14 18c6-2 12-2 18 2v28c-6-4-12-4-18-2z" fill="var(--paper)" />
                <path d="M50 18c-6-2-12-2-18 2v28c6-4 12-4 18-2z" fill="var(--paper-2)" />
                <path d="M22 26v12M26 26v12M22 32h4M42 26c-2 2-2 6 0 8v6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
              </svg>
            </span>
            <span className="brand__text">
              <span className="brand__ko">읽지 않고 먹습니다</span>
              <span className="brand__en">Read Less, Eat More</span>
            </span>
          </a>
          <p className="masthead__date">{formatDate(new Date().toISOString())}</p>
        </div>
        <p className="masthead__tag">책은 잠깐 덮어 두고, 점심은 제대로.</p>
      </header>

      <main className="main">
        {DEMO && (
          <div className="banner" role="note">
            <b>샘플 화면</b> — 실제 식당이 아닌 예시 데이터예요.{" "}
            <a href={window.location.pathname}>실제 데이터 보기</a>
          </div>
        )}

        <section className="hero">
          <div className="panel hero__map" ref={mapRef}>
            <div className="panel__bar">
              <h2 className="section-title">지점 고르기</h2>
              <div className="panel__tools">
                <label className="select select--sm">
                  <span className="sr-only">지점 선택</span>
                  <select value={selectedCode ?? ""} onChange={(e) => selectBranch(e.target.value || null)}>
                    <option value="">지점 선택…</option>
                    {branches.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.label} ({b.region})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="seg seg--sm" role="radiogroup" aria-label="보기 방식">
                  {(["map", "list"] as const).map((v) => (
                    <button
                      type="button"
                      key={v}
                      role="radio"
                      aria-checked={view === v}
                      className={`seg__btn${view === v ? " seg__btn--on" : ""}`}
                      onClick={() => setView(v)}
                    >
                      {v === "map" ? "지도" : "목록"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {view === "map" ? (
              <BranchMap
                branches={branches}
                selected={selected}
                places={mapPlaces}
                walk={filters.walk}
                focus={focus}
                onSelectBranch={selectBranch}
                onShowCard={showCard}
              />
            ) : (
              <BranchList branches={branches} index={index} selected={selected} onSelect={selectBranch} />
            )}
            {selected && (
              <div className="where">
                <p className="where__name">
                  📍 <b>{selected.label}</b> <span className="muted">{selected.division}</span>
                </p>
                <p className="where__addr muted">{selected.address}</p>
                {places.status === "ready" && (
                  <p className="where__meta muted">
                    반경 {places.data.radius / 1000}km 식당 {all.length}곳
                    {!DEMO && branchInfo && ` · ${formatDate(branchInfo.updatedAt)} 갱신`}
                  </p>
                )}
              </div>
            )}
          </div>

          <aside className="hero__side">
            {!selected && (
              <div className="panel intro">
                <h2 className="section-title">어느 지점 근처에서 드세요?</h2>
                <p>
                  지도에서 지점 핀을 누르거나 목록에서 골라 주세요. 걸어서 갈 만한 식당을 모아 보여 드리고, 고르기 어려우면
                  한 곳 뽑아 드려요.
                </p>
                <ul className="intro__list">
                  <li>🍚 점심시간에 문 여는 곳 위주로</li>
                  <li>🆕 신규 오픈 · 이벤트 · 시즌 메뉴는 AI 가 블로그 리뷰에서 찾아요</li>
                  <li>⭐ 평점·방문자 리뷰는 네이버 지도로 바로 연결</li>
                </ul>
              </div>
            )}
            {selected && places.status === "ready" && (
              <div className="panel">
                <RandomPick branch={selected} pool={sorted} allPlaces={all} ctx={ctx} poolLabel={poolLabel} onShowOnMap={showOnMap} />
              </div>
            )}
            {selected && places.status === "loading" && <div className="panel skeleton" aria-busy="true" />}
            {selected && places.status === "missing" && (
              <div className="panel intro">
                <h2 className="section-title">아직 식당 정보를 모으는 중이에요</h2>
                <p>
                  이 지점의 식당 데이터가 아직 없어요. 매일 아침 자동으로 모으고, 관리자가 GitHub Actions 의 「식당 데이터
                  수집」을 실행하면 바로 채워져요.
                </p>
                <p>
                  <a className="btn" href={`?demo=1&b=${selected.code}`}>
                    샘플 화면 먼저 보기
                  </a>
                </p>
              </div>
            )}
          </aside>
        </section>

        {selected && places.status === "ready" && (
          <>
            {config.ai && !DEMO && (
              <div className="panel">
                <AskAI branch={selected} candidates={sorted.length ? sorted : all} onShowOnMap={showOnMap} />
              </div>
            )}

            <section className="list" aria-labelledby="list-title">
              <div className="list__head">
                <h2 id="list-title" className="section-title">
                  주변 식당
                </h2>
                <p className="muted">{sorted.length}곳</p>
              </div>
              <FilterBar filters={filters} hasRating={hasRating} onChange={setFilters} />
              <CategoryTabs active={tab} counts={counts} onChange={setTab} />
              {sorted.length === 0 ? (
                <p className="empty">조건에 맞는 식당이 없어요. 도보 거리를 늘리거나 필터를 꺼 보세요.</p>
              ) : (
                <div className="grid">
                  {sorted.slice(0, visible).map((p) => (
                    <PlaceCard key={p.id} place={p} ctx={ctx} highlighted={highlight === p.id} onShowOnMap={showOnMap} />
                  ))}
                </div>
              )}
              {sorted.length > visible && (
                <button type="button" className="more" onClick={() => setVisible((v) => v + PAGE)}>
                  {sorted.length - visible}곳 더 보기
                </button>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="footer">
        <p>
          식당 목록 <b>카카오 로컬</b> · 블로그 리뷰 수와 최근 글 <b>네이버 검색</b> · 요약과 새 소식 <b>Claude</b>
          {all.some((p) => p.google) && (
            <>
              {" "}
              · 평점·영업시간 <b>Google</b>
            </>
          )}{" "}
          · 지도 <b>OpenStreetMap</b>
        </p>
        <p className="muted">
          AI 요약과 새 소식은 블로그 글을 바탕으로 자동으로 만든 것이라 틀릴 수 있어요. 방문 전에 네이버 지도에서 영업시간을 확인해
          주세요.
        </p>
      </footer>
    </div>
  );
}
