import { CATEGORY_BY_KEY } from "../../shared/categories";
import { BADGE_META, closureOf, CLOSURE_LABEL, isNewlyListed, LUNCH_LABEL, reviewCounts } from "../../shared/insights";
import { driveMinutes } from "../../shared/geo";
import { estimateLunchTime } from "../../shared/time";
import type { Place } from "../../shared/types";
import { PRICE_SOURCE_LABEL } from "../../shared/price";
import { badgesOf, priceOf, type Ctx } from "../lib/filters";
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
      {place.lunchReason && !place.lunchReason.startsWith(LUNCH_LABEL[place.lunch]) && <span className="lunch__why"> · {place.lunchReason}</span>}
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

/** 1인 가격 어림 + 예산(식대 한도) 안인지 */
export function PriceChip({ place, ctx, showUnknown = false }: { place: Place; ctx: Ctx; showUnknown?: boolean }) {
  const p = priceOf(place, ctx);
  if (!p) return showUnknown ? <span className="pchip pchip--unknown">💳 가격 미확인</span> : null;
  const over = ctx.budget ? p.price - ctx.budget : 0;
  return (
    <span className={`pchip${over > 0 ? " pchip--over" : ctx.budget ? " pchip--ok" : ""}`} title={PRICE_SOURCE_LABEL[p.source]}>
      💳 약 {fmt.format(p.price)}원{over > 0 ? ` · 한도 +${fmt.format(over)}` : ctx.budget ? " · 한도 안" : ""}
    </span>
  );
}

/** 사내 평점 */
export function InhouseChip({ place, ctx }: { place: Place; ctx: Ctx }) {
  const r = ctx.reviews?.[place.id];
  if (!r?.count) return null;
  return (
    <span className="ichip" title="우리 직원들이 남긴 별점">
      🏢 사내 ★{r.avg.toFixed(1)} <span className="muted">({r.count})</span>
    </span>
  );
}

/** 이동 표시: 도보 N분 · 거리, 차량 모드면 차로 N분 */
export function TravelLine({ place, ctx }: { place: Place; ctx: Ctx }) {
  const km = place.distance >= 1000 ? `${(place.distance / 1000).toFixed(1)}km` : `${fmt.format(place.distance)}m`;
  if (ctx.mode === "drive") {
    return (
      <span className="muted" title="도로 우회 · 점심시간 도심 속도 · 주차를 넣은 어림">
        🚗 차로 약 {driveMinutes(place.distance)}분 · {km}
      </span>
    );
  }
  return (
    <span className="muted">
      🚶 도보 {place.walkMin}분 · {km}
    </span>
  );
}

/** 리뷰 수: 네이버 블로그 + 카페 + 다음(티스토리 등) */
export function BlogCount({ place, detail = false }: { place: Place; detail?: boolean }) {
  const n = place.naver;
  if (!n) return null;
  if (n.ambiguous) return <span className="muted">리뷰 집계 어려움 (흔한 이름)</span>;
  const c = reviewCounts(place)!;
  const breakdown = c.parts.map((x) => `${x.label} ${fmt.format(x.count)}`).join(" · ");
  return (
    <span title={`「${n.query}」 검색 중 이 가게 이야기로 보이는 글 — ${breakdown}`}>
      리뷰 <b>{fmt.format(c.total)}</b>
      {n.recentPosts > 0 && <span className="muted"> · 최근 30일 블로그 {n.recentPosts}</span>}
      {detail && c.parts.length > 1 && <span className="muted"> ({breakdown})</span>}
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
  const t = estimateLunchTime(place, ctx.mode);
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
        <span className="card__trip" title={`왕복 ${t.mode === "drive" ? "차" : "걷기"} ${t.walk}분 + 식사 ${t.meal}분 + 웨이팅 ${t.wait}분`}>
          ⏱ 다녀오기 {t.total}분
        </span>
      </header>

      <h3 className="card__name">{place.name}</h3>
      <Badges place={place} ctx={ctx} withClosure />
      <p className="card__chips">
        <PriceChip place={place} ctx={ctx} />
        <InhouseChip place={place} ctx={ctx} />
      </p>

      <p className="card__meta">
        <BlogCount place={place} />
        <TravelLine place={place} ctx={ctx} />
      </p>

      <span className="card__more" aria-hidden>
        리뷰 글 · 영업시간 · 메뉴 자세히 ›
      </span>
    </article>
  );
}
