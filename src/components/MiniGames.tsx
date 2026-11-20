/**
 * 심심풀이 미니게임: 메뉴 월드컵 · 사다리 타기.
 */
import confetti from "canvas-confetti";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import { makeRungs, traceLadder } from "../../shared/ladder";
import type { CategoryKey } from "../../shared/types";
import { sfx } from "../lib/sfx";
import { readStore, writeStore } from "../lib/storage";

// ---------- 메뉴 월드컵 ----------

interface Dish {
  name: string;
  emoji: string;
  cat: CategoryKey;
}

const DISHES: Dish[] = [
  { name: "김치찌개", emoji: "🍲", cat: "korean" },
  { name: "제육볶음", emoji: "🐖", cat: "korean" },
  { name: "국밥", emoji: "🥣", cat: "korean" },
  { name: "냉면", emoji: "🧊", cat: "korean" },
  { name: "비빔밥", emoji: "🍚", cat: "korean" },
  { name: "순두부찌개", emoji: "🌶️", cat: "korean" },
  { name: "칼국수", emoji: "🍜", cat: "korean" },
  { name: "부대찌개", emoji: "🌭", cat: "korean" },
  { name: "삼겹살", emoji: "🥓", cat: "korean" },
  { name: "짜장면", emoji: "🥢", cat: "chinese" },
  { name: "짬뽕", emoji: "🦑", cat: "chinese" },
  { name: "마라탕", emoji: "🥘", cat: "chinese" },
  { name: "탕수육", emoji: "🍖", cat: "chinese" },
  { name: "초밥", emoji: "🍣", cat: "japanese" },
  { name: "돈가스", emoji: "🍱", cat: "japanese" },
  { name: "라멘", emoji: "🍥", cat: "japanese" },
  { name: "규동", emoji: "🐂", cat: "japanese" },
  { name: "우동", emoji: "🍜", cat: "japanese" },
  { name: "파스타", emoji: "🍝", cat: "western" },
  { name: "피자", emoji: "🍕", cat: "western" },
  { name: "스테이크", emoji: "🥩", cat: "western" },
  { name: "쌀국수", emoji: "🍜", cat: "asian" },
  { name: "팟타이", emoji: "🍤", cat: "asian" },
  { name: "카레", emoji: "🍛", cat: "asian" },
  { name: "떡볶이", emoji: "🍢", cat: "snack" },
  { name: "김밥", emoji: "🍙", cat: "snack" },
  { name: "햄버거", emoji: "🍔", cat: "fastfood" },
  { name: "샌드위치", emoji: "🥪", cat: "fastfood" },
  { name: "샐러드", emoji: "🥗", cat: "healthy" },
  { name: "포케", emoji: "🥙", cat: "healthy" },
];

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const ROUND_LABEL: Record<number, string> = { 8: "8강", 4: "4강", 2: "결승" };

