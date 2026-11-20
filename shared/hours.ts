/**
 * 영업시간 글에서 시각을 뽑는다.
 * 블로그 · 웹 검색에 흔한 표기를 다룬다:
 *   "영업시간 : 매일 11:00 - 21:30", "평일 11시~21시", "오전 11시 반 ~ 오후 9시",
 *   "브레이크타임 15:00~17:00", "라스트오더 20:30", "점심 11:30~14:00 / 저녁 17:00~22:00",
 *   "매주 일요일 휴무", "연중무휴", "토·일 휴무"
 */
import type { HoursInfo } from "./types";

export type ParsedHours = Pick<HoursInfo, "open" | "close" | "breakStart" | "breakEnd" | "lastOrder" | "closedDays">;

const AMPM = String.raw`(오전|오후|낮|밤|저녁|새벽|AM|PM|am|pm)?\s*`;
// 시각 하나: 11:30 · 11시 · 11시 30분 · 11시반 · 11시 반
const CLOCK = String.raw`(\d{1,2})\s*(?:(:)\s*(\d{2})|(시)\s*(?:(\d{1,2})\s*분|(반))?)`;
const TIME = AMPM + CLOCK;
const DASH = String.raw`\s*(?:~|∼|〜|-|–|—|부터|에서)\s*`;
const RANGE_RE = new RegExp(TIME + DASH + TIME + String.raw`(?:\s*까지)?`, "g");
const LAST_ORDER_RE = new RegExp(String.raw`(?:라스트\s*오더|L\.?\s?O\.?|주문\s*마감)\s*[:：은는]?\s*` + TIME, "i");

interface Clock {
  minutes: number;
  /** 오전 · 오후 같은 표시가 있었는지 */
  marked: boolean;
}

function readClock(ampm: string | undefined, h: string, colon?: string, mm?: string, si?: string, siMin?: string, half?: string): Clock | null {
  let hour = Number(h);
  let minute = colon ? Number(mm) : siMin ? Number(siMin) : half ? 30 : 0;
  if (!colon && !si) return null;
  if (!Number.isFinite(hour) || hour > 30 || minute > 59) return null;
  const mark = ampm?.toLowerCase();
  if (mark === "오후" || mark === "저녁" || mark === "밤" || mark === "pm") {
    if (hour < 12) hour += 12;
  } else if (mark === "새벽") {
    if (hour <= 6) hour += 24;
  } else if ((mark === "오전" || mark === "am") && hour === 12) {
    hour = 0;
  } else if (mark === "낮" && hour <= 5) {
    hour += 12;
  }
  return { minutes: hour * 60 + minute, marked: Boolean(mark) };
}

