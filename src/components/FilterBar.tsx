import { CATEGORIES } from "../../shared/categories";
import type { CategoryKey } from "../../shared/types";
import { NEWS_FILTERS, SORT_LABEL, type Filters, type NewsFilter, type SortKey } from "../lib/filters";

const WALKS = [
  { v: 5, label: "5분" },
  { v: 10, label: "10분" },
  { v: 15, label: "15분" },
  { v: 0, label: "전체" },
];

interface Props {
  filters: Filters;
  hasRating: boolean;
  onChange: (f: Filters) => void;
}

export function FilterBar({ filters, hasRating, onChange }: Props) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v });
  const toggleNews = (k: NewsFilter) =>
    set("news", filters.news.includes(k) ? filters.news.filter((x) => x !== k) : [...filters.news, k]);
  const sorts = (Object.keys(SORT_LABEL) as SortKey[]).filter((s) => s !== "rating" || hasRating);

  return (
    <div className="filters">
      <div className="filters__row">
        <div className="seg" role="radiogroup" aria-label="도보 거리">
          <span className="seg__label">도보</span>
          {WALKS.map((w) => (
            <button
              type="button"
              key={w.v}
              role="radio"
              aria-checked={filters.walk === w.v}
              className={`seg__btn${filters.walk === w.v ? " seg__btn--on" : ""}`}
              onClick={() => set("walk", w.v)}
            >
              {w.label}
            </button>
          ))}
        </div>

        <label className="switch">
          <input type="checkbox" checked={filters.lunchOnly} onChange={(e) => set("lunchOnly", e.target.checked)} />
          <span className="switch__track" aria-hidden />
          점심 영업하는 곳만
        </label>

        <label className="select">
          <span className="sr-only">정렬</span>
          <select value={filters.sort} onChange={(e) => set("sort", e.target.value as SortKey)}>
            {sorts.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <input
          className="input filters__search"
          type="search"
          placeholder="가게·메뉴 검색 (예: 국밥, 혼밥)"
          value={filters.query}
          onChange={(e) => set("query", e.target.value)}
          aria-label="가게·메뉴 검색"
        />
      </div>

      <div className="filters__row filters__news" aria-label="새 소식 필터">
        <span className="seg__label">새 소식</span>
        {NEWS_FILTERS.map((n) => (
          <button
            type="button"
            key={n.key}
            className={`chip chip--${n.key}${filters.news.includes(n.key) ? " chip--on" : ""}`}
            aria-pressed={filters.news.includes(n.key)}
            onClick={() => toggleNews(n.key)}
          >
            {n.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface TabsProps {
  active: CategoryKey | "all";
  counts: Map<CategoryKey | "all", number>;
  onChange: (k: CategoryKey | "all") => void;
}

export function CategoryTabs({ active, counts, onChange }: TabsProps) {
  const tabs = [
    { key: "all" as const, label: "전체", emoji: "📚" },
    ...CATEGORIES.filter((c) => (counts.get(c.key) ?? 0) > 0 || active === c.key),
  ];
  return (
    <div className="tabs" role="tablist" aria-label="음식 분류">
      {tabs.map((t) => (
        <button
          type="button"
          role="tab"
          key={t.key}
          aria-selected={active === t.key}
          className={`tab${active === t.key ? " tab--on" : ""}`}
          onClick={() => onChange(t.key)}
        >
          <span aria-hidden>{t.emoji}</span> {t.label}
          <span className="tab__count">{counts.get(t.key) ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