export function WorldCup({
  onResult,
  onLuckyGenre,
}: {
  onResult: (summary: string) => void;
  onLuckyGenre?: ((k: CategoryKey) => void) | null;
}) {
  const [round, setRound] = useState<Dish[]>(() => shuffled(DISHES).slice(0, 8));
  const [next, setNext] = useState<Dish[]>([]);
  const [match, setMatch] = useState(0);
  const [winner, setWinner] = useState<Dish | null>(null);

  const restart = () => {
    setRound(shuffled(DISHES).slice(0, 8));
    setNext([]);
    setMatch(0);
    setWinner(null);
  };

  const choose = (d: Dish) => {
    sfx.tagClick();
    const picked = [...next, d];
    if (match + 1 < round.length / 2) {
      setNext(picked);
      setMatch(match + 1);
    } else if (picked.length === 1) {
      setWinner(d);
      onResult(`🏆 ${d.emoji} ${d.name}`);
      sfx.revealChime();
      void confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 }, disableForReducedMotion: true });
    } else {
      setRound(picked);
      setNext([]);
      setMatch(0);
    }
  };

  if (winner) {
    const cat = CATEGORY_BY_KEY[winner.cat];
    return (
      <div className="wc__win">
        <span className="wc__trophy" aria-hidden>
          🏆
        </span>
        <p className="wc__kicker">오늘의 우승 메뉴</p>
        <p className="wc__winner">
          {winner.emoji} {winner.name}
        </p>
        <p className="muted">
          {cat.emoji} {cat.label} 서가에서 찾아보세요
        </p>
        <div className="wc__actions">
          <button type="button" className="bbtn" onClick={restart}>
            🔁 다시 하기
          </button>
          {onLuckyGenre && (
            <button type="button" className="bbtn bbtn--green" onClick={() => onLuckyGenre(winner.cat)}>
              {cat.label}으로 편찬하기 ›
            </button>
          )}
        </div>
      </div>
    );
  }

  const a = round[match * 2]!;
  const b = round[match * 2 + 1]!;
  const total = round.length / 2;
  return (
    <div className="wc">
      <div className="wc__head">
        <span className="wc__round">{ROUND_LABEL[round.length]}</span>
        <span className="muted">
          {match + 1} / {total}
        </span>
      </div>
      <div className="wc__bar" aria-hidden>
        <span style={{ width: `${((match + 1) / total) * 100}%` }} />
      </div>
      <div className="wc__match">
        {[a, b].map((d, i) => (
          <DishCard key={`${d.name}-${i}`} dish={d} onPick={choose} />
        ))}
        <span className="wc__vs" aria-hidden>
          VS
        </span>
      </div>
      <p className="muted wc__hint">더 먹고 싶은 쪽을 누르세요</p>
    </div>
  );
}

function DishCard({ dish, onPick }: { dish: Dish; onPick: (d: Dish) => void }) {
  const cat = CATEGORY_BY_KEY[dish.cat];
  return (
    <button type="button" className="wc__pick" onClick={() => onPick(dish)}>
      <span className="wc__emoji" aria-hidden>
        {dish.emoji}
      </span>
      <span className="wc__name">{dish.name}</span>
      <span className="wc__cat">{cat.label}</span>
    </button>
  );
}

// ---------- 사다리 타기 ----------

const PRIZES = ["☕ 커피 쏘기", "🧾 점심 계산", "🍽️ 메뉴 정하기", "🍦 디저트 쏘기"];
const COLORS = ["#ff6b2c", "#005b41", "#3d7cc9", "#8c1c2b", "#5b2a6e", "#c48a12"];
const ROWS = 8;
const DRAW_MS = 1700;

interface LadderGame {
  rungs: boolean[][];
  slots: string[];
  ends: number[];
  paths: string[];
}

