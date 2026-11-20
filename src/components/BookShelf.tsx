import { useEffect, useMemo, useRef } from "react";
import type { Branch, DataIndex } from "../../shared/types";
import { hashString } from "../lib/random";
import { sfx } from "../lib/sfx";

interface Props {
  branches: Branch[];
  index: DataIndex | null;
  selected: Branch | null;
  onSelect: (code: string) => void;
}

// 책등 색 (배경 / 글자)
const SPINES = [
  ["var(--green)", "var(--paper)"],
  ["var(--navy)", "var(--paper)"],
  ["var(--tangerine)", "var(--ink)"],
  ["var(--mustard)", "var(--ink)"],
  ["var(--green-light)", "var(--paper)"],
  ["var(--ink)", "var(--mustard)"],
  ["var(--navy)", "var(--mustard)"],
  ["var(--tangerine)", "var(--paper)"],
] as const;

type Item = { kind: "end"; division: string; count: number } | { kind: "book"; branch: Branch; i: number };

export function BookShelf({ branches, index, selected, onSelect }: Props) {
  const track = useRef<HTMLDivElement>(null);

  // 사업단마다 북엔드로 구분
  const items = useMemo(() => {
    const out: Item[] = [];
    let last = "";
    branches.forEach((b, i) => {
      if (b.division !== last) {
        out.push({ kind: "end", division: b.division, count: branches.filter((x) => x.division === b.division).length });
        last = b.division;
      }
      out.push({ kind: "book", branch: b, i });
    });
    return out;
  }, [branches]);

  // 고른 책등이 보이도록 가로 스크롤
  useEffect(() => {
    if (!selected || !track.current) return;
    const el = track.current.querySelector<HTMLElement>(`[data-code="${selected.code}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selected]);

  const scrollBy = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.7, behavior: "smooth" });

  return (
    <div className="shelf">
      <button type="button" className="shelf__nav shelf__nav--l" onClick={() => scrollBy(-1)} aria-label="책장 왼쪽으로">
        ◀
      </button>
      <div className="shelf__track" ref={track}>
        {items.map((it) =>
          it.kind === "end" ? (
            <div key={`end-${it.division}`} className="bookend" aria-hidden>
              <span>{it.division}</span>
              <small>{it.count}</small>
            </div>
          ) : (
            <Spine
              key={it.branch.code}
              branch={it.branch}
              color={SPINES[it.i % SPINES.length]!}
              count={index?.branches[it.branch.code]?.count}
              active={selected?.code === it.branch.code}
              onSelect={onSelect}
            />
          ),
        )}
      </div>
      <button type="button" className="shelf__nav shelf__nav--r" onClick={() => scrollBy(1)} aria-label="책장 오른쪽으로">
        ▶
      </button>
      <div className="shelf__plank">
        <span>KYOBO NATIONAL LUNCH ARCHIVE</span>
        <span className="shelf__online">{branches.length} BRANCHES ONLINE</span>
      </div>
    </div>
  );
}

function Spine({
  branch,
  color,
  count,
  active,
  onSelect,
}: {
  branch: Branch;
  color: readonly [string, string];
  count: number | undefined;
  active: boolean;
  onSelect: (code: string) => void;
}) {
  const height = 150 + (hashString(branch.code) % 5) * 9;
  return (
    <button
      type="button"
      data-code={branch.code}
      className={`spine${active ? " spine--on" : ""}`}
      style={{ "--spine-bg": color[0], "--spine-fg": color[1], height } as React.CSSProperties}
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
