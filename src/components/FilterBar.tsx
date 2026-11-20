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

const BUDGET_WON = [
  { v: 0, label: "전체" },
  { v: 10000, label: "1만원" },
  { v: 12000, label: "1.2만원" },
  { v: 15000, label: "1.5만원" },
];

const DRIVES = [
  { v: 10, label: "10분" },
  { v: 15, label: "15분" },
  { v: 20, label: "20분" },
  { v: 30, label: "30분" },
  { v: 0, label: "전체" },
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
        <span className="frow__label">이동</span>
        <div className="seg2" role="radiogroup" aria-label="이동 방법" style={{ "--n": 2 } as React.CSSProperties}>
          {(["walk", "drive"] as const).map((m) => (
            <button
              type="button"
              key={m}
              role="radio"
              aria-checked={filters.mode === m}
              className={`seg2__btn${filters.mode === m ? " seg2__btn--on" : ""}`}
              onClick={() => set("mode", m)}
            >
              {m === "walk" ? "🚶 도보" : "🚗 차량"}
            </button>
          ))}
        </div>
      </div>
      {filters.mode === "walk" ? (
        <div className="frow">
          <span className="frow__label">🚶 도보</span>
          <Segmented label="도보 거리" value={filters.walk} options={WALKS} onPick={(v) => set("walk", v)} />
        </div>
      ) : (
        <div className="frow">
          <span className="frow__label" title="도로 우회 · 점심시간 도심 속도 · 주차를 넣은 어림">
            🚗 차로
          </span>
          <Segmented label="차로 걸리는 시간" value={filters.drive} options={DRIVES} onPick={(v) => set("drive", v)} />
        </div>
      )}
      <div className="frow">
        <span className="frow__label" title="왕복 걷는 시간 + 식사 + 웨이팅">
          ⏱ 점심시간
        </span>
        <Segmented label="점심시간 한도 (왕복 + 식사 + 웨이팅)" value={filters.timeBudget} options={BUDGETS} onPick={(v) => set("timeBudget", v)} />
      </div>
      <div className="frow">
        <span className="frow__label" title="가격을 아는 가게 중 이 금액을 넘는 곳은 뺍니다">
          💳 1인 예산
        </span>
        <Segmented label="1인 예산 (식대 한도)" value={filters.budget} options={BUDGET_WON} onPick={(v) => set("budget", v)} />
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
