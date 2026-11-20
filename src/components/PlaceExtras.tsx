import { useRef, useState } from "react";
import type { MenuReport } from "../../shared/api";
import { adRatioOf, closureOf, CLOSURE_LABEL } from "../../shared/insights";
import { estimateLunchTime } from "../../shared/time";
import type { Place } from "../../shared/types";
import { savedNickname, uploadMenuPhoto } from "../lib/api";
import type { Ctx } from "../lib/filters";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const WAIT_LABEL = { none: "웨이팅 거의 없음", short: "웨이팅 10분 안팎", long: "웨이팅 길어요" } as const;

/** 폐업 · 이전 경고 (카드 맨 위) */
export function ClosureNotice({ place, ctx }: { place: Place; ctx: Ctx }) {
  const c = closureOf(place, ctx.today);
  if (!c) return null;
  return (
    <p className={`closure closure--${c.state}`} role="alert">
      ⚠ <b>{CLOSURE_LABEL[c.state]}</b>
      {c.note && ` — ${c.note}`}
    </p>
  );
}

/** 소요 시간 · 웨이팅 · 가격 변동 · 광고성 리뷰 */
export function PlaceSignals({ place }: { place: Place }) {
  const t = estimateLunchTime(place);
  const w = place.ai?.waiting;
  const ad = adRatioOf(place);
  return (
    <ul className="signals">
      <li title={`왕복 ${t.walk}분 + 식사 ${t.meal}분 + 웨이팅 ${t.wait}분`}>
        ⏱ 다녀오는 데 약 <b>{t.total}분</b>
      </li>
      {w && w.level !== "unknown" && (
        <li className={`sig-wait sig-wait--${w.level}`}>
          ⏳ {WAIT_LABEL[w.level]}
          {w.bestTime && <> · {w.bestTime} 도착 추천</>}
        </li>
      )}
      {place.priceChange && (
        <li className={`sig-price${place.priceChange.to > place.priceChange.from ? " sig-price--up" : " sig-price--down"}`}>
          💸 {place.priceChange.item} {won(place.priceChange.from)} → <b>{won(place.priceChange.to)}</b>
          {place.priceChange.date && <span className="muted"> ({place.priceChange.date.slice(5).replace("-", "/")})</span>}
        </li>
      )}
      {ad !== null && ad >= 0.4 && (
        <li className="sig-ad" title="최신 블로그 글 중 체험단 · 협찬으로 보이는 글의 비율">
          📢 광고성 리뷰 {Math.round(ad * 100)}%
        </li>
      )}
    </ul>
  );
}

/** 웹 검색으로 보강한 정보 (블로그 글이 거의 없는 새 가게) */
export function WebInfoBox({ place }: { place: Place }) {
  const w = place.web;
  if (!w || (!w.summary && !w.hours && !w.openedOn)) return null;
  return (
    <div className="webinfo">
      <p className="webinfo__head">🌐 웹에서 찾은 정보</p>
      {w.summary && <p>{w.summary}</p>}
      <p className="muted">
        {[w.openedOn && `개업 ${w.openedOn}`, w.hours && `영업 ${w.hours}`].filter(Boolean).join(" · ")}
      </p>
      {w.sources.length > 0 && (
        <p className="webinfo__src">
          출처:{" "}
          {w.sources.map((s, i) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
              {i + 1}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

/** 직원이 올린 메뉴판 + 올리기 버튼 */
export function MenuReports({
  place,
  reports,
  branch,
  canUpload,
  onUploaded,
}: {
  place: Place;
  reports: MenuReport[] | undefined;
  branch: string;
  canUpload: boolean;
  onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; msg: string | null; error: boolean }>({ busy: false, msg: null, error: false });
  const latest = reports?.[0];

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setState({ busy: true, msg: "AI 사서가 메뉴판을 읽는 중…", error: false });
    try {
      const res = await uploadMenuPhoto({ branch, placeId: place.id, placeName: place.name, nickname: savedNickname(), file });
      setState({ busy: false, msg: `메뉴 ${res.items.length}개를 읽었어요. 고마워요!`, error: false });
      onUploaded();
    } catch (err) {
      setState({ busy: false, msg: (err as Error).message, error: true });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  if (!latest && !canUpload) return null;
  return (
    <div className="menus">
      {latest && (
        <details className="menus__list">
          <summary>
            📷 직원이 올린 메뉴판 <span className="muted">({latest.createdAt.slice(5, 10).replace("-", "/")}{latest.nickname ? ` · ${latest.nickname}` : ""})</span>
          </summary>
          <ul>
            {latest.items.map((i) => (
              <li key={i.name}>
                <span>{i.name}</span>
                <b>{i.price ? won(i.price) : "-"}</b>
              </li>
            ))}
          </ul>
          {latest.note && <p className="muted">💡 {latest.note}</p>}
        </details>
      )}
      {canUpload && (
        <>
          <button type="button" className="btn btn--ghost" disabled={state.busy} onClick={() => input.current?.click()}>
            📷 {latest ? "새 메뉴판 올리기" : "메뉴판 사진 올리기"}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {state.msg && <p className={`menus__msg${state.error ? " menus__msg--err" : ""}`}>{state.msg}</p>}
        </>
      )}
    </div>
  );
}