export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fromHHMM(s: string | null | undefined): number | null {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 끝 시각이 시작보다 이르면 오후 · 다음 날로 본다 ("11시~9시" → 21:00, "17:00~02:00" → 26:00) */
function fixClose(open: Clock, close: Clock): number {
  let c = close.minutes;
  if (c <= open.minutes && !close.marked && c < 12 * 60 && c + 12 * 60 > open.minutes) c += 12 * 60;
  if (c <= open.minutes) c += 24 * 60;
  return c;
}

type Kind = "main" | "weekday" | "weekend" | "lunch" | "dinner" | "break";

function kindOf(before: string): Kind {
  const ctx = before.slice(-14);
  if (/브레이크|break|휴식|쉬는\s*시간|준비\s*시간/i.test(ctx)) return "break";
  if (/주말|토요일|일요일|토\s*[·,/~-]?\s*일|공휴일|토요|일요/.test(ctx)) return "weekend";
  if (/평일|월\s*[~-]\s*금|월\s*[~-]\s*토|월요일\s*[~-]|주중/.test(ctx)) return "weekday";
  if (/점심|런치|lunch/i.test(ctx)) return "lunch";
  if (/저녁|디너|dinner/i.test(ctx)) return "dinner";
  return "main";
}

const DAY = "[월화수목금토일]";
const DAYS_RE = new RegExp(String.raw`(?:매주\s*)?((?:${DAY}(?:요일)?\s*[,·/&및]?\s*)+)\s*(?:정기\s*)?(?:휴무|휴일|휴점|쉬어요|쉽니다|쉼)`);
const DAYS_AFTER_RE = new RegExp(String.raw`(?:정기\s*)?(?:휴무|휴일)(?:일)?\s*[:：은는]?\s*(?:매주\s*)?((?:${DAY}(?:요일)?\s*[,·/&및]?\s*)+)`);

function normalizeDays(raw: string): string | null {
  // "월요일" 의 '일' 을 일요일로 읽지 않도록 '요일' 을 먼저 지운다
  const days = [...new Set(raw.replace(/요일/g, "").match(new RegExp(DAY, "g")) ?? [])];
  if (!days.length) return null;
  const order = "월화수목금토일";
  days.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return days.length === 1 ? `${days[0]}요일` : `${days.join("·")}요일`;
}

export function parseClosedDays(text: string): string | null {
  if (/연중\s*무휴|휴무\s*(?:일\s*)?(?:없|X)|무휴/.test(text)) return "연중무휴";
  if (/주말\s*(?:은|엔|에는)?\s*(?:휴무|쉬|영업\s*안)/.test(text)) return "토·일요일";
  // "임시 휴무" · "명절 휴무" 는 정기 휴무가 아니다
  const cleaned = text.replace(/(임시|명절|설날|추석|여름|하계|동계)\s*휴무/g, "");
  const m = cleaned.match(DAYS_RE) ?? cleaned.match(DAYS_AFTER_RE);
  return m ? normalizeDays(m[1]!) : null;
}

/** 글 하나에서 영업시간을 읽는다. 시작 · 끝 시각을 찾지 못하면 null */
export function parseHoursText(text: string): ParsedHours | null {
  const ranges: Array<{ kind: Kind; open: number; close: number }> = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const open = readClock(m[1], m[2]!, m[3], m[4], m[5], m[6], m[7]);
    const close = readClock(m[8], m[9]!, m[10], m[11], m[12], m[13], m[14]);
    if (!open || !close) continue;
    // "저녁 17:00~22:00" 의 '저녁' 은 시각 표시로 먹히므로 앞 문맥에 붙여서 본다
    const kind = kindOf(text.slice(0, m.index) + (m[1] ?? ""));
    const end = fixClose(open, close);
    const span = end - open.minutes;
    if (open.minutes < 5 * 60 && kind !== "break") continue; // 새벽 영업은 점심과 무관
    if (open.minutes >= 24 * 60 || span < 30 || span > 22 * 60) continue;
    ranges.push({ kind, open: open.minutes, close: end });
  }

  const pick = (k: Kind) => ranges.find((r) => r.kind === k);
  const lunch = pick("lunch");
  const dinner = pick("dinner");
  const brk = pick("break");
  let main = pick("weekday") ?? pick("main") ?? null;
  let breakStart = brk?.open ?? null;
  let breakEnd = brk?.close ?? null;
  if (!main && lunch && dinner && dinner.open > lunch.close) {
    main = { kind: "main", open: lunch.open, close: dinner.close };
    breakStart ??= lunch.close;
    breakEnd ??= dinner.open;
  }
  main ??= lunch ?? dinner ?? pick("weekend") ?? null;
  if (!main) return null;

  // 브레이크가 영업시간 밖이면 버린다
  if (breakStart !== null && breakEnd !== null && (breakStart <= main.open || breakEnd >= main.close)) {
    breakStart = null;
    breakEnd = null;
  }

  let lastOrder: number | null = null;
  const lo = text.match(LAST_ORDER_RE);
  if (lo) {
    const c = readClock(lo[1], lo[2]!, lo[3], lo[4], lo[5], lo[6], lo[7]);
    if (c) {
      let v = c.minutes;
      if (v < main.open && v + 12 * 60 <= main.close && v + 12 * 60 > main.open) v += 12 * 60;
      else if (v < main.open && v + 24 * 60 <= main.close) v += 24 * 60;
      if (v > main.open && v <= main.close) lastOrder = v;
    }
  }

  return {
    open: toHHMM(main.open),
    close: toHHMM(main.close),
    breakStart: breakStart !== null ? toHHMM(breakStart) : null,
    breakEnd: breakEnd !== null ? toHHMM(breakEnd) : null,
    lastOrder: lastOrder !== null ? toHHMM(lastOrder) : null,
    closedDays: parseClosedDays(text),
  };
}

