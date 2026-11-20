import { useEffect, useState } from "react";
import type { BalanceResponse } from "../../shared/api";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import { balanceOfDay, fortuneOf } from "../../shared/fun";
import type { CategoryKey } from "../../shared/types";
import { fetchBalance, memberKey, voteBalance } from "../lib/api";
import { sfx } from "../lib/sfx";
import { readStore, writeStore } from "../lib/storage";

type Tab = "fortune" | "balance";

interface Props {
  today: string;
  /** 투표를 서버에 남길 수 있는가 */
  canVote: boolean;
  /** 행운의 장르로 바로 편찬 (지점 서가가 열려 있을 때만) */
  onLuckyGenre?: ((k: CategoryKey) => void) | null;
  onToast: (msg: string, icon?: string) => void;
}

/** 머리의 심심풀이: 오늘의 점심 운세 · 오늘의 밸런스 게임 */
export function FunCorner({ today, canVote, onLuckyGenre, onToast }: Props) {
  const [tab, setTab] = useState<Tab>(() => readStore<Tab>("lmp:funTab", "fortune"));
  useEffect(() => writeStore("lmp:funTab", tab), [tab]);

  return (
    <section className="fun" aria-label="심심풀이">
      <div className="fun__tabs" role="tablist">
        {(
          [
            ["fortune", "🥠 점심 운세"],
            ["balance", "⚖️ 밸런스 게임"],
          ] as const
        ).map(([k, label]) => (
          <button
            type="button"
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`fun__tab${tab === k ? " fun__tab--on" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "fortune" ? (
        <Fortune today={today} onLuckyGenre={onLuckyGenre} />
      ) : (
        <Balance today={today} canVote={canVote} onToast={onToast} />
      )}
    </section>
  );
}

function Fortune({ today, onLuckyGenre }: { today: string; onLuckyGenre?: ((k: CategoryKey) => void) | null }) {
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
            sfx.revealChime();
          }, 650);
        }}
      >
        <span className="cookie__icon" aria-hidden>
          🥠
        </span>
        <span>
          <b>오늘의 점심 운세 열기</b>
          <span className="muted"> · 하루 한 번</span>
        </span>
      </button>
    );
  }
  return (
    <div className="fortune">
      <p className="fortune__line">“{f.line}”</p>
      <p className="fortune__meta">
        행운의 장르{" "}
        <b>
          {cat.emoji} {cat.label}
        </b>{" "}
        · 방향 <b>{f.direction}</b> · 출발 <b>{f.departAt}</b> · 점심운 <b>{f.score}점</b>
      </p>
      {onLuckyGenre && (
        <button type="button" className="linkish fortune__go" onClick={() => onLuckyGenre(f.genre)}>
          {cat.label}으로 오늘의 한 끼 편찬하기 ›
        </button>
      )}
    </div>
  );
}

function Balance({ today, canVote, onToast }: { today: string; canVote: boolean; onToast: (m: string, i?: string) => void }) {
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
      setData(await voteBalance(choice));
      sfx.tagClick();
    } catch (err) {
      onToast((err as Error).message, "⚠️");
    } finally {
      setBusy(false);
    }
  };

  const total = data ? data.counts.a + data.counts.b : 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const voted = data?.mine ?? null;

  return (
    <div className="balance">
      <p className="balance__q">{q.q}</p>
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
            {voted && <span className="balance__bar" style={{ width: `${pct(data!.counts[k])}%` }} aria-hidden />}
            <span className="balance__label">{k === "a" ? q.a : q.b}</span>
            {voted && <b className="balance__pct">{pct(data!.counts[k])}%</b>}
          </button>
        ))}
      </div>
      <p className="balance__foot muted">{voted ? `동료 ${total}명 투표 · 다시 누르면 바꿀 수 있어요` : "골라야 동료들의 선택이 보여요"}</p>
    </div>
  );
}
