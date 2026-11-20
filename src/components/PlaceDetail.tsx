import { useEffect, useRef, useState } from "react";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import { formatHours } from "../../shared/hours";
import { daysBetween, HOURS_STALE_DAYS } from "../../shared/insights";
import type { MenuReport, PlaceLiveResponse } from "../../shared/api";
import type { Place } from "../../shared/types";
import { fetchPlaceLive } from "../lib/api";
import { bookTitleOf } from "../lib/booktitle";
import type { Ctx } from "../lib/filters";
import { kakaoPlaceUrl, naverMapUrl } from "../lib/links";
import { Badges, BlogCount, LunchLine, PlaceLinks } from "./PlaceCard";
import { ClosureNotice, HoursLine, MenuReports, PlaceSignals, WebInfoBox } from "./PlaceExtras";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** 영업시간을 모르거나(블로그 글이 1년 넘음) 웹 조사도 안 된 가게면 열 때 바로 확인한다 */
export function shouldAutoCheck(place: Place, today: string): boolean {
  const h = place.hours;
  if (h && h.source !== "blog") return false;
  if (h && h.date && daysBetween(h.date, today) <= HOURS_STALE_DAYS) return false;
  return !(place.web?.hours && daysBetween(place.web.checkedAt, today) <= 30);
}

