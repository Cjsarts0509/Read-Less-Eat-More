import { useMemo, useState } from "react";
import type { Branch, DataIndex } from "../../shared/types";

interface Props {
  branches: Branch[];
  index: DataIndex | null;
  selected: Branch | null;
  onSelect: (code: string) => void;
}

export function BranchList({ branches, index, selected, onSelect }: Props) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim();
    const list = needle
      ? branches.filter((b) => `${b.label} ${b.region} ${b.address} ${b.division}`.includes(needle))
      : branches;
    const m = new Map<string, Branch[]>();
    for (const b of list) m.set(b.division, [...(m.get(b.division) ?? []), b]);
    return [...m.entries()];
  }, [branches, q]);

  return (
    <div className="blist">
      <input
        className="input blist__search"
        type="search"
        placeholder="지점 이름이나 동네로 찾기 (예: 광화문, 부산)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="지점 찾기"
      />
      {groups.length === 0 && <p className="muted">찾는 지점이 없어요.</p>}
      {groups.map(([division, list]) => (
        <section key={division} className="blist__group">
          <h3 className="blist__title">
            {division} <span className="muted">{list.length}</span>
          </h3>
          <div className="blist__grid">
            {list.map((b) => {
              const count = index?.branches[b.code]?.count;
              return (
                <button
                  type="button"
                  key={b.code}
                  className={`bchip${selected?.code === b.code ? " bchip--on" : ""}`}
                  onClick={() => onSelect(b.code)}
                  aria-pressed={selected?.code === b.code}
                >
                  <span className="bchip__name">{b.label}</span>
                  <span className="bchip__meta">
                    {b.region}
                    {count !== undefined && ` · 식당 ${count}`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
