import { useEffect, useState } from "react";
import type { PlacePhoto } from "../../shared/api";
import { fetchPlacePhotos } from "../lib/api";

/** 상세 창: 음식 · 메뉴판 사진 (다음 이미지 검색 썸네일, 누르면 원래 글) */
export function PlacePhotos({ branch, placeId }: { branch: string; placeId: string }) {
  const [state, setState] = useState<{ status: "loading" | "done" | "error"; photos: PlacePhoto[] }>({ status: "loading", photos: [] });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading", photos: [] });
    fetchPlacePhotos(branch, placeId)
      .then((r) => alive && setState({ status: "done", photos: r.photos }))
      .catch(() => alive && setState({ status: "error", photos: [] }));
    return () => {
      alive = false;
    };
  }, [branch, placeId]);

  if (state.status === "error" || (state.status === "done" && state.photos.length === 0)) return null;

  return (
    <section className="photos" aria-label="음식 · 메뉴판 사진">
      <p className="photos__head">
        📷 음식 · 메뉴판 사진 <span className="muted">· 누르면 원래 글로 가요</span>
      </p>
      <div className="photos__strip no-swipe">
        {state.status === "loading"
          ? Array.from({ length: 4 }, (_, i) => <span key={i} className="photos__ph" aria-hidden />)
          : state.photos.map((p) => (
              <a key={p.link} className="photos__item" href={p.link} target="_blank" rel="noreferrer" title={`${p.site}${p.date ? ` · ${p.date}` : ""}`}>
                <img src={p.thumb} alt={`${p.site} 사진`} loading="lazy" referrerPolicy="no-referrer" />
                {p.site && <span className="photos__site">{p.site}</span>}
              </a>
            ))}
      </div>
      <p className="photos__note muted">검색으로 모은 사진이라 다른 가게 사진이 섞일 수 있어요.</p>
    </section>
  );
}