/** 실시간 확인: AI 가 웹에서 영업시간 · 메뉴를 찾는다 (Worker 가 14일 캐시 + 하루 한도) */
function LiveCheck({ place, branch, ctx, onFound }: { place: Place; branch: string; ctx: Ctx; onFound: (r: PlaceLiveResponse) => void }) {
  const auto = shouldAutoCheck(place, ctx.today);
  const [state, setState] = useState<{ phase: "idle" | "loading" | "done" | "error"; data?: PlaceLiveResponse; error?: string }>({
    phase: "idle",
  });
  const tries = useRef(0);

  const run = async () => {
    setState({ phase: "loading" });
    try {
      const r = await fetchPlaceLive(branch, place.id);
      if (r.status === "pending" && tries.current < 4) {
        tries.current++;
        window.setTimeout(() => void run(), 8000);
        return;
      }
      setState({ phase: "done", data: r });
      if (r.info) onFound(r);
    } catch (err) {
      setState({ phase: "error", error: (err as Error).message });
    }
  };

  useEffect(() => {
    if (auto) void run();
  }, [place.id]);

  const d = state.data;
  const info = d?.info;
  return (
    <section className="live" aria-live="polite">
      <div className="live__head">
        <b>🔎 실시간 확인</b>
        <span className="muted">AI 가 웹에서 영업시간 · 메뉴를 찾아요</span>
      </div>

      {state.phase === "idle" && (
        <button type="button" className="bbtn bbtn--sm" onClick={() => void run()}>
          영업시간 · 메뉴 확인하기
        </button>
      )}
      {state.phase === "loading" && (
        <p className="live__loading">
          <span className="spinner" aria-hidden /> 찾는 중이에요… (10~30초)
        </p>
      )}
      {state.phase === "error" && (
        <p className="muted">
          확인하지 못했어요: {state.error}{" "}
          <button type="button" className="linkish" onClick={() => void run()}>
            다시 시도
          </button>
        </p>
      )}
      {state.phase === "done" && d && (
        <>
          {d.status === "off" && <p className="muted">실시간 확인 기능이 꺼져 있어요.</p>}
          {d.status === "limit" && !info && <p className="muted">오늘 확인 한도를 다 썼어요. 내일 다시 확인할 수 있어요.</p>}
          {d.status === "notfound" && <p className="muted">웹에서 이 가게 정보를 찾지 못했어요. 아래 지도 링크에서 확인해 주세요.</p>}
          {info && (
            <dl className="live__facts">
              {d.hours && (
                <div>
                  <dt>영업시간</dt>
                  <dd>
                    <b>{formatHours(d.hours)}</b>
                  </dd>
                </div>
              )}
              {!d.hours && info.hours && (
                <div>
                  <dt>영업시간</dt>
                  <dd>{info.hours}</dd>
                </div>
              )}
              {info.menus.length > 0 && (
                <div>
                  <dt>메뉴</dt>
                  <dd>
                    {info.menus.join(" · ")}
                    {info.menuPrice && (
                      <span className="muted">
                        {" "}
                        ({info.menuPrice.item} {won(info.menuPrice.price)})
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {info.seats && (
                <div>
                  <dt>좌석</dt>
                  <dd>{info.seats}</dd>
                </div>
              )}
              {info.dineIn === "no" && (
                <div>
                  <dt>주의</dt>
                  <dd>배달 · 포장 전문으로 보여요</dd>
                </div>
              )}
              {info.closure !== "open" && info.closure !== "unknown" && (
                <div>
                  <dt>주의</dt>
                  <dd>{info.closure === "moved" ? "이전 소식이 있어요" : "폐업 · 휴업 소식이 있어요"}</dd>
                </div>
              )}
            </dl>
          )}
          {info && (
            <p className="live__src muted">
              {d.checkedAt && `${d.checkedAt.slice(0, 10)} 확인`}
              {info.sources.map((s, i) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                  {" "}
                  출처{i + 1}
                </a>
              ))}
            </p>
          )}
        </>
      )}
      <p className="live__note muted">
        메뉴판 사진은{" "}
        <a href={kakaoPlaceUrl(place)} target="_blank" rel="noreferrer">
          카카오맵
        </a>{" "}
        ·{" "}
        <a href={naverMapUrl(place)} target="_blank" rel="noreferrer">
          네이버 지도
        </a>
        에서 볼 수 있어요. 직접 찍어 올리면 AI 가 메뉴 · 가격을 읽어 모두에게 보여 줘요.
      </p>
    </section>
  );
}

interface Props {
  place: Place;
  ctx: Ctx;
  branch: string;
  menus?: MenuReport[];
  upload: { branch: string; onDone: () => void } | null;
  live: boolean;
  onClose: () => void;
  onShowOnMap: (id: string) => void;
}

/** 가게 상세 팝업 (휴대폰에서는 아래에서 올라오는 시트) */
export function PlaceDetail({ place: base, ctx, branch, menus, upload, live, onClose, onShowOnMap }: Props) {
  const [found, setFound] = useState<PlaceLiveResponse | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // 실시간 확인 결과를 반영한 가게 (영업시간 · 네이버 가게 번호)
  const place: Place = found?.info ? { ...base, web: found.info, hours: found.hours ?? base.hours } : base;
  const cat = CATEGORY_BY_KEY[place.category];
  const ai = place.ai;
  const g = place.google;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.body.classList.add("modal-open");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  useEffect(() => setFound(null), [base.id]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet no-swipe"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-name"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__grip" aria-hidden />
        <header className="sheet__head">
          <div>
            <span className="card__cat" style={{ "--cat": cat.color } as React.CSSProperties}>
              {cat.emoji} {place.categoryPath || cat.label}
            </span>
            <p className="card__book">《{bookTitleOf(place)}》</p>
            <h2 id="detail-name" className="sheet__title">
              {place.name}
            </h2>
          </div>
          <button ref={closeRef} type="button" className="sheet__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="sheet__body">
          <ClosureNotice place={place} ctx={ctx} />
          <Badges place={place} ctx={ctx} />
          {ai?.summary && <p className="card__summary">“{ai.summary}”</p>}
          {ai?.signatureMenus.length ? (
            <p className="card__menus">
              <span className="muted">대표 메뉴</span> {ai.signatureMenus.join(" · ")}
            </p>
          ) : null}

          <dl className="stats">
            {place.naver && (
              <div className="stat">
                <dt>블로그</dt>
                <dd>
                  <BlogCount place={place} />
                </dd>
              </div>
            )}
            {g?.rating != null && (
              <div className="stat" title="Google 지도 평점">
                <dt>Google</dt>
                <dd>
                  ★ {g.rating.toFixed(1)}
                  {g.ratingCount != null && <span className="muted"> ({g.ratingCount.toLocaleString("ko-KR")})</span>}
                </dd>
              </div>
            )}
            {ai?.priceHint && (
              <div className="stat">
                <dt>점심 가격</dt>
                <dd>{ai.priceHint}</dd>
              </div>
            )}
          </dl>

          <LunchLine place={place} />
          <HoursLine place={place} ctx={ctx} />
          {ai?.lunchNote && place.lunchReason !== ai.lunchNote && <p className="card__note">💡 {ai.lunchNote}</p>}
          <PlaceSignals place={place} />

          {live && !place.id.startsWith("demo-") && <LiveCheck place={base} branch={branch} ctx={ctx} onFound={setFound} />}
          {!found && <WebInfoBox place={place} />}

          <MenuReports
            place={place}
            reports={menus}
            branch={upload?.branch ?? ""}
            canUpload={Boolean(upload) && !place.id.startsWith("demo-")}
            onUploaded={() => upload?.onDone()}
          />

          {ai?.tags.length ? (
            <ul className="tags">
              {ai.tags.map((t) => (
                <li key={t}>#{t}</li>
              ))}
            </ul>
          ) : null}

          {place.naver?.posts.length ? (
            <div className="posts">
              <p className="posts__head">최근 블로그 리뷰</p>
              <ul>
                {place.naver.posts.map((p) => (
                  <li key={p.link}>
                    <a href={p.link} target="_blank" rel="noreferrer">
                      {p.title}
                    </a>
                    {p.date && <span className="muted"> · {p.date.slice(2).replaceAll("-", ".")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className="sheet__foot">
          <PlaceLinks
            place={place}
            onShowOnMap={(id) => {
              onClose();
              onShowOnMap(id);
            }}
          />
        </footer>
      </div>
    </div>
  );
}
