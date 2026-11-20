import { activeBadges, adRatioOf, BADGE_META, closureOf, CLOSURE_LABEL, isLunchFriendly, LUNCH_LABEL } from "../shared/insights";
import { estimateLunchTime } from "../shared/time";
import type { Place } from "../shared/types";

/** Claude 에게 넘기는 후보 한 줄 */
export function describeCandidate(p: Place, today: string): string {
  const t = estimateLunchTime(p);
  const parts = [`id=${p.id}`, p.name, p.categoryPath, `도보 ${p.walkMin}분`, `왕복+식사 약 ${t.total}분`];
  if (p.ai?.summary) parts.push(p.ai.summary);
  if (p.ai?.signatureMenus.length) parts.push(`메뉴: ${p.ai.signatureMenus.join(", ")}`);
  if (p.ai?.priceHint) parts.push(`가격: ${p.ai.priceHint}`);
  if (p.ai?.tags.length) parts.push(`태그: ${p.ai.tags.join(", ")}`);
  if (p.ai?.waiting && p.ai.waiting.level !== "unknown") parts.push(`웨이팅: ${p.ai.waiting.level}${p.ai.waiting.bestTime ? ` (${p.ai.waiting.bestTime})` : ""}`);
  const news = activeBadges(p.ai?.badges, today);
  if (news.length) parts.push(`새 소식: ${news.map((b) => `${BADGE_META[b.type].label}(${b.label})`).join(", ")}`);
  const closure = closureOf(p, today);
  if (closure) parts.push(`주의: ${CLOSURE_LABEL[closure.state]}`);
  if (p.priceChange) parts.push(`가격 변동: ${p.priceChange.item} ${p.priceChange.from}→${p.priceChange.to}원`);
  const ad = adRatioOf(p);
  if (ad !== null && ad >= 0.5) parts.push(`광고성 리뷰 많음`);
  if (p.naver) parts.push(`블로그 리뷰 ${p.naver.blogTotal}`);
  if (p.google?.rating != null) parts.push(`Google ★${p.google.rating}`);
  parts.push(`점심: ${LUNCH_LABEL[p.lunch]}`);
  return parts.join(" | ");
}

/** 기본 후보: 점심 영업 · 폐업 아님 · 도보 maxWalk 분 이내, 가까운 순 */
export function defaultCandidates(places: Place[], today: string, maxWalk = 15, limit = 120): Place[] {
  return places
    .filter((p) => p.walkMin <= maxWalk && isLunchFriendly(p.lunch) && closureOf(p, today)?.state !== "closed")
    .slice(0, limit);
}
