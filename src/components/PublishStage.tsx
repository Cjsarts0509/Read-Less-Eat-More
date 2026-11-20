import confetti from "canvas-confetti";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import { BADGE_META, daysBetween, isLunchFriendly } from "../../shared/insights";
import type { Branch, Place } from "../../shared/types";
import { bookTitleOf, isbnOf } from "../lib/booktitle";
import { badgesOf, type Ctx } from "../lib/filters";
import { directionsUrl, kakaoPlaceUrl, naverMapUrl, shareText } from "../lib/links";
import { hashString, mulberry32, weightedPick } from "../lib/random";
import { prefersReducedMotion, sfx } from "../lib/sfx";
import { addHistory, readHistory, readStore, writeStore, type PickRecord } from "../lib/storage";
import { Badges, LunchLine } from "./PlaceCard";

interface Props {
  branch: Branch;
  pool: Place[];
  allPlaces: Place[];
  ctx: Ctx;
  poolDesc: string;
  onShowOnMap: (id: string) => void;
  onToast: (msg: string, icon?: string) => void;
}

interface Leaf {
  key: number;
  idx: number;
  title: string;
  name: string;
}

const FLIP_DELAYS = [75, 85, 95, 110, 130, 155, 185, 225, 270];
const RECENT_DAYS = 5;
const DODGE_QUOTES = [
  "사서님, 이러다 점심시간 끝납니다!",
  "반품 기한이 만료되었습니다!",
  "그냥 이거 드세요, 진짜 맛있습니다!",
  "편찬실 서버가 과열되고 있습니다!",
  "완독보다 완뚝! 이제 출발하시죠!",
];

function statusWhileFlipping(n: number, label: string): [string, string] {
  if (n === 0) return [`${label} 사서가 초판 원고를 조판 중입니다...`, "조판 중..."];
  if (n === 1) return ["초판 인쇄 오류! 긴급 개정판 발행 중...", "개정 1판"];
  if (n === 2) return ["사서 의견 긴급 반영! 2쇄 증보판 편찬 중...", "증보 2판"];
  return ["경고! 3회 이상 재추첨으로 최종 확정판이 인쇄됩니다!", `최종 ${n + 1}판`];
}

