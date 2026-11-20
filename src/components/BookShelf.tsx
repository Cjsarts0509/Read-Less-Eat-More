import type { Branch, DataIndex } from "../../shared/types";
import { hashString } from "../lib/random";
import { sfx } from "../lib/sfx";

interface Props {
  branches: Branch[];
  index: DataIndex | null;
  selected: Branch | null;
  onSelect: (code: string) => void;
}

/** 사업단마다 작은 책장 하나: 서가 번호 · 지역 무늬 */
interface Theme {
  code: string;
  icon: string;
  sub: string;
  key: string;
}

const THEMES: Record<string, Theme> = {
  강남사업단: { code: "A", icon: "🏙️", sub: "서울 강남 · 경기 남부", key: "gangnam" },
  남부사업단: { code: "B", icon: "🌊", sub: "충청 · 영남 · 호남", key: "nambu" },
  강북사업단: { code: "C", icon: "🏯", sub: "서울 강북 · 인천 · 일산", key: "gangbuk" },
  본사: { code: "HQ", icon: "📚", sub: "상암 · 파주 출판도시", key: "hq" },
};

function themeOf(division: string, i: number): Theme {
  return THEMES[division] ?? { code: String.fromCharCode(68 + i), icon: "📖", sub: "", key: "etc" };
}

/**
 * 칸 배치: 넓은 화면은 [A | B] / [C + HQ | 열람 코너], 좁은 화면은 A / B / C + HQ.
 * 어느 칸이든 책 12권 폭이라 책 크기가 고르다.
 */
const CELLS: string[][] = [["강남사업단"], ["남부사업단"], ["강북사업단", "본사"]];

/** 책등 색 (배경 / 글자) — 13가지. 5칸씩 건너 고르므로 이웃한 책끼리 같은 색이 나오지 않는다 */
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
  const groups = groupByDivision(branches);
  const known = new Set(CELLS.flat());
  const cells = CELLS.map((names) => names.map((n) => groups.find((g) => g.division === n)).filter((g): g is Group => Boolean(g)));
  // 목록에 없는 사업단이 생기면 마지막 칸에 붙인다
  cells[cells.length - 1]!.push(...groups.filter((g) => !known.has(g.division)));

  let n = 0;
  return (
    <div className="case">
      <div className="case__inner">
        {cells.map((row, r) =>
          row.length ? (
            <div key={r} className={`case__cell case__cell--${r}`}>
              {row.map((g) => {
                const t = themeOf(g.division, groups.indexOf(g));
                return (
                  <section
                    key={g.division}
                    className="bay"
                    data-theme={t.key}
                    style={{ "--n": g.branches.length } as React.CSSProperties}
                    aria-label={`${g.division} 서가`}
                  >
                    <header className="bay__sign">
                      <span className="bay__code">{t.code}</span>
                      <span className="bay__title">
                        <b>
                          <span className="bay__icon" aria-hidden>
                            {t.icon}
                          </span>{" "}
                          {g.division}
                        </b>
                        {t.sub && <small>{t.sub}</small>}
                      </span>
                      <span className="bay__count">{g.branches.length}</span>
                    </header>
                    <div className="bay__books">
                      {g.branches.map((b) => {
                        const i = n++;
                        const h = hashString(b.code);
                        return (
                          <Spine
                            key={b.code}
                            branch={b}
                            color={PALETTE[(i * 5) % PALETTE.length]!}
                            pattern={PATTERNS[(i * 3 + h) % PATTERNS.length]!}
                            k={0.8 + (h % 5) * 0.05}
                            grow={0.9 + ((h >> 4) % 4) * 0.08}
                            count={index?.branches[b.code]?.count}
                            active={selected?.code === b.code}
                            onSelect={onSelect}
                          />
                        );
                      })}
                    </div>
                    <div className="bay__plank" aria-hidden />
                  </section>
                );
              })}
            </div>
          ) : null,
        )}
        <Nook />
      </div>
      <div className="case__foot">
        <span>KYOBO NATIONAL LUNCH ARCHIVE</span>
        <span className="case__online">{branches.length} BRANCHES ONLINE</span>
      </div>
    </div>
  );
}

/** 넓은 화면의 빈칸: 열람 코너 (장식) */
function Nook() {
  return (
    <section className="bay bay--nook" data-theme="nook" aria-hidden>
      <header className="bay__sign">
        <span className="bay__code">R</span>
        <span className="bay__title">
          <b>
            <span className="bay__icon">☕</span> 열람 코너
          </b>
          <small>점심시간 11:30 – 14:00</small>
        </span>
      </header>
      <div className="bay__books nook">
        <div className="nook__board">
          <b>오늘의 열람 안내</b>
          <span>책등을 고르면</span>
          <span>점심 서가가 열립니다</span>
          <i>— 사서 드림</i>
        </div>
        <span className="nook__globe">🌐</span>
        <span className="case__stack">
          <i />
          <i />
          <i />
        </span>
        <span className="nook__plant">🪴</span>
        <span className="nook__mug">☕</span>
      </div>
      <div className="bay__plank" />
    </section>
  );
}

function Spine({
  branch,
  color,
  pattern,
  k,
  grow,
  count,
  active,
  onSelect,
}: {
  branch: Branch;
  color: [string, string];
  pattern: (typeof PATTERNS)[number];
  k: number;
  grow: number;
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
      style={{ "--spine-bg": color[0], "--spine-fg": color[1], "--k": k, "--g": grow } as React.CSSProperties}
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
      <span className="spine__kdc">
        <i>KDC-</i>
        {branch.code}
      </span>
      {/* 책등엔 '점'을 떼어 짧게 (세로로 두 줄이 되는 걸 줄인다) */}
      <span className="spine__name">{branch.label.replace(/(.{2,})점$/, "$1")}</span>
      <span className="spine__region">{branch.region}</span>
    </button>
  );
}