const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;
const WEEKDAYS = ["월", "화", "수", "목", "금"];

/**
 * 평일 12~13시에 먹을 수 있는가.
 * true: 12시 전에 열고 13시 이후까지, 브레이크가 겹치지 않음
 * false: 12시 반 이후에 열거나 12시 반 전에 닫음, 브레이크가 점심을 덮음, 평일 내내 휴무
 * null: 애매함
 */
export function hoursOpenAtLunch(h: Pick<HoursInfo, "open" | "close" | "breakStart" | "breakEnd" | "closedDays">): boolean | null {
  const open = fromHHMM(h.open);
  const close = fromHHMM(h.close);
  if (open === null || close === null) return null;
  if (h.closedDays && WEEKDAYS.every((d) => h.closedDays!.includes(d))) return false;
  if (open > LUNCH_START + 30 || close < LUNCH_START + 30) return false;
  const bs = fromHHMM(h.breakStart);
  const be = fromHHMM(h.breakEnd);
  if (bs !== null && be !== null && bs <= LUNCH_START && be >= LUNCH_END) return false;
  if (open <= LUNCH_START && close >= LUNCH_END && !(bs !== null && be !== null && bs < LUNCH_END && be > LUNCH_START)) return true;
  return null;
}

/** "11:00–21:30 · 브레이크 15:00–17:00 · L.O 21:00 · 일요일 휴무" */
export function formatHours(h: Pick<HoursInfo, "open" | "close" | "breakStart" | "breakEnd" | "lastOrder" | "closedDays">): string {
  const show = (s: string) => {
    const m = fromHHMM(s);
    return m !== null && m > 24 * 60 ? `익일 ${toHHMM(m - 24 * 60)}` : s;
  };
  const parts: string[] = [];
  if (h.open && h.close) parts.push(`${h.open}–${show(h.close)}`);
  if (h.breakStart && h.breakEnd) parts.push(`브레이크 ${h.breakStart}–${h.breakEnd}`);
  if (h.lastOrder) parts.push(`L.O ${show(h.lastOrder)}`);
  if (h.closedDays) parts.push(h.closedDays === "연중무휴" ? "연중무휴" : `${h.closedDays} 휴무`);
  return parts.join(" · ");
}

/**
 * 블로그 글 여러 개에서 가장 믿을 만한 영업시간을 고른다.
 * 최신 글을 우선하고, 같은 시각이 여러 글에 나오면 그 시각을 고른다.
 */
export function pickHours(
  posts: Array<{ title: string; snippet: string; date: string | null; link?: string }>,
): (ParsedHours & { text: string; date: string | null; link: string | null }) | null {
  const found = posts
    .map((p) => {
      const text = `${p.title} ${p.snippet}`;
      const parsed = parseHoursText(text);
      return parsed ? { ...parsed, text, date: p.date, link: p.link ?? null } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (!found.length) return null;
  const key = (x: ParsedHours) => `${x.open}-${x.close}`;
  const votes = new Map<string, number>();
  for (const f of found) votes.set(key(f), (votes.get(key(f)) ?? 0) + 1);
  found.sort((a, b) => (votes.get(key(b)) ?? 0) - (votes.get(key(a)) ?? 0) || (b.date ?? "").localeCompare(a.date ?? ""));
  const best = found[0]!;
  // 같은 시각을 말한 다른 글에서 빠진 항목(브레이크 · 휴무)을 채운다
  for (const f of found) {
    if (key(f) !== key(best)) continue;
    best.breakStart ??= f.breakStart;
    best.breakEnd ??= f.breakEnd;
    best.lastOrder ??= f.lastOrder;
    best.closedDays ??= f.closedDays;
  }
  return { ...best, text: excerpt(best.text) };
}

/** 근거 문장: 영업시간 언급 앞뒤만 짧게 */
function excerpt(text: string): string {
  const i = text.search(/영업\s*시간|운영\s*시간|오픈|영업/);
  const start = Math.max(0, i >= 0 ? i - 10 : 0);
  const s = text.slice(start, start + 90).trim();
  return (start > 0 ? "…" : "") + s + (start + 90 < text.length ? "…" : "");
}