function statusAfterReveal(n: number, name: string): [string, string] {
  if (n === 0) return [`초판 발행 완료! 오늘의 필독 메뉴는 [${name}]입니다.`, "혹시 다른 책은 없나요? (개정판 재추첨)"];
  if (n === 1) return [`개정 1판 발행! 사서가 엄선한 [${name}] 어떠신가요?`, "한 번만 더 찾아볼게요 (마지막 반품 기회)"];
  if (n === 2) return ["증보 2판 발행! 다음 재추첨 시 반품 불가 도장이 찍힙니다!", "눈 딱 감고 한 번 더! (주의: 반품 불가)"];
  return [`판결 확정! [${name}] 도서는 변심 반품·교환이 불가합니다!`, "반품 불가 (그래도 눌러보시겠습니까?)"];
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function PublishStage({ branch, pool, allPlaces, ctx, poolDesc, onShowOnMap, onToast }: Props) {
  const [opts, setOpts] = useState(() => readStore("rlem:pickOpts", { skipRecent: true, weighted: false }));
  const [history, setHistory] = useState<PickRecord[]>(() => readHistory(branch.code));
  const [result, setResult] = useState<Place | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [rerolls, setRerolls] = useState(0);
  const [log, setLog] = useState<[string, string]>([`${branch.label} 서가 연결 완료! 버튼을 눌러 오늘의 점심을 발행하세요.`, "초판 대기"]);
  const [rerollLabel, setRerollLabel] = useState("");
  const [leaves, setLeaves] = useState<Leaf[]>([]);
  const [stamp, setStamp] = useState(0);
  const [obi, setObi] = useState(0);
  const [dodge, setDodge] = useState({ n: 0, x: 0, y: 0, quote: "" });
  const timers = useRef<number[]>([]);
  const book = useRef<HTMLDivElement>(null);
  const arena = useRef<HTMLDivElement>(null);
  const rerollBtn = useRef<HTMLButtonElement>(null);
  const dodgeRef = useRef(dodge);
  dodgeRef.current = dodge;
  const rerollsRef = useRef(rerolls);
  rerollsRef.current = rerolls;
  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;

  useEffect(() => writeStore("rlem:pickOpts", opts), [opts]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  // 표지 떨림 · 도장 충격은 Web Animations 로 (다시 그리지 않고 여러 번 재생)
  const shakeBook = () =>
    book.current?.animate(
      [
        { transform: "rotate(0deg) scale(1)" },
        { transform: "rotate(-2.5deg) scale(1.02)" },
        { transform: "rotate(2.5deg) scale(1.03)" },
        { transform: "rotate(-2deg) scale(1.02)" },
        { transform: "rotate(2deg) scale(1.01)" },
        { transform: "rotate(0deg) scale(1)" },
      ],
      { duration: 380, easing: "ease-in-out" },
    );
  const impactBook = () =>
    book.current?.animate(
      [
        { transform: "translate(0, 0)" },
        { transform: "translate(-6px, 4px)" },
        { transform: "translate(6px, -4px)" },
        { transform: "translate(-5px, -3px)" },
        { transform: "translate(5px, 3px)" },
        { transform: "translate(-2px, 2px)" },
        { transform: "translate(0, 0)" },
      ],
      { duration: 400, easing: "ease-out" },
    );

  const recentIds = useMemo(
    () => new Set(history.filter((h) => daysBetween(h.date, ctx.today) < RECENT_DAYS).map((h) => h.id)),
    [history, ctx.today],
  );

  // 모두에게 같은 가게가 보이는 '오늘의 팀 추천' (날짜 + 지점 시드)
  const teamPick = useMemo(() => {
    const candidates = allPlaces
      .filter((p) => p.walkMin <= 10 && isLunchFriendly(p.lunch) && p.category !== "dessert" && p.category !== "pub")
      .sort((a, b) => a.id.localeCompare(b.id));
    return weightedPick(candidates, (p) => 1 + Math.log10(1 + (p.naver?.blogTotal ?? 0)), mulberry32(hashString(`${ctx.today}:${branch.code}`)));
  }, [allPlaces, ctx.today, branch.code]);

  const run = (isReroll: boolean) => {
    if (spinningRef.current || pool.length === 0) return;
    const n = isReroll ? rerolls + 1 : 0;
    setRerolls(n);
    if (!isReroll) setDodge({ n: 0, x: 0, y: 0, quote: "" });

    let candidates = pool;
    if (opts.skipRecent) {
      const fresh = pool.filter((p) => !recentIds.has(p.id));
      if (fresh.length) candidates = fresh;
    }
    if (result && candidates.length > 1) candidates = candidates.filter((p) => p.id !== result.id);
    const winner = weightedPick(candidates, (p) => (opts.weighted ? 1 + Math.log10(1 + (p.naver?.blogTotal ?? 0)) * 2 : 1));
    if (!winner) return;

    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setStamp(0);
    // 한 줄 배치(좁은 화면)에서는 책이 버튼 아래에 있어 넘기는 장면이 보이도록 스크롤
    if (window.innerWidth < 960) book.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setLog(statusWhileFlipping(n, branch.label));

    const reveal = () => {
      setLeaves([]);
      setResult(winner);
      setSpinning(false);
      setObi((k) => k + 1);
      const [msg, label] = statusAfterReveal(n, winner.name);
      setLog([msg, n === 0 ? "초판 1쇄" : n >= 3 ? `최종 ${n + 1}판` : `개정 ${n}판`]);
      setRerollLabel(label);
      setDodge({ n: 0, x: 0, y: 0, quote: "" });
      sfx.revealChime();
      void confetti({
        particleCount: 55,
        spread: 68,
        origin: { y: 0.62 },
        colors: ["#005B41", "#FF6B2C", "#F5B82E", "#1A2B4C"],
        disableForReducedMotion: true,
      });
      if (n >= 3) {
        later(() => {
          sfx.stampSlam();
          setStamp((k) => k + 1);
          if (!prefersReducedMotion()) impactBook();
        }, 280);
      }
    };

    if (prefersReducedMotion()) {
      reveal();
      return;
    }

    setSpinning(true);
    shakeBook();
    let t = 160;
    FLIP_DELAYS.forEach((delay, idx) => {
      later(() => {
        sfx.pageFlip(idx);
        const sample = pool[Math.floor(Math.random() * pool.length)]!;
        const leaf: Leaf = { key: Date.now() + idx, idx, title: bookTitleOf(sample), name: sample.name };
        setLeaves((ls) => [...ls.slice(-2), leaf]);
      }, t);
      t += delay;
    });
    later(reveal, t + 120);
  };

  // 4회차부터 재추첨 버튼이 세 번 도망간다 (터치는 passive 가 아닌 리스너가 필요해 직접 붙인다)
  const tryDodge = (): boolean => {
    const d = dodgeRef.current;
    if (rerollsRef.current < 3 || spinningRef.current || d.n >= 3) return false;
    const a = arena.current?.getBoundingClientRect();
    const b = rerollBtn.current?.getBoundingClientRect();
    if (!a || !b) return false;
    const n = d.n + 1;
    const maxX = Math.max(24, (a.width - b.width) / 2 - 8);
    const maxY = Math.max(12, (a.height - b.height) / 2 - 4);
    const dirX = n % 2 === 0 ? -1 : 1;
    const dirY = n === 2 ? -1 : 1;
    let qi = Math.floor(Math.random() * DODGE_QUOTES.length);
    if (DODGE_QUOTES[qi] === d.quote.replace(/ \(\d\/3\)$/, "")) qi = (qi + 1) % DODGE_QUOTES.length;
    sfx.dodgeBoing();
    setDodge({
      n,
      x: Math.round(dirX * maxX * (0.65 + Math.random() * 0.35)),
      y: Math.round(dirY * maxY * (0.6 + Math.random() * 0.4)),
      quote: `${DODGE_QUOTES[qi]} (${n}/3)`,
    });
    return true;
  };
  const tryDodgeRef = useRef(tryDodge);
  tryDodgeRef.current = tryDodge;

  useEffect(() => {
    const el = rerollBtn.current;
    if (!el) return;
    const onTouch = (e: TouchEvent) => {
      if (tryDodgeRef.current()) e.preventDefault();
    };
    el.addEventListener("touchstart", onTouch, { passive: false });
    return () => el.removeEventListener("touchstart", onTouch);
  }, [result]);

  const decide = (p: Place) => {
    setHistory(addHistory(branch.code, { id: p.id, name: p.name, date: ctx.today }));
    sfx.tagClick();
    onToast("대출 완료! 맛있게 드세요", "📗");
  };

  const share = async (p: Place) => {
    const ok = await copyText(shareText(p, branch, bookTitleOf(p)));
    sfx.tagClick();
    onToast(ok ? "사내 메신저용 점심 초대 문구를 복사했어요!" : "복사하지 못했어요. 직접 드래그해 주세요.", ok ? "📋" : "⚠️");
  };

  const demo = result?.id.startsWith("demo-");
  const news = result ? badgesOf(result, ctx)[0] : undefined;
  const obiText = result
    ? news
      ? `★ ${BADGE_META[news.type].label} · ${news.label} ★`
      : result.naver?.blogTotal
        ? `★ 블로그 리뷰 ${result.naver.blogTotal.toLocaleString("ko-KR")}건이 검증한 ${branch.label} 필독서 ★`
        : `★ ${branch.label} 사서 추천! 점심시간 완뚝 보장 ★`
    : "";
  const decidedToday = history.find((h) => h.date === ctx.today);

  return (
    <section className="publish" aria-labelledby="publish-title">
      {/* 왼쪽: 편찬 데스크 */}
      <div className="panel deck">
        <div>
          <div className="step-head">
            <span className="step step--tangerine">STEP 03</span>
            <h2 id="publish-title" className="h2">
              오늘의 한 끼 편찬하기
            </h2>
          </div>
          <p className="deck__lead">
            고민은 책 고를 때만 하세요. <strong className="hl-green">{branch.label}</strong> 인근 <strong>{poolDesc}</strong> 서가{" "}
            <strong>{pool.length}권</strong> 중에서 오늘의 양장본을 즉시 발행합니다.
          </p>
          <div className="log" aria-live="polite">
            <div className="log__head">
              <span>📋 편찬실 실시간 로그</span>
              <span className="log__badge">{log[1]}</span>
            </div>
            <p className="log__msg">“{log[0]}”</p>
          </div>
          <div className="deck__opts">
            <label className="check">
              <input type="checkbox" checked={opts.skipRecent} onChange={(e) => setOpts({ ...opts, skipRecent: e.target.checked })} />
              최근 {RECENT_DAYS}일 안에 대출한 곳 빼기
            </label>
            <label className="check">
              <input type="checkbox" checked={opts.weighted} onChange={(e) => setOpts({ ...opts, weighted: e.target.checked })} />
              리뷰 많은 베스트셀러 우대
            </label>
          </div>
        </div>

        <div className="deck__actions">
          <button type="button" className="bbtn publish-btn" onClick={() => run(false)} disabled={spinning || pool.length === 0}>
            <span aria-hidden>📖</span> {result ? "다른 조건으로 새로 편찬하기" : "오늘의 한 끼 편찬하기"}
          </button>

          {result && (
            <div className="arena" ref={arena}>
              {dodge.quote && <div className="bubble">{dodge.quote}</div>}
              <button
                type="button"
                ref={rerollBtn}
                className="bbtn reroll"
                style={{ transform: `translate(${dodge.x}px, ${dodge.y}px)` }}
                onMouseEnter={() => tryDodge()}
                onClick={() => run(true)}
                disabled={spinning}
              >
                <span aria-hidden>🔄</span> {rerollLabel}
              </button>
            </div>
          )}

          {teamPick && (
            <p className="deck__team">
              <span className="tag-ink">팀 공통 추천</span>
              <button type="button" className="linkish" onClick={() => onShowOnMap(teamPick.id)}>
                {teamPick.name}
              </button>
              <span className="muted">오늘은 누구에게나 같은 책이 보여요</span>
            </p>
          )}
          {history.length > 0 && (
            <div className="deck__history">
              <span className="muted">{decidedToday ? "오늘 대출:" : "최근 대출 기록:"}</span>
              {history.slice(0, 5).map((h) => (
                <span key={`${h.id}-${h.date}`} className="hchip" title={h.date}>
                  {h.name} <small>{h.date.slice(5).replace("-", "/")}</small>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 오른쪽: 3D 양장본 무대 */}
      <div className="stage">
        <span className="corner corner--tl">┌ KDC-EDITION</span>
        <span className="corner corner--tr">HARDCOVER ┐</span>
        <span className="corner corner--bl">└ NO-STARVATION</span>
        <span className="corner corner--br">READ-LESS ┘</span>

        <div ref={book} className="book">
          <div className="book__crease" aria-hidden />

          {leaves.length > 0 && (
            <div className="flips" aria-hidden>
              {leaves.map((l) => (
                <div key={l.key} className={`leaf leaf--${l.idx % 4}`}>
                  <span className="leaf__page">PAGE {String(l.idx + 1).padStart(2, "0")} · 후보 검토 중</span>
                  <p className="leaf__title">{l.title}</p>
                  <p className="leaf__name">{l.name}</p>
                </div>
              ))}
            </div>
          )}

          {stamp > 0 && (
            <div key={`stamp-${stamp}`} className="stamp" role="img" aria-label="변심 반품·교환 불가">
              <div className="stamp__law">읽먹문고 규정 제1조</div>
              <div className="stamp__main">변심 반품·교환 불가</div>
              <div className="stamp__sub">3회 이상 재추첨 적발</div>
            </div>
          )}

          {!result ? (
            <div className="cover">
              <div className="cover__top">
                <span className="cover__press">READ LESS PRESS</span>
                <span className="cover__pill">{branch.label}</span>
              </div>
              <div className="cover__mid">
                <span className="cover__sticker">미개봉 초판 양장본</span>
                <h3 className="cover__title">
                  오늘 당신의
                  <br />
                  위장을 채울
                  <br />한 권의 식사
                </h3>
                <p className="cover__hint">
                  {pool.length ? (
                    <>
                      <b>[오늘의 한 끼 편찬하기]</b>를 누르면
                      <br />
                      책장이 넘어가며 오늘의 식당이 공개됩니다.
                    </>
                  ) : (
                    "조건에 맞는 책이 없어요. 장르 책갈피나 도보 거리를 넓혀 보세요."
                  )}
                </p>
              </div>
              <div className="cover__bottom">
                <span>정가: 점심값 1회분</span>
                <span className="mono">ISBN 978-89-EAT-NOW</span>
              </div>
            </div>
          ) : (
            <div className="revealed">
              <div>
                <div className="revealed__top">
                  <span className="badge-navy">
                    {CATEGORY_BY_KEY[result.category].emoji} {result.categoryPath || CATEGORY_BY_KEY[result.category].label}
                  </span>
                  <span className="badge-mustard">🚶 도보 {result.walkMin}분</span>
                </div>
                <p className="revealed__edition">
                  {branch.label} 서가 · {rerolls === 0 ? "초판 1쇄 발행" : `개정 ${rerolls}판 발행`}
                </p>
                <h3 className="revealed__title">《{bookTitleOf(result)}》</h3>

                <div className="diner">
                  <div className="diner__head">
                    <div>
                      <span className="diner__kicker">TODAY&apos;S DINER &amp; MENU</span>
                      <h4 className="diner__name">{result.name}</h4>
                    </div>
                    <span className="diner__price">{result.ai?.priceHint ?? `${result.distance}m`}</span>
                  </div>
                  {result.ai?.signatureMenus.length ? <p className="diner__menu">대표 메뉴: {result.ai.signatureMenus.join(" · ")}</p> : null}
                  <Badges place={result} ctx={ctx} />
                  {result.ai?.summary && <p className="diner__review">“사서 한줄평: {result.ai.summary}”</p>}
                  <LunchLine place={result} />
                </div>
              </div>

              <div key={`obi-${obi}`} className="obi">
                <span>{obiText}</span>
                <span className="obi__tag">띠지추천</span>
              </div>

              <div>
                <div className="revealed__links">
                  <a className="bbtn bbtn--naver" href={naverMapUrl(result)} target="_blank" rel="noreferrer">
                    🗺️ 네이버 지도
                  </a>
                  {demo ? (
                    <a className="bbtn bbtn--kakao" href={directionsUrl(result)} target="_blank" rel="noreferrer">
                      📍 카카오 길찾기
                    </a>
                  ) : (
                    <a className="bbtn bbtn--kakao" href={kakaoPlaceUrl(result)} target="_blank" rel="noreferrer">
                      📍 카카오맵
                    </a>
                  )}
                  <button type="button" className="bbtn" onClick={() => onShowOnMap(result.id)}>
                    🧭 서가 지도에서 보기
                  </button>
                  <button type="button" className="bbtn bbtn--green" onClick={() => decide(result)}>
                    ✅ 여기로 대출하기
                  </button>
                </div>
                <button type="button" className="bbtn bbtn--ink bbtn--block" onClick={() => share(result)}>
                  📋 사내 메신저 점심 초대 문구 복사
                </button>
                <div className="colophon">
                  <span>출판: 읽지 않고 먹습니다 식도락문고</span>
                  <span className="colophon__code">
                    <span className="barcode" aria-hidden />
                    <span className="mono">{isbnOf(branch.code, result)}</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
