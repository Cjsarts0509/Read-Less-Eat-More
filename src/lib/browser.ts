/** 어떤 브라우저 · 앱 안에서 열었는지 (위치 안내에 쓴다) */

export type LocationProblem = "denied" | "unavailable" | "timeout" | "unsupported";

interface Env {
  inApp: "kakao" | "naver" | "other" | null;
  ios: boolean;
  samsung: boolean;
}

export function browserEnv(ua = navigator.userAgent): Env {
  const inApp = /KAKAOTALK/i.test(ua)
    ? "kakao"
    : /NAVER\(inapp|NAVER\/|whale.*inapp/i.test(ua)
      ? "naver"
      : /Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i.test(ua)
        ? "other"
        : null;
  return { inApp, ios: /iPhone|iPad|iPod/i.test(ua), samsung: /SamsungBrowser/i.test(ua) };
}

/** 카카오톡 안에서 연 페이지를 기본 브라우저(크롬 · 사파리)로 다시 연다 */
export function openInExternalBrowser(url = window.location.href): void {
  window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
}
