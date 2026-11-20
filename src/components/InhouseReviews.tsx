import { useState } from "react";
import type { ReviewSummary } from "../../shared/api";
import { postReview, saveNickname, savedNickname } from "../lib/api";

const STARS = [1, 2, 3, 4, 5];

/** 사내 한줄평: 별 1~5개 + 한 줄. 같은 가게에 다시 쓰면 고쳐진다 */
export function InhouseReviews({
  branch,
  placeId,
  summary,
  canWrite,
  onSaved,
}: {
  branch: string;
  placeId: string;
  summary?: ReviewSummary;
  canWrite: boolean;
  onSaved: (s: ReviewSummary | null) => void;
}) {
  const mine = summary?.mine;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [nickname, setNickname] = useState(savedNickname());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) return setError("별점을 골라 주세요.");
    if (!nickname.trim()) return setError("닉네임을 적어 주세요.");
    setBusy(true);
    setError("");
    try {
      saveNickname(nickname.trim());
      onSaved(await postReview({ branch, placeId, nickname: nickname.trim(), rating, comment }));
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ireviews">
      <div className="ireviews__head">
        <b>🏢 사내 한줄평</b>
        {summary?.count ? (
          <span>
            ★ {summary.avg.toFixed(1)} <span className="muted">· {summary.count}명</span>
          </span>
        ) : (
          <span className="muted">아직 없어요. 첫 평가를 남겨 주세요</span>
        )}
      </div>

      {summary?.recent.length ? (
        <ul className="ireviews__list">
          {summary.recent.map((r, i) => (
            <li key={i}>
              <span className="ireviews__stars" aria-label={`별 ${r.rating}개`}>
                {"★".repeat(r.rating)}
                <span className="muted">{"★".repeat(5 - r.rating)}</span>
              </span>
              <span className="ireviews__text">{r.comment || <span className="muted">(별점만)</span>}</span>
              <span className="muted ireviews__who">
                {r.nickname} · {r.updatedAt.slice(5, 10).replace("-", "/")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {canWrite &&
        (open ? (
          <form className="ireviews__form" onSubmit={submit}>
            <div className="ireviews__pick" role="radiogroup" aria-label="별점">
              {STARS.map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={rating === n}
                  className={`ireviews__star${n <= rating ? " ireviews__star--on" : ""}`}
                  onClick={() => setRating(n)}
                  aria-label={`별 ${n}개`}
                >
                  ★
                </button>
              ))}
            </div>
            <input
              className="input"
              maxLength={80}
              placeholder="한 줄 평 (예: 순대국 진함, 12시 전엔 바로 앉음)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-label="한 줄 평"
            />
            <div className="ireviews__row">
              <input
                className="input"
                maxLength={20}
                placeholder="닉네임"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                aria-label="닉네임"
              />
              <button type="submit" className="bbtn bbtn--green" disabled={busy}>
                {busy ? "저장 중…" : mine ? "고치기" : "남기기"}
              </button>
            </div>
            {error && <p className="ireviews__err">{error}</p>}
          </form>
        ) : (
          <button type="button" className="bbtn bbtn--sm" onClick={() => setOpen(true)}>
            {mine ? `✏️ 내 평가 고치기 (★${mine.rating})` : "✍️ 다녀왔어요 · 평가 남기기"}
          </button>
        ))}
    </section>
  );
}
