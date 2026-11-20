import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { BalanceResponse } from "../../shared/api";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import { balanceOfDay, fortuneOf } from "../../shared/fun";
import type { CategoryKey } from "../../shared/types";
import { fetchBalance, memberKey, voteBalance } from "../lib/api";
import { sfx } from "../lib/sfx";
import { readStore, writeStore } from "../lib/storage";
import { Ladder, WorldCup } from "./MiniGames";

type GameKey = "balance" | "fortune" | "worldcup" | "ladder";

const GAMES: Array<{ key: GameKey; icon: string; label: string }> = [
  { key: "balance", icon: "⚖️", label: "밸런스 게임" },
  { key: "fortune", icon: "🥠", label: "점심 운세" },
  { key: "worldcup", icon: "🏆", label: "메뉴 월드컵" },
  { key: "ladder", icon: "🪜", label: "사다리 타기" },
];

type Summaries = Partial<Record<GameKey, string>>;

interface Props {
  today: string;
  /** 투표를 서버에 남길 수 있는가 */
  canVote: boolean;
  /** 행운의 장르로 바로 편찬 (지점 서가가 열려 있을 때만) */
  onLuckyGenre?: ((k: CategoryKey) => void) | null;
  onToast: (msg: string, icon?: string) => void;
}

const pctOf = (d: BalanceResponse, k: "a" | "b") => {
  const total = d.counts.a + d.counts.b;
  return total ? Math.round((d.counts[k] / total) * 100) : 0;
};

/** 표시용 짧은 이름: "🍜 짜장면" → "짜장면" */
const bare = (s: string) => s.replace(/^\S+\s/, "");