export function Ladder({ onResult }: { onResult: (summary: string) => void }) {
  const [names, setNames] = useState<string[]>(() => readStore("lmp:ladderNames", ["나", "동료 1", "동료 2", "동료 3"]));
  const [prize, setPrize] = useState(PRIZES[0]!);
  const [game, setGame] = useState<LadderGame | null>(null);
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<number>(0);
  const n = names.length;
  const W = n * 100;
  const H = 240;

  useEffect(() => writeStore("lmp:ladderNames", names), [names]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const resize = (m: number) => {
    setGame(null);
    setRevealed(false);
    setNames((ns) => (m > ns.length ? [...ns, ...Array.from({ length: m - ns.length }, (_, i) => `동료 ${ns.length + i}`)] : ns.slice(0, m)));
  };

  const start = () => {
    window.clearTimeout(timer.current);
    sfx.tagClick();
    const rungs = makeRungs(n, ROWS);
    const win = Math.floor(Math.random() * n);
    const slots = Array.from({ length: n }, (_, i) => (i === win ? prize : "통과 😌"));
    const ends: number[] = [];
    const paths: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = traceLadder(rungs, i);
      ends.push(t.end);
      paths.push(t.points.map(([x, y], k) => `${k ? "L" : "M"}${50 + x * 100} ${10 + y * (H - 20)}`).join(" "));
    }
    setGame({ rungs, slots, ends, paths });
    setRevealed(false);
    timer.current = window.setTimeout(() => {
      setRevealed(true);
      const who = ends.findIndex((e) => e === win);
      const name = names[who]?.trim() || `${who + 1}번`;
      onResult(`${prize.split(" ")[0]} ${name}`);
      sfx.revealChime();
    }, DRAW_MS + n * 120);
  };

  const winnerIdx = game && revealed ? game.ends.findIndex((e) => game.slots[e] !== "통과 😌") : -1;

  return (
    <div className="ladder">
      <div className="ladder__opts">
        <span className="ladder__count" role="group" aria-label="인원">
          <button type="button" className="bbtn bbtn--sm" disabled={n <= 2} onClick={() => resize(n - 1)} aria-label="한 명 빼기">
            −
          </button>
          <b>{n}명</b>
          <button type="button" className="bbtn bbtn--sm" disabled={n >= 6} onClick={() => resize(n + 1)} aria-label="한 명 더하기">
            +
          </button>
        </span>
        <span className="ladder__prizes" role="radiogroup" aria-label="당첨 내용">
          {PRIZES.map((p) => (
            <button
              type="button"
              key={p}
              role="radio"
              aria-checked={prize === p}
              className={`ladder__prize${prize === p ? " ladder__prize--on" : ""}`}
              onClick={() => {
                setPrize(p);
                setGame(null);
                setRevealed(false);
              }}
            >
              {p}
            </button>
          ))}
        </span>
      </div>

      <div className="ladder__names" style={{ "--n": n } as React.CSSProperties}>
        {names.map((nm, i) => (
          <input
            key={i}
            value={nm}
            maxLength={8}
            aria-label={`${i + 1}번 이름`}
            style={{ borderColor: game ? COLORS[i] : undefined }}
            onChange={(e) => setNames((ns) => ns.map((x, k) => (k === i ? e.target.value : x)))}
          />
        ))}
      </div>

      <svg className="ladder__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {names.map((_, i) => (
          <line key={`v${i}`} x1={50 + i * 100} y1={10} x2={50 + i * 100} y2={H - 10} className="ladder__rail" />
        ))}
        {game?.rungs.map((row, r) =>
          row.map((on, c) =>
            on ? (
              <line
                key={`r${r}-${c}`}
                x1={50 + c * 100}
                x2={150 + c * 100}
                y1={10 + ((r + 1) / (ROWS + 1)) * (H - 20)}
                y2={10 + ((r + 1) / (ROWS + 1)) * (H - 20)}
                className="ladder__rail"
              />
            ) : null,
          ),
        )}
        {game?.paths.map((d, i) => (
          <path
            key={`p${i}-${d.length}`}
            d={d}
            pathLength={1}
            className="ladder__path"
            style={{ stroke: COLORS[i], animationDelay: `${i * 120}ms` }}
          />
        ))}
      </svg>

      <div className="ladder__slots" style={{ "--n": n } as React.CSSProperties}>
        {Array.from({ length: n }, (_, i) => {
          const text = game && revealed ? game.slots[i] : "?";
          const win = game && revealed && game.slots[i] !== "통과 😌";
          // 이 칸에 도착한 사람 (색 · 이름)
          const who = game && revealed ? game.ends.indexOf(i) : -1;
          return (
            <span
              key={i}
              className={`ladder__slot${win ? " ladder__slot--win" : ""}`}
              style={who >= 0 ? { borderColor: COLORS[who] } : undefined}
            >
              {text}
              {who >= 0 && (
                <small className="ladder__who" style={{ color: COLORS[who] }}>
                  {names[who]?.trim() || `${who + 1}번`}
                </small>
              )}
            </span>
          );
        })}
      </div>

      {winnerIdx >= 0 && (
        <p className="ladder__result">
          {prize} 당첨: <b>{names[winnerIdx]?.trim() || `${winnerIdx + 1}번`}</b> 🎉
        </p>
      )}

      <button type="button" className="bbtn bbtn--green bbtn--block ladder__go" onClick={start}>
        🪜 {game ? "다시 타기" : "사다리 타기"}
      </button>
    </div>
  );
}
