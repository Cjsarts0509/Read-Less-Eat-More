import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, DataIndex } from "../../shared/types";
import { hashString } from "../lib/random";
import { sfx } from "../lib/sfx";

interface Props {
  branches: Branch[];
  index: DataIndex | null;
  selected: Branch | null;
  onSelect: (code: string) => void;
}

/** 책장 두 칸: 위 칸 = 강남 · 남부사업단, 아래 칸 = 그 밖 (강북사업단 · 본사 …) */
const TOP_DIVISIONS = ["강남사업단", "남부사업단"];

/**
 * 책등 색 (배경 / 글자) — 13가지. 칸마다 5칸씩 건너 고르므로 이웃한 책끼리 같은 색이 나오지 않는다.
 */
const PALETTE: Array<[string, string]> = [
  ["#005b41", "#faf8f3"], // 교보 초록
  ["#1a2b4c", "#f5b82e"], // 남색 · 금박
  ["#ff6b2c", "#141414"], // 귤색
  ["#8c1c2b", "#f6e7c8"], // 버건디
  ["#f5b82e", "#141414"], // 겨자
  ["#1b6f73", "#faf8f3"], // 청록
  ["#5b2a6e", "#f5b82e"], // 자두
  ["#efe3c2", "#141414"], // 크림
  ["#3d7cc9", "#faf8f3"], // 하늘
  ["#6b7a2a", "#faf8f3"], // 올리브
  ["#d76a7a", "#141414"], // 장미
  ["#7a4b2a", "#f6e7c8"], // 가죽 갈색
  ["#141414", "#f5b82e"], // 검정 · 금박
];

/** 책등 무늬 */
const PATTERNS = ["bands", "stripes", "dots", "plaid", "label", "foil", "plain"] as const;

interface Group {
  division: string;
  branches: Branch[];
}

function groupByDivision(branches: Branch[]): Group[] {
  const out: Group[] = [];
  for (const b of branches) {
    const g = out.find((x) => x.division === b.division);
    if (g) g.branches.push(b);
    else out.push({ division: b.division, branches: [b] });
  }
  return out;
}

export function BookShelf({ branches, index, selected, onSelect }: Props) {
  const rows = useMemo(() => {
    const groups = groupByDivision(branches);
    const top = TOP_DIVISIONS.map((d) => groups.find((g) => g.division === d)).filter((g): g is Group => Boolean(g));
    const order = ["강북사업단", "본사"];
    const bottom = groups
      .filter((g) => !TOP_DIVISIONS.includes(g.division))
      .sort((a, b) => {
        const ia = order.indexOf(a.division);
        const ib = order.indexOf(b.division);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    return [top, bottom].filter((r) => r.length > 0);
  }, [branches]);

  const caseRef = useRef<HTMLDivElement>(null);
  // 고른 책등이 보이도록 그 칸만 가로로 움직인다
  useEffect(() => {
    if (!selected || !caseRef.current) return;
    const el = caseRef.current.querySelector<HTMLElement>(`[data-code="${selected.code}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selected]);

  return (
    <div className="case" ref={caseRef}>
      <div className="case__inner">
        {rows.map((groups, r) => (
          <ShelfRow key={r} row={r} groups={groups} index={index} selected={selected} onSelect={onSelect} last={r === rows.length - 1} />
        ))}
      </div>
      <div className="case__foot">
        <span>KYOBO NATIONAL LUNCH ARCHIVE</span>
        <span className="case__online">{branches.length} BRANCHES ONLINE</span>
      </div>
    </div>
  );
}

function ShelfRow({
  row,
  groups,
  index,
  selected,
  onSelect,
  last,
}: {
  row: number;
  groups: Group[];
  index: DataIndex | null;
  selected: Branch | null;
  onSelect: (code: string) => void;
  last: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  // 칸이 넘칠 때만 좌우 화살표를 보인다
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [groups]);
  const scrollBy = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.7, behavior: "smooth" });
  let i = 0;
  return (
    <div className={`case__row${overflow ? " case__row--more" : ""}`}>
      {overflow && (
        <button type="button" className="case__nav case__nav--l" onClick={() => scrollBy(-1)} aria-label="책장 왼쪽으로">
          ◀
        </button>
      )}
      <div className="case__track" ref={track}>
        {groups.map((g) => (
          <Fragment key={g.division}>
            <div className="bookend" aria-hidden>
              <span>{g.division}</span>
              <small>{g.branches.length}</small>
            </div>
            {g.branches.map((b) => {
              const n = i++;
              const h = hashString(b.code);
              return (
                <Spine
                  key={b.code}
                  branch={b}
                  color={PALETTE[(n * 5 + row * 3) % PALETTE.length]!}
                  pattern={PATTERNS[(n * 3 + h) % PATTERNS.length]!}
                  height={150 + (h % 5) * 9}
                  width={50 + ((h >> 4) % 4) * 4}
                  count={index?.branches[b.code]?.count}
                  active={selected?.code === b.code}
                  onSelect={onSelect}
                />
              );
            })}
          </Fragment>
        ))}
        <div className="case__deco" aria-hidden>
          {row === 0 ? (
            <span className="case__plant">🪴</span>
          ) : (
            <>
              <span className="case__stack">
                <i />
                <i />
                <i />
              </span>
              <span className="case__plant">☕</span>
            </>
          )}
        </div>
      </div>
      {overflow && (
        <button type="button" className="case__nav case__nav--r" onClick={() => scrollBy(1)} aria-label="책장 오른쪽으로">
          ▶
        </button>
      )}
      <div className={`case__plank${last ? " case__plank--last" : ""}`} aria-hidden />
    </div>
  );
}

function Spine({
  branch,
  color,
  pattern,
  height,
  width,
  count,
  active,
  onSelect,
}: {
  branch: Branch;
  color: [string, string];
  pattern: (typeof PATTERNS)[number];
  height: number;
  width: number;
  count: number | undefined;
  active: boolean;
  onSelect: (code: string) => void;
}) {
  return (
    <button
      type="button"
      data-code={branch.code}
      data-pattern={pattern}
      className={`spine${active ? " spine--on" : ""}`}
      style={{ "--spine-bg": color[0], "--spine-fg": color[1], "--spine-h": `${height}px`, width } as React.CSSProperties}
      aria-pressed={active}
      aria-label={`${branch.label} 선택 (${branch.region})`}
      title={`${branch.label} · ${branch.address}${count !== undefined ? ` · 식당 ${count}곳` : ""}`}
      onClick={() => {
        sfx.spinePop();
        onSelect(branch.code);
      }}
    >
      {active && (
        <span className="ribbon" aria-hidden>
          ★
        </span>
      )}
      <span className="spine__kdc">KDC-{branch.code}</span>
      <span className="spine__name">{branch.label}</span>
      <span className="spine__region">{branch.region}</span>
    </button>
  );
}
