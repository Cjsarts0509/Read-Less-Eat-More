import { CATEGORY_BY_KEY } from "../../shared/categories";
import { BADGE_META, isNewlyListed, LUNCH_LABEL } from "../../shared/insights";
import type { Place } from "../../shared/types";
import type { MenuReport } from "../../shared/api";
import { bookTitleOf } from "../lib/booktitle";
import { badgesOf, type Ctx } from "../lib/filters";
import { directionsUrl, kakaoPlaceUrl, naverMapUrl } from "../lib/links";
import { ClosureNotice, MenuReports, PlaceSignals, WebInfoBox } from "./PlaceExtras";

interface Props {
  place: Place;
  ctx: Ctx;
  highlighted?: boolean;
  onShowOnMap?: (id: string) => void;
  menus?: MenuReport[];
  /** 메뉴판 사진 올리기 (저장소 · AI 가 켜져 있을 때) */
  upload?: { branch: string; onDone: () => void } | null;
}

const fmt = new Intl.NumberFormat("ko-KR");

export function Badges({ place, ctx }: { place: Place; ctx: Ctx }) {
  const badges = badgesOf(place, ctx);
  const listed = isNewlyListed(place, ctx.baselineDate, ctx.today);
  if (!badges.length && !listed) return null;
  return (
    <ul className="badges" aria-label="새 소식">
      {listed && !badges.some((b) => b.type === "new_open") && (
        <li className="badge badge--green" title={`지도에 ${place.firstSeen} 처음 등록됐어요`}>
          <b>NEW</b> 지도 신규 등록
        </li>
      )}
      {badges.map((b) => (
        <li
          key={b.type}
          className={`badge badge--${BADGE_META[b.type].tone}`}
          title={`${b.detail}${b.evidenceDate ? ` (${b.evidenceDate} 리뷰)` : ""}`}
        >
          <b>{BADGE_META[b.type].label}</b> {b.label}
        </li>
      ))}
    </ul>
  );
}

export function LunchLine({ place }: { place: Place }) {
  return (
    <p className={`lunch lunch--${place.lunch}`}>
      <span className="lunch__dot" aria-hidden />
      <span className="lunch__label">{LUNCH_LABEL[place.lunch]}</span>
      {place.lunchReason && <span className="lunch__why"> · {place.lunchReason}</span>}
    </p>
  );
}

export function PlaceLinks({ place, onShowOnMap }: { place: Place; onShowOnMap?: (id: string) => void }) {
  const demo = place.id.startsWith("demo-");
  return (
    <div className="links">
      <a className="btn btn--naver" href={naverMapUrl(place)} target="_blank" rel="noreferrer">
        네이버 지도 <span className="btn__sub">평점·리뷰</span>
      </a>
      {!demo && (
        <a className="btn btn--kakao" href={kakaoPlaceUrl(place)} target="_blank" rel="noreferrer">
          카카오맵
        </a>
      )}
      <a className="btn" href={directionsUrl(place)} target="_blank" rel="noreferrer">
        길찾기
      </a>
      {onShowOnMap && (
        <button type="button" className="btn btn--ghost" onClick={() => onShowOnMap(place.id)}>
          지도에서 보기
        </button>
      )}
    </div>
  );
}

export function PlaceCard({ place, ctx, highlighted, onShowOnMap, menus, upload }: Props) {
  const cat = CATEGORY_BY_KEY[place.category];
  const ai = place.ai;
  const g = place.google;
  return (
    <article id={`place-${place.id}`} className={`card${highlighted ? " card--hl" : ""}`}>
      <header className="card__top">
        <span className="card__cat" style={{ "--cat": cat.color } as React.CSSProperties}>
          {cat.emoji} {place.categoryPath || cat.label}
        </span>
        <span className="card__walk">
          🚶 {place.walkMin}분 · {fmt.format(place.distance)}m
        </span>
      </header>

      <ClosureNotice place={place} ctx={ctx} />
      <p className="card__book">《{bookTitleOf(place)}》</p>
      <h3 className="card__name">{place.name}</h3>
      <Badges place={place} ctx={ctx} />

      {ai?.summary && <p className="card__summary">“{ai.summary}”</p>}
      {ai?.signatureMenus.length ? (
        <p className="card__menus">
          <span className="muted">대표 메뉴</span> {ai.signatureMenus.join(" · ")}
        </p>
      ) : null}

      <dl className="stats">
        {g?.rating != null && (
          <div className="stat" title="Google 지도 평점">
            <dt>Google</dt>
            <dd>
              ★ {g.rating.toFixed(1)}
              {g.ratingCount != null && <span className="muted"> ({fmt.format(g.ratingCount)})</span>}
            </dd>
          </div>
        )}
        {place.naver && (
          <div className="stat" title={`네이버 블로그 검색 「${place.naver.query}」 결과 수`}>
            <dt>블로그 리뷰</dt>
            <dd>
              {fmt.format(place.naver.blogTotal)}
              {place.naver.recentPosts > 0 && <span className="muted"> · 최근 30일 {place.naver.recentPosts}</span>}
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

      <PlaceSignals place={place} />
      <LunchLine place={place} />
      {ai?.lunchNote && place.lunchReason !== ai.lunchNote && <p className="card__note">💡 {ai.lunchNote}</p>}
      <WebInfoBox place={place} />
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
        <details className="posts">
          <summary>최근 블로그 리뷰</summary>
          <ul>
            {place.naver.posts.map((p) => (
              <li key={p.link}>
                <a href={p.link} target="_blank" rel="noreferrer">
                  {p.title}
                </a>
                {p.date && <span className="muted"> · {p.date.slice(5).replace("-", "/")}</span>}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <PlaceLinks place={place} onShowOnMap={onShowOnMap} />
    </article>
  );
}
