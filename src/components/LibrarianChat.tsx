import { travelText } from "../../shared/geo";
import { useEffect, useRef, useState } from "react";
import type { Branch, Place } from "../../shared/types";
import { sendChat, type ChatMessage, type ChatReply } from "../lib/api";
import { bookTitleOf } from "../lib/booktitle";

interface Props {
  branch: Branch;
  candidates: Place[];
  weatherText?: string;
  timeBudget: number;
  onShowOnMap: (id: string) => void;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  picks?: ChatReply["picks"];
  quick?: string[];
}

const STARTERS = ["비 오는 날 뜨끈한 국물", "1시 회의 전 40분밖에 없어요", "4명, 1만원 이하", "어제 과음했어요"];

/** 사서와 대화 — 여러 번 주고받으며 조건을 좁혀 추천 */
export function LibrarianChat({ branch, candidates, weatherText, timeBudget, onShowOnMap }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const byId = new Map(candidates.map((p) => [p.id, p]));

  useEffect(() => {
    setTurns([]);
    setError(null);
  }, [branch.code]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const send = async (msg: string) => {
    const content = msg.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const history: ChatMessage[] = next.map((t) => ({ role: t.role, content: t.content }));
      const res = await sendChat({
        branch: branch.code,
        ids: candidates.slice(0, 120).map((p) => p.id),
        messages: history,
        context: { weather: weatherText, timeBudget: timeBudget || undefined },
      });
      setTurns([...next, { role: "assistant", content: res.reply, picks: res.picks, quick: res.quickReplies }]);
    } catch (err) {
      setError((err as Error).message);
      setTurns(turns); // 보낸 말 되돌리기
      setText(content);
    } finally {
      setBusy(false);
    }
  };

  const last = turns.at(-1);

  return (
    <section className="chat" aria-labelledby="chat-title">
      <div className="step-row">
        <div className="step-head">
          <span className="step step--navy">사서 데스크</span>
          <h2 id="chat-title" className="h2">
            AI 사서와 대화하기
          </h2>
        </div>
        {turns.length > 0 && (
          <button type="button" className="bbtn bbtn--sm" onClick={() => setTurns([])}>
            새 대화
          </button>
        )}
      </div>

      <div className="chat__log" ref={log} aria-live="polite">
        {turns.length === 0 && (
          <div className="bubble-row bubble-row--ai">
            <p className="chat__bubble">
              안녕하세요, {branch.label} 담당 사서예요. 오늘 기분이나 남은 시간, 예산, 못 드시는 음식을 말씀해 주시면 서가에서 골라 드릴게요.
            </p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble-row bubble-row--${t.role === "user" ? "me" : "ai"}`}>
            <p className="chat__bubble">{t.content}</p>
            {t.picks && t.picks.length > 0 && (
              <ol className="chat__picks">
                {t.picks.map((pk) => {
                  const p = byId.get(pk.id);
                  if (!p) return null;
                  return (
                    <li key={pk.id}>
                      <button type="button" className="chat__pick" onClick={() => onShowOnMap(p.id)}>
                        <span className="chat__pick-title">《{bookTitleOf(p)}》</span>
                        <b>{p.name}</b> <span className="muted">· {travelText(p)}</span>
                      </button>
                      <p>{pk.reason}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ))}
        {busy && (
          <div className="bubble-row bubble-row--ai">
            <p className="chat__bubble chat__bubble--typing">서가를 뒤적이는 중…</p>
          </div>
        )}
      </div>

      {error && <p className="chat__error">{error}</p>}

      <div className="chat__quick">
        {(turns.length === 0 ? STARTERS : (last?.role === "assistant" ? last.quick : []) ?? []).map((q) => (
          <button type="button" key={q} className="chip" disabled={busy} onClick={() => void send(q)}>
            {q}
          </button>
        ))}
      </div>

      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          id="chat-input"
          className="input"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder="예) 매운 거 빼고, 30분 안에 먹고 올 곳"
          aria-label="사서에게 보낼 말"
        />
        <button type="submit" className="bbtn bbtn--green" disabled={busy || !text.trim()}>
          보내기
        </button>
      </form>
      <p className="muted chat__foot">블로그 리뷰를 바탕으로 한 AI 추천이라 틀릴 수 있어요.</p>
    </section>
  );
}