/** 머리의 심심풀이: 게임 버튼 넷 + 오른쪽에 오늘 결과 요약. 누르면 팝업으로 연다 */
export function FunCorner({ today, canVote, onLuckyGenre, onToast }: Props) {
  const storeKey = `lmp:fun:${today}`;
  const [open, setOpen] = useState<GameKey | null>(null);
  const [sums, setSums] = useState<Summaries>(() => readStore<Summaries>(storeKey, {}));
  const q = balanceOfDay(today);

  const save = (k: GameKey, v: string) =>
    setSums((s) => {
      const next = { ...s, [k]: v };
      writeStore(storeKey, next);
      return next;
    });

  // 오늘 운세를 이미 열었으면 요약에 바로
  const fortuneOpened = readStore(`lmp:fortune:${today}`, false);
  const f = fortuneOf(today, memberKey());
  const fortuneSum = fortuneOpened ? `${CATEGORY_BY_KEY[f.genre].emoji} ${CATEGORY_BY_KEY[f.genre].label} · ${f.score}점` : undefined;

  // 밸런스 게임: 이미 투표했으면 지금 비율로 요약
  useEffect(() => {
    if (!canVote) return;
    let alive = true;
    void fetchBalance()
      .then((d) => {
        if (alive && d.mine) save("balance", `${bare(d.mine === "a" ? q.a : q.b)} ${pctOf(d, d.mine)}%`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canVote, today]);

  const placeholder: Record<GameKey, string> = {
    balance: `${bare(q.a)} vs ${bare(q.b)}`,
    fortune: "하루 한 번 · 미개봉",
    worldcup: "8강 대기 중",
    ladder: "커피 내기 한 판?",
  };
  const summary = (k: GameKey) => (k === "fortune" ? fortuneSum : sums[k]);
  const game = GAMES.find((g) => g.key === open);
  const lucky = onLuckyGenre
    ? (k: CategoryKey) => {
        setOpen(null);
        onLuckyGenre(k);
      }
    : null;

  return (
    <>
      <section className="fun fun--grid" aria-label="심심풀이">
        {GAMES.map((g) => {
          const s = summary(g.key);
          return (
            <div key={g.key} className="fun__item">
              <button
                type="button"
                className="fun__btn"
                onClick={() => {
                  sfx.tagClick();
                  setOpen(g.key);
                }}
              >
                <span aria-hidden>{g.icon}</span> {g.label}
              </button>
              <span className={`fun__sum${s ? "" : " fun__sum--empty"}`} title={s ?? placeholder[g.key]}>
                {s ?? placeholder[g.key]}
              </span>
            </div>
          );
        })}
      </section>

      {game && (
        <GameModal title={`${game.icon} ${game.label}`} onClose={() => setOpen(null)}>
          {game.key === "fortune" && <Fortune today={today} onLuckyGenre={lucky} onOpened={() => setSums((s) => ({ ...s }))} />}
          {game.key === "balance" && <Balance today={today} canVote={canVote} onToast={onToast} onResult={(v) => save("balance", v)} />}
          {game.key === "worldcup" && <WorldCup onResult={(v) => save("worldcup", v)} onLuckyGenre={lucky} />}
          {game.key === "ladder" && <Ladder onResult={(v) => save("ladder", v)} />}
        </GameModal>
      )}
    </>
  );
}

/** 게임 팝업 (휴대폰은 아래에서 올라오는 시트) */
function GameModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--game no-swipe" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" aria-hidden />
        <header className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function Fortune({
  today,
  onLuckyGenre,
  onOpened,
}: {
  today: string;
  onLuckyGenre?: ((k: CategoryKey) => void) | null;
  onOpened: () => void;
}) {
  const key = `lmp:fortune:${today}`;
  const [open, setOpen] = useState<boolean>(() => readStore(key, false));
  const [cracking, setCracking] = useState(false);
  const f = fortuneOf(today, memberKey());
  const cat = CATEGORY_BY_KEY[f.genre];

  if (!open) {
    return (
      <button
        type="button"
        className={`cookie${cracking ? " cookie--crack" : ""}`}
        onClick={() => {
          setCracking(true);
          sfx.tagClick();
          window.setTimeout(() => {
            setOpen(true);
            writeStore(key, true);
            onOpened();
            sfx.revealChime();
          }, 650);
        }}
      >
        <span className="cookie__icon" aria-hidden>
          🥠
        </span>
        <span>
          <b>포춘 쿠키를 깨서 오늘의 점심 운세 보기</b>
          <span className="muted"> · 하루 한 번</span>
        </span>
      </button>
    );
  }
  return (
    <div className="fortune">
      <p className="fortune__line">“{f.line}”</p>
      <dl className="fortune__facts">
        <div>
          <dt>행운의 장르</dt>
          <dd>
            {cat.emoji} {cat.label}
          </dd>
        </div>
        <div>
          <dt>행운의 방향</dt>
          <dd>{f.direction}</dd>
        </div>
        <div>
          <dt>출발 시각</dt>
          <dd>{f.departAt}</dd>
        </div>
        <div>
          <dt>점심운</dt>
          <dd>{f.score}점</dd>
        </div>
      </dl>
      {onLuckyGenre && (
        <button type="button" className="bbtn bbtn--green bbtn--block" onClick={() => onLuckyGenre(f.genre)}>
          {cat.emoji} {cat.label}으로 오늘의 한 끼 편찬하기 ›
        </button>
      )}
    </div>
  );
}

function Balance({
  today,
  canVote,
  onToast,
  onResult,
}: {
  today: string;
  canVote: boolean;
  onToast: (m: string, i?: string) => void;
  onResult: (summary: string) => void;
}) {
  const q = balanceOfDay(today);
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canVote) return;
    let alive = true;
    void fetchBalance()
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canVote, today]);

  const vote = async (choice: "a" | "b") => {
    if (!canVote) return onToast("투표는 실제 사이트에서만 남길 수 있어요.", "⚖️");
    setBusy(true);
    try {
      const d = await voteBalance(choice);
      setData(d);
      onResult(`${bare(choice === "a" ? q.a : q.b)} ${pctOf(d, choice)}%`);
      sfx.tagClick();
    } catch (err) {
      onToast((err as Error).message, "⚠️");
    } finally {
      setBusy(false);
    }
  };

  const total = data ? data.counts.a + data.counts.b : 0;
  const voted = data?.mine ?? null;

  return (
    <div className="balance">
      <p className="balance__q">
        {q.q}
        {voted && <span className="balance__total muted"> · 동료 {total}명 투표</span>}
      </p>
      <div className="balance__opts">
        {(["a", "b"] as const).map((k) => (
          <button
            type="button"
            key={k}
            className={`balance__opt${voted === k ? " balance__opt--mine" : ""}`}
            disabled={busy}
            onClick={() => void vote(k)}
            aria-pressed={voted === k}
          >
            {voted && <span className="balance__bar" style={{ width: `${pctOf(data!, k)}%` }} aria-hidden />}
            <span className="balance__label">{k === "a" ? q.a : q.b}</span>
            {voted && <b className="balance__pct">{pctOf(data!, k)}%</b>}
          </button>
        ))}
      </div>
    </div>
  );
}
