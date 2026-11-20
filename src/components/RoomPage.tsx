import { travelText } from "../../shared/geo";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import type { Branch, Place } from "../../shared/types";
import {
  decideRoom,
  getRoom,
  joinRoom,
  mediateRoom,
  savedNickname,
  saveNickname,
  voteRoom,
  type RoomPrefs,
  type RoomView,
} from "../lib/api";
import { bookTitleOf } from "../lib/booktitle";
import { loadPlaces } from "../lib/data";
import { directionsUrl, naverMapUrl } from "../lib/links";
import { sfx } from "../lib/sfx";

interface Props {
  code: string;
  branches: Branch[];
  onToast: (msg: string, icon?: string) => void;
}

const BUDGETS: Array<{ v: RoomPrefs["budget"]; label: string }> = [
  { v: "10000", label: "1만원 이하" },
  { v: "15000", label: "1.5만원 이하" },
  { v: "any", label: "상관없음" },
];
const WALKS: RoomPrefs["maxWalk"][] = [5, 10, 15];

function timeLeft(deadline: string | null, now: number): string | null {
  if (!deadline) return null;
  const diff = Math.round((Date.parse(deadline) - now) / 60000);
  const hhmm = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(
    new Date(deadline),
  );
  return diff > 0 ? `${hhmm} 마감까지 ${diff}분` : `${hhmm} 마감 시간이 지났어요`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 팀 투표방: 취향 모으기 → AI 사서 중재(3곳) → 투표 → 결정 도장 */
export function RoomPage({ code, branches, onToast }: Props) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [places, setPlaces] = useState<Map<string, Place>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState<{ nickname: string } & RoomPrefs>({
    nickname: savedNickname(),
    want: "",
    avoid: "",
    budget: "any",
    maxWalk: 10,
  });

  const branch = useMemo(() => branches.find((b) => b.code === room?.branch) ?? null, [branches, room?.branch]);
  const me = room?.members.find((m) => m.isMe);

  const refresh = useCallback(async () => {
    try {
      const r = await getRoom(code);
      setRoom(r);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [code]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
      setNow(Date.now());
    }, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!branch) return;
    void loadPlaces(branch, false).then((d) => setPlaces(new Map((d?.places ?? []).map((p) => [p.id, p]))));
  }, [branch]);

  useEffect(() => {
    if (me) setForm((f) => ({ ...f, nickname: me.nickname, ...me.prefs }));
  }, [me?.nickname]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (name: string, fn: () => Promise<RoomView>, done?: string) => {
    setBusy(name);
    try {
      setRoom(await fn());
      setError(null);
      if (done) onToast(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const link = `${location.origin}/?room=${code}`;
  const votes = new Map<string, number>();
  for (const m of room?.members ?? []) if (m.vote) votes.set(m.vote, (votes.get(m.vote) ?? 0) + 1);
  const decided = room?.decided ? places.get(room.decided) : undefined;

  if (!room) {
    return (
      <section className="panel empty-panel">
        <p className="h2">{error ? `🗳️ ${error}` : "투표방을 여는 중…"}</p>
        <a className="bbtn" href="/">
          ← 오늘의 한 끼로
        </a>
      </section>
    );
  }

  return (
    <div className="room">
      <section className="panel room__head">
        <div className="step-row">
          <div className="step-head">
            <span className="step step--tangerine">팀 투표방</span>
            <h2 className="h2">
              {room.title || `${branch?.label ?? ""} 점심 투표`} <small>#{room.code}</small>
            </h2>
          </div>
          <div className="room__tools">
            <span className="count-pill">⏱ {timeLeft(room.deadline, now) ?? "마감 없음"}</span>
            <button
              type="button"
              className="bbtn bbtn--sm"
              onClick={async () => onToast((await copy(`🗳️ 오늘 점심 같이 정해요!\n${link}`)) ? "투표방 링크를 복사했어요" : link, "📋")}
            >
              📋 링크 복사
            </button>
            <a className="bbtn bbtn--sm" href={branch ? `/?b=${branch.code}` : "/"}>
              ← 오늘의 한 끼
            </a>
          </div>
        </div>
        <p className="hint">링크를 메신저에 붙여 넣으면 누구나 닉네임만 적고 들어올 수 있어요. 화면은 4초마다 새로 고쳐져요.</p>
        {error && <p className="chat__error">{error}</p>}
      </section>

      <div className="room__grid">
        {/* 참여 · 취향 */}
        <section className="panel" aria-labelledby="room-join">
          <h3 id="room-join" className="h3">
            {me ? "내 취향 고치기" : "참여하기"}
          </h3>
          <form
            className="room__form"
            onSubmit={(e) => {
              e.preventDefault();
              const { nickname, ...prefs } = form;
              saveNickname(nickname.trim());
              sfx.tagClick();
              void act("join", () => joinRoom(code, nickname.trim(), prefs), me ? "취향을 고쳤어요" : "참여했어요!");
            }}
          >
            <label className="field">
              <span>닉네임</span>
              <input id="room-nick" className="input" required maxLength={20} value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
            </label>
            <label className="field">
              <span>먹고 싶은 것</span>
              <input id="room-want" className="input" maxLength={60} placeholder="예) 국물, 고기, 가벼운 거" value={form.want} onChange={(e) => setForm({ ...form, want: e.target.value })} />
            </label>
            <label className="field">
              <span>피하고 싶은 것 · 못 먹는 것</span>
              <input id="room-avoid" className="input" maxLength={60} placeholder="예) 해산물 알레르기, 매운 것" value={form.avoid} onChange={(e) => setForm({ ...form, avoid: e.target.value })} />
            </label>
            <div className="field">
              <span>예산 (1인)</span>
              <div className="seg">
                {BUDGETS.map((b) => (
                  <button type="button" key={b.v} className={`seg__btn${form.budget === b.v ? " seg__btn--on" : ""}`} onClick={() => setForm({ ...form, budget: b.v })}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>걸을 수 있는 시간</span>
              <div className="seg">
                {WALKS.map((w) => (
                  <button type="button" key={w} className={`seg__btn${form.maxWalk === w ? " seg__btn--on" : ""}`} onClick={() => setForm({ ...form, maxWalk: w })}>
                    {w}분
                  </button>
                ))}
              </div>
            </div>
            <button type="submit" className="bbtn bbtn--green" disabled={busy !== null || !form.nickname.trim()}>
              {me ? "저장" : "참여하기"}
            </button>
          </form>

          <h3 className="h3 room__members-title">참여자 {room.members.length}명</h3>
          <ul className="room__members">
            {room.members.map((m) => (
              <li key={m.nickname + m.isMe} className={m.isMe ? "is-me" : ""}>
                <b>{m.nickname}</b> {m.vote ? "✅" : ""}
                <span className="muted">
                  {[m.prefs.want && `👍 ${m.prefs.want}`, m.prefs.avoid && `🚫 ${m.prefs.avoid}`, `🚶 ${m.prefs.maxWalk}분`].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
            {room.members.length === 0 && <li className="muted">아직 아무도 없어요. 먼저 참여해 주세요.</li>}
          </ul>
        </section>

        {/* 중재 · 투표 */}
        <section className="panel room__stage" aria-labelledby="room-cands">
          <div className="step-row">
            <h3 id="room-cands" className="h3">
              AI 사서의 중재안
            </h3>
            {!room.decided && (
              <button
                type="button"
                className="bbtn bbtn--green"
                disabled={busy !== null || room.members.length === 0}
                onClick={() => {
                  sfx.spinePop();
                  void act("mediate", () => mediateRoom(code), "중재안이 나왔어요");
                }}
              >
                🤖 {busy === "mediate" ? "모두의 취향을 읽는 중…" : room.candidates.length ? "다시 중재받기" : "AI 사서에게 중재 맡기기"}
              </button>
            )}
          </div>
          {room.mediation && <p className="room__comment">“{room.mediation.comment}”</p>}

          {decided && (
            <div className="room__decided">
              <div className="stamp stamp--static" aria-hidden>
                <div className="stamp__law">팀 점심 규정 제1조</div>
                <div className="stamp__main">결정! 반품 불가</div>
              </div>
              <p className="revealed__edition">오늘의 팀 점심</p>
              <h4 className="revealed__title">《{bookTitleOf(decided)}》</h4>
              <p className="diner__name">{decided.name}</p>
              <p className="muted">
                {decided.categoryPath} · {travelText(decided)}
              </p>
              <div className="revealed__links">
                <a className="bbtn bbtn--naver" href={naverMapUrl(decided)} target="_blank" rel="noreferrer">
                  🗺️ 네이버 지도
                </a>
                <a className="bbtn bbtn--kakao" href={directionsUrl(decided)} target="_blank" rel="noreferrer">
                  📍 길찾기
                </a>
              </div>
            </div>
          )}

          {room.candidates.length === 0 ? (
            <p className="empty">참여자들이 취향을 적은 뒤 「AI 사서에게 중재 맡기기」를 누르면 모두에게 맞는 3곳을 골라 드려요.</p>
          ) : (
            <ol className="room__cands">
              {room.candidates.map((c) => {
                const p = places.get(c.id);
                const n = votes.get(c.id) ?? 0;
                const mine = me?.vote === c.id;
                const pct = room.members.length ? Math.round((n / room.members.length) * 100) : 0;
                return (
                  <li key={c.id} className={`cand${mine ? " cand--mine" : ""}${room.decided === c.id ? " cand--won" : ""}`}>
                    <div className="cand__cover">
                      <span className="cand__cat">{p ? `${CATEGORY_BY_KEY[p.category].emoji} ${p.categoryPath}` : ""}</span>
                      <b className="cand__title">《{p ? bookTitleOf(p) : c.id}》</b>
                      <span>{p?.name}</span>
                      {p && <span className="muted">{travelText(p)}</span>}
                    </div>
                    <div className="cand__body">
                      <p>{c.reason}</p>
                      {c.notes.length > 0 && (
                        <ul className="cand__notes">
                          {c.notes.map((nt) => (
                            <li key={nt.nickname}>
                              <b>{nt.nickname}</b> {nt.note}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="cand__vote">
                        <div className="cand__bar" style={{ "--v": `${pct}%` } as React.CSSProperties} aria-hidden />
                        <span>{n}표</span>
                        {!room.decided && me && (
                          <button
                            type="button"
                            className={`bbtn bbtn--sm${mine ? " bbtn--ink" : ""}`}
                            disabled={busy !== null}
                            onClick={() => {
                              sfx.tagClick();
                              void act("vote", () => voteRoom(code, mine ? null : c.id));
                            }}
                          >
                            {mine ? "✔ 내 표" : "여기 투표"}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {!room.decided && room.candidates.length > 0 && (
            <button
              type="button"
              className="bbtn publish-btn"
              disabled={busy !== null}
              onClick={() => {
                sfx.stampSlam();
                void act("decide", () => decideRoom(code), "결정했어요! 맛있게 드세요");
              }}
            >
              📕 지금 표로 결정하기
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
