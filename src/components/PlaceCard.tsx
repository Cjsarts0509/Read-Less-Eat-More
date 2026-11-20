import { CATEGORY_BY_KEY } from "../../shared/categories";
import { BADGE_META, closureOf, CLOSURE_LABEL, isNewlyListed, LUNCH_LABEL } from "../../shared/insights";
import { estimateLunchTime } from "../../shared/time";
import type { Place } from "../../shared/types";
import { badgesOf, type Ctx } from "../lib/filters";
import { directionsUrl, kakaoPlaceUrl, naverMapUrl } from "../lib/links";

const fmt = new Intl.NumberFormat("ko-KR");

/** 새 소식 배지 (신규 오픈 · 이벤트 · 할인 · 시즌/신메뉴 · 점심 특선) + 폐업 의심 */
export function Badges({ place, ctx, withClosure = false }: { place: Place; ctx: Ctx; withClosure?: boolean }) {
  const badges = badgesOf(place, ctx);
  const listed = isNewlyListed(place, ctx.baselineDate, ctx.today);
  const closure = withClosure ? closureOf(place, ctx.today) : null;
  if (!badges.length && !listed && !closure) return null;
  return (
    <ul className="badges" aria-label="새 소식">
      {closure && (
        <li className="badge badge--red" title={closure.note}>
          <b>⚠</b> {CLOSURE_LABEL[closure.state]}
        </li>
      )}
      {listed && !badges.some((b) => b.type === "new_open") && (
        <li className="badge badge--green" title={`지도에 ${place.firstSeen} 처음 등록됐어요`}>
          <b>NEW</b> 지도 신규 등록
        </li>
      )}
      {badges.map((b) => (
        <li
          key={b.type}
          className={`badge badge--${BADGE_META[b.type].tone}`}
          title={`${b.detail}${b.evidenceDate ? ` (${b.evidenceDate} ${b.auto ? "블로그 글" : "리뷰"})` : ""}`}
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
          카카오맵 <span className="btn__sub">메뉴·사진</span>
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

/** 블로그 리뷰 수 */
export function BlogCount({ place }: { place: Place }) {
  const n = place.naver;
  if (!n) return null;
  if (n.ambiguous) return <span className="muted">블로그 리뷰 집계 어려움 (흔한 이름)</span>;
  return (
    <span title={`네이버 블로그 「${n.query}」 중 이 가게 이야기로 보이는 글`}>
      블로그 리뷰 <b>{fmt.format(n.blogTotal)}</b>
      {n.recentPosts > 0 && <span className="muted"> · 최근 30일 {n.recentPosts}</span>}
    </span>
  );
}

interface Props {
  place: Place;
  ctx: Ctx;
  highlighted?: boolean;
  onOpen: (id: string) => void;
}

/**
 * 목록 카드: 분류 · 상호 · 새 소식 · 블로그 리뷰 수 · 다녀오는 시간 · 최근 블로그 리뷰만.
 * 나머지(영업시간 · 메뉴 · 지도 링크 · 실시간 확인)는 눌렀을 때 상세 팝업에서.
 */
export function PlaceCard({ place, ctx, highlighted, onOpen }: Props) {
  const cat = CATEGORY_BY_KEY[place.category];
  const t = estimateLunchTime(place);
  const posts = place.naver?.posts.slice(0, 2) ?? [];
  const open = () => onOpen(place.id);
  return (
    <article
      id={`place-${place.id}`}
      className={`card${highlighted ? " card--hl" : ""}${place.lunch === "closed" ? " card--closed" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${place.name} 자세히 보기`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
    >
      <header className="card__top">
        <span className="card__cat" style={{ "--cat": cat.color } as React.CSSProperties}>
          {cat.emoji} {place.categoryPath.split(" > ").slice(-1)[0] || cat.label}
        </span>
        <span className="card__trip" title={`왕복 걷기 ${t.walk}분 + 식사 ${t.meal}분 + 웨이팅 ${t.wait}분`}>
          ⏱ 다녀오기 {t.total}분
        </span>
      </header>

      <h3 className="card__name">{place.name}</h3>
      <Badges place={place} ctx={ctx} withClosure />

      <p className="card__meta">
        <BlogCount place={place} />
        <span className="muted">
          🚶 도보 {place.walkMin}분 · {fmt.format(place.distance)}m
        </span>
      </p>

      {posts.length > 0 && (
        <ul className="card__reviews" aria-label="최근 블로그 리뷰">
          {posts.map((p) => (
            <li key={p.link}>
              <a href={p.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                {p.title}
              </a>
              {p.date && <span className="muted">{p.date.slice(2).replaceAll("-", ".")}</span>}
            </li>
          ))}
        </ul>
      )}

      <span className="card__more" aria-hidden>
        영업시간 · 메뉴 · 지도 자세히 ›
      </span>
    </article>
  );
}
