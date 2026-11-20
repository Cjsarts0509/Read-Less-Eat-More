import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import { daysBetween, isLunchFriendly } from "../../shared/insights";
import type { Branch, Place } from "../../shared/types";
import type { Ctx } from "../lib/filters";
import { shareText } from "../lib/links";
import { hashString, mulberry32, weightedPick } from "../lib/random";
import { addHistory, readHistory, readStore, writeStore, type PickRecord } from "../lib/storage";
import { Badges, LunchLine, PlaceLinks } from "./PlaceCard";

interface Props {
  branch: Branch;
  pool: Place[];
  allPlaces: Place[];
  ctx: Ctx;
  poolLabel: string;
  onShowOnMap: (id: string) => void;
}

interface PickOptions {
  skipRecent: boolean;
  weighted: boolean;
}

const RECENT_DAYS = 5;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function RandomPick({ branch, pool, allPlaces, ctx, poolLabel, onShowOnMap }: Props) {
  const [opts, setOpts] = useState<PickOptions>(() => readStore("rlem:pickOpts", { skipRecent: true, weighted: false }));
  const [history, setHistory] = useState<PickRecord[]>(() => readHistory(branch.code));
  const [rolling, setRolling] = useState(false);
  const [ticker, setTicker] = useState<string | null>(null);
  const [result, setResult] = useState<Place | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setHistory(readHistory(branch.code));
    setResult(null);
    setTicker(null);
  }, [branch.code]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => writeStore("rlem:pickOpts", opts), [opts]);

  const recentIds = useMemo(
    () => new Set(history.filter((h) => daysBetween(h.date, ctx.today) < RECENT_DAYS).map((h) => h.id)),
    [history, ctx.today],
  );

  // 모두에게 같은 가게가 보이는 '오늘의 팀 추천' (날짜 + 지점으로 시드)
  const teamPick = useMemo(() => {
    const candidates = allPlaces
      .filter((p) => p.walkMin <= 10 && isLunchFriendly(p.lunch) && p.category !== "dessert" && p.category !== "pub")
      .sort((a, b) => a.id.localeCompare(b.id));
    const rng = mulberry32(hashString(`${ctx.today}:${branch.code}`));
    return weightedPick(candidates, (p) => 1 + Math.log10(1 + (p.naver?.blogTotal ?? 0)), rng);
  }, [allPlaces, ctx.today, branch.code]);

  const draw = () => {
    if (rolling) return;
    let candidates = pool;
    if (opts.skipRecent) {
      const fresh = pool.filter((p) => !recentIds.has(p.id));
      if (fresh.length) candidates = fresh;
    }
    if (candidates.length > 1 && result) candidates = candidates.filter((p) => p.id !== result.id);
    const weight = (p: Place) => (opts.weighted ? 1 + Math.log10(1 + (p.naver?.blogTotal ?? 0)) * 2 : 1);
    const winner = weightedPick(candidates, weight);
    if (!winner) return;

    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setResult(null);

    if (prefersReducedMotion() || candidates.length === 1) {
      setTicker(null);
      setResult(winner);
      return;
    }
    setRolling(true);
    const steps = 18;
    let elapsed = 0;
    for (let i = 0; i < steps; i++) {
      elapsed += 35 + i * i * 0.45; // 점점 느려지게 (약 1.5초)
      const name = i === steps - 1 ? winner.name : candidates[Math.floor(Math.random() * candidates.length)]!.name;
      timers.current.push(window.setTimeout(() => setTicker(name), elapsed));
    }
    timers.current.push(
      window.setTimeout(() => {
        setRolling(false);
        setTicker(null);
        setResult(winner);
      }, elapsed + 280),
    );
  };

  const decide = (p: Place) => {
    setHistory(addHistory(branch.code, { id: p.id, name: p.name, date: ctx.today }));
    flash("기록했어요. 맛있게 드세요! 🍚");
  };

  const share = async (p: Place) => {
    const text = shareText(p, branch);
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      flash("메신저에 붙여 넣을 문구를 복사했어요");
    } catch {
      /* 사용자가 공유 창을 닫은 경우 */
    }
  };

  function flash(msg: string) {
    setToast(msg);
    timers.current.push(window.setTimeout(() => setToast(null), 2400));
  }

  const decidedToday = history.find((h) => h.date === ctx.today);

  return (
    <section className="pick" aria-labelledby="pick-title">
      <div className="pick__head">
        <h2 id="pick-title" className="section-title">
          오늘의 한 끼
        </h2>
        <p className="muted pick__pool">{poolLabel}</p>
      </div>

      <div className="pick__stage" aria-live="polite">
        {ticker && <p className="pick__ticker">{ticker}</p>}
        {!ticker && !result && (
          <p className="pick__empty">
            {pool.length ? "고르기 어려울 땐, 한 장 뽑아 보세요." : "조건에 맞는 식당이 없어요. 필터를 넓혀 보세요."}
          </p>
        )}
        {result && !ticker && (
          <div className="slip">
            <div className="slip__stamp" aria-hidden>
              오늘의 점심
            </div>
            <p className="slip__cat">
              {CATEGORY_BY_KEY[result.category].emoji} {result.categoryPath} · 도보 {result.walkMin}분
            </p>
            <h3 className="slip__name">{result.name}</h3>
            <Badges place={result} ctx={ctx} />
            {result.ai?.summary && <p className="slip__summary">{result.ai.summary}</p>}
            {result.ai?.signatureMenus.length ? (
              <p className="card__menus">
                <span className="muted">대표 메뉴</span> {result.ai.signatureMenus.join(" · ")}
              </p>
            ) : null}
            <LunchLine place={result} />
            <PlaceLinks place={result} onShowOnMap={onShowOnMap} />
            <div className="slip__actions">
              <button type="button" className="btn btn--accent" onClick={() => decide(result)}>
                여기로 결정!
              </button>
              <button type="button" className="btn" onClick={() => share(result)}>
                공유하기
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pick__controls">
        <button type="button" className="draw" onClick={draw} disabled={!pool.length || rolling}>
          <span aria-hidden>🎲</span> {result ? "다시 뽑기" : "뽑기"}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={opts.skipRecent}
            onChange={(e) => setOpts({ ...opts, skipRecent: e.target.checked })}
          />
          최근 {RECENT_DAYS}일 안에 간 곳 빼기
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.weighted} onChange={(e) => setOpts({ ...opts, weighted: e.target.checked })} />
          리뷰 많은 곳이 더 잘 나오게
        </label>
      </div>

      {teamPick && (
        <p className="pick__team">
          <span className="muted">오늘의 팀 추천</span>{" "}
          <button type="button" className="linkish" onClick={() => onShowOnMap(teamPick.id)}>
            {teamPick.name}
          </button>{" "}
          <span className="muted">· 오늘은 누구에게나 같은 곳이 보여요</span>
        </p>
      )}

      {history.length > 0 && (
        <div className="pick__history">
          <span className="muted">{decidedToday ? "오늘 결정:" : "최근 다녀온 곳:"}</span>
          {history.slice(0, 6).map((h) => (
            <span key={`${h.id}-${h.date}`} className="hchip" title={h.date}>
              {h.name} <span className="muted">{h.date.slice(5).replace("-", "/")}</span>
            </span>
          ))}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}
