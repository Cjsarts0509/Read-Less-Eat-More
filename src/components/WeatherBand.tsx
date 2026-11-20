import type { WeatherResponse } from "../../shared/api";

interface Props {
  weather: WeatherResponse | null;
  branchLabel: string;
  on: boolean;
  onToggle: (on: boolean) => void;
}

const MOOD_ICON: Record<string, string> = { rain: "☔", snow: "❄️", cold: "🧣", hot: "☀️", mild: "🌤" };

/** 날씨 띠지: 기상청 예보 + AI 사서 한 줄. 켜 두면 뽑기에서 날씨에 맞는 메뉴가 더 잘 나온다 */
export function WeatherBand({ weather, branchLabel, on, onToggle }: Props) {
  if (!weather?.available) return null;
  const temp =
    weather.tmin != null && weather.tmax != null ? `${Math.round(weather.tmin)}~${Math.round(weather.tmax)}℃` : weather.tmax != null ? `최고 ${Math.round(weather.tmax)}℃` : "";
  const sky = [weather.precip || weather.sky, weather.pop ? `강수 ${weather.pop}%` : ""].filter(Boolean).join(" · ");
  return (
    <div className={`wband wband--${weather.mood ?? "mild"}`} role="note" aria-label="오늘 날씨">
      <div className="wband__facts">
        <span>
          <b>{branchLabel}</b> 오늘 {temp} {sky && `· ${sky}`}
        </span>
      </div>
      <p className="wband__line">{/^\p{Extended_Pictographic}/u.test(weather.line ?? "") ? weather.line : `${MOOD_ICON[weather.mood ?? "mild"]} ${weather.line}`}</p>
      {weather.boost && weather.boost.keywords.length > 0 && (
        <label className="switch switch--sm">
          <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
          <span className="switch__track" aria-hidden />
          {weather.boost.label} 메뉴 우대해서 뽑기
        </label>
      )}
    </div>
  );
}

/** 날씨 우대 가중치: 메뉴 단어가 맞으면 3배, 날씨 도보 한도를 넘으면 0.4배 */
export function weatherWeight(
  p: { name: string; categoryPath: string; walkMin: number; ai: { signatureMenus: string[] } | null },
  weather: WeatherResponse | null,
): number {
  const boost = weather?.available ? weather.boost : undefined;
  if (!boost) return 1;
  let w = 1;
  const hay = `${p.name} ${p.categoryPath} ${(p.ai?.signatureMenus ?? []).join(" ")}`;
  if (boost.keywords.some((k) => hay.includes(k))) w *= 3;
  if (boost.maxWalk && p.walkMin > boost.maxWalk) w *= 0.4;
  return w;
}
