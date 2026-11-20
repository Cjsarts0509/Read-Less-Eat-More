/**
 * 위치 권한 안내.
 * - 묻기: 처음 온 사람에게 "위치로 가까운 지점을 찾을까요?" 를 먼저 보여 주고, 버튼을 눌렀을 때 브라우저 권한 창을 띄운다
 *   (누르지 않았는데 묻는 요청은 휴대폰 브라우저가 조용히 막는 경우가 많다)
 * - 막힘: 카카오톡 · 네이버 앱 안 브라우저, 사이트 권한 거부, 휴대폰 위치 꺼짐마다 푸는 방법을 보여 준다
 */

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

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet--loc no-swipe" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" aria-hidden />
        <header className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}

/** 처음 온 사람에게: 위치로 찾을지 먼저 묻는다 */
export function LocationAsk({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  return (
    <Sheet title="📍 가까운 지점 찾기" onClose={onSkip}>
      <p className="loc__lead">
        지금 계신 곳에서 <b>가장 가까운 교보문고 지점</b>을 찾아 바로 열어 드릴게요.
      </p>
      <p className="muted loc__note">다음 화면에서 브라우저가 위치 사용을 물으면 「허용」을 눌러 주세요. 위치는 지점을 고르는 데만 쓰고 저장하지 않아요.</p>
      <div className="loc__actions">
        <button type="button" className="bbtn bbtn--green loc__main" onClick={onAllow}>
          📍 위치 허용하고 찾기
        </button>
        <button type="button" className="bbtn" onClick={onSkip}>
          📚 책장에서 직접 고를게요
        </button>
      </div>
    </Sheet>
  );
}

/** 위치를 못 받았을 때: 쓰는 환경에 맞는 해결 방법 */
export function LocationHelp({ problem, onRetry, onClose }: { problem: LocationProblem; onRetry: () => void; onClose: () => void }) {
  const env = browserEnv();
  const steps: string[] = [];
  let title = "위치를 받지 못했어요";

  if (env.inApp === "kakao") {
    title = "카카오톡 안에서는 위치를 쓸 수 없어요";
  } else if (env.inApp === "naver") {
    title = "네이버 앱 안에서는 위치가 막혀 있어요";
    steps.push("오른쪽 아래(또는 위) 「⋯」 메뉴 → 「다른 브라우저로 열기」");
  } else if (env.inApp === "other") {
    title = "앱 안 브라우저에서는 위치가 막혀 있어요";
    steps.push("메뉴(⋯) → 「브라우저로 열기」로 크롬 · 사파리에서 열어 주세요");
  } else if (problem === "denied") {
    title = "이 사이트의 위치 권한이 꺼져 있어요";
    if (env.ios) {
      steps.push("주소창 왼쪽 「가가」(또는 「ⓘ」) → 「웹 사이트 설정」 → 「위치」를 「허용」으로");
      steps.push("그래도 안 되면: 설정 앱 → 개인정보 보호 및 보안 → 위치 서비스 켜기 → 「Safari 웹 사이트」를 「앱을 사용하는 동안」으로");
    } else if (env.samsung) {
      steps.push("주소창의 자물쇠(🔒) 아이콘 → 「권한」 → 「위치」 허용");
      steps.push("또는 메뉴(≡) → 설정 → 사이트 및 다운로드 → 사이트 권한 → 위치에서 이 사이트 허용");
    } else {
      steps.push("주소창 왼쪽 아이콘(🔒 또는 설정 모양) → 「권한」 → 「위치」를 「허용」으로");
      steps.push("그래도 안 되면: 크롬 ⋮ → 설정 → 사이트 설정 → 위치 → 이 사이트를 차단 목록에서 빼기");
    }
  } else if (problem === "unsupported") {
    title = "이 브라우저는 위치를 알려 주지 않아요";
    steps.push("크롬 · 사파리 · 삼성 인터넷 최신 버전에서 열어 주세요");
  } else {
    title = problem === "timeout" ? "위치를 찾는 데 시간이 너무 걸려요" : "휴대폰 위치(GPS)가 꺼져 있는 것 같아요";
    steps.push("화면 위에서 아래로 내려 빠른 설정의 「위치」를 켜 주세요");
    steps.push("실내라면 와이파이를 켜 두면 더 빨리 찾아요");
  }

  return (
    <Sheet title={`📍 ${title}`} onClose={onClose}>
      {env.inApp === "kakao" ? (
        <>
          <p className="loc__lead">카카오톡 안의 브라우저는 위치 권한 창을 띄우지 못해요. 크롬 · 사파리로 열면 바로 찾을 수 있어요.</p>
          <div className="loc__actions">
            <button type="button" className="bbtn bbtn--green loc__main" onClick={() => openInExternalBrowser()}>
              🌐 크롬 · 사파리로 열기
            </button>
            <button type="button" className="bbtn" onClick={onClose}>
              📚 책장에서 직접 고를게요
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="loc__steps">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="loc__actions">
            <button type="button" className="bbtn bbtn--green loc__main" onClick={onRetry}>
              🔄 다시 찾기
            </button>
            <button type="button" className="bbtn" onClick={onClose}>
              📚 책장에서 직접 고를게요
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
