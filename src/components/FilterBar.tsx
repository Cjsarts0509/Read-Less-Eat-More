import { CATEGORIES } from "../../shared/categories";
import type { CategoryKey } from "../../shared/types";
import { NEWS_FILTERS, type Filters, type NewsFilter } from "../lib/filters";
import { sfx } from "../lib/sfx";

const BUDGETS = [
  { v: 0, label: "제한 없음" },
  { v: 40, label: "40분" },
  { v: 60, label: "1시간" },
  { v: 90, label: "1시간 반" },
];

const WALKS = [
  { v: 5, label: "5분" },
  { v: 10, label: "10분" },
  { v: 15, label: "15분" },
  { v: 0, label: "전체" },
];

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
}

function Segmented<T extends number>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: Array<{ v: T; label: string }>;
  onPick: (v: T) => void;
}) {
  return (
    <div className="seg2" role="radiogroup" aria-label={label} style={{ "--n": options.length } as React.CSSProperties}>
      {options.map((o) => (
        <button
          type="button"
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          className={`seg2__btn${value === o.v ? " seg2__btn--on" : ""}`}
          onClick={() => onPick(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 도보 거리 · 점심시간 · 점심 영업 · 검색 · 새 소식 (뽑기 후보와 목록 모두에 적용) */
export function FilterBar({ filters, onChange }: Props) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    sfx.tagClick();
    onChange({ ...filters, [k]: v });
  };
  const toggleNews = (k: NewsFilter) =>
    set("news", filters.news.includes(k) ? filters.news.filter((x) => x !== k) : [...filters.news, k]);

  return (
    <div className="fbox">
      <div className="frow">
        <span className="frow__label">🚶 도보</span>
        <Segmented label="도보 거리" value={filters.walk} options={WALKS} onPick={(v) => set("walk", v)} />
      </div>
      <div className="frow">
        <span className="frow__label" title="왕복 걷는 시간 + 식사 + 웨이팅">
          ⏱ 점심시간
        </span>
        <Segmented label="점심시간 한도 (왕복 + 식사 + 웨이팅)" value={filters.timeBudget} options={BUDGETS} onPick={(v) => set("timeBudget", v)} />
      </div>
      <div className="frow frow--split">
        <label className="switch">
          <input type="checkbox" checked={filters.lunchOnly} onChange={(e) => set("lunchOnly", e.target.checked)} />
          <span className="switch__track" aria-hidden />
          점심 영업하는 곳만
        </label>
        <input
          className="input fbox__search"
          type="search"
          placeholder="🔎 가게 · 메뉴 (예: 국밥, 혼밥)"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          aria-label="가게·메뉴 검색"
        />
      </div>
      <div className="frow">
        <span className="frow__label">🆕 새 소식</span>
        <div className="chips no-swipe" aria-label="새 소식 필터">
          {NEWS_FILTERS.map((n) => (
            <button
              type="button"
              key={n.key}
              className={`chip${filters.news.includes(n.key) ? " chip--on" : ""}`}
              aria-pressed={filters.news.includes(n.key)}
              onClick={() => toggleNews(n.key)}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface TabsProps {
  active: CategoryKey | "all";
  counts: Map<CategoryKey | "all", number>;
  onChange: (k: CategoryKey | "all") => void;
}

/** 분류 = 장르 책갈피. 같은 크기 타일로 줄 맞춰 놓는다 */
export function CategoryTabs({ active, counts, onChange }: TabsProps) {
  const tabs = [
    { key: "all" as const, label: "전체", emoji: "🎲" },
    ...CATEGORIES.filter((c) => (counts.get(c.key) ?? 0) > 0 || active === c.key),
  ];
  return (
    <div className="gtiles" role="tablist" aria-label="식사 장르">
      {tabs.map((t) => (
        <button
          type="button"
          role="tab"
          key={t.key}
          aria-selected={active === t.key}
          className={`gtile${active === t.key ? " gtile--on" : ""}`}
          onClick={() => {
            sfx.tagClick();
            onChange(t.key);
          }}
        >
          <span className="gtile__emoji" aria-hidden>
            {t.emoji}
          </span>
          <span className="gtile__label">{t.label}</span>
          <span className="gtile__count">{counts.get(t.key) ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
