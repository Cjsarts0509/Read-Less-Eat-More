import { useState } from "react";
import type { Branch, Place } from "../../shared/types";

interface Props {
  branch: Branch;
  candidates: Place[];
  onShowOnMap: (id: string) => void;
}

interface AskResult {
  comment: string;
  picks: Array<{ id: string; reason: string }>;
}

const EXAMPLES = ["비 오는 날 뜨끈한 국물", "1만원 이하로 빨리 먹을 곳", "4명이 조용히 이야기하기 좋은 곳", "어제 과음했어요"];

export function AskAI({ branch, candidates, onShowOnMap }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  const ask = async (query: string) => {
    const text = query.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: branch.code, query: text, ids: candidates.slice(0, 150).map((p) => p.id) }),
      });
      const data = (await res.json()) as AskResult & { error?: string };
      if (!res.ok) throw new Error(data.error || "잠시 후 다시 시도해 주세요.");
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const byId = new Map(candidates.map((p) => [p.id, p]));

  return (
    <section className="ask" aria-labelledby="ask-title">
      <h2 id="ask-title" className="section-title section-title--sm">
        AI 점심 소믈리에
      </h2>
      <form
        className="ask__form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input
          className="input"
          value={q}
          maxLength={200}
          onChange={(e) => setQ(e.target.value)}
          placeholder="오늘 기분이나 조건을 적어 주세요 (예: 비 오는 날 뜨끈한 국물)"
          aria-label="AI 에게 물어보기"
        />
        <button type="submit" className="btn btn--accent" disabled={loading || !q.trim()}>
          {loading ? "고르는 중…" : "추천받기"}
        </button>
      </form>
      {!result && !loading && (
        <div className="ask__examples">
          {EXAMPLES.map((ex) => (
            <button
              type="button"
              key={ex}
              className="chip"
              onClick={() => {
                setQ(ex);
                void ask(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}
      {error && <p className="ask__error">{error}</p>}
      {result && (
        <div className="ask__result">
          {result.comment && <p className="ask__comment">{result.comment}</p>}
          <ol className="ask__picks">
            {result.picks.map((pk) => {
              const p = byId.get(pk.id);
              if (!p) return null;
              return (
                <li key={pk.id}>
                  <button type="button" className="linkish" onClick={() => onShowOnMap(p.id)}>
                    {p.name}
                  </button>{" "}
                  <span className="muted">도보 {p.walkMin}분</span>
                  <p>{pk.reason}</p>
                </li>
              );
            })}
          </ol>
          <p className="muted ask__foot">블로그 리뷰를 바탕으로 한 AI 추천이라 틀릴 수 있어요.</p>
        </div>
      )}
    </section>
  );
}
