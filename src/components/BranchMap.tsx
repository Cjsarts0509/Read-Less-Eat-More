import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { CATEGORY_BY_KEY } from "../../shared/categories";
import { driveMinutes } from "../../shared/geo";
import type { Branch, Place } from "../../shared/types";

interface Props {
  /** branches: 전국 지점 핀만 (지점 고르기) / area: 고른 지점 주변 식당까지 */
  mode: "branches" | "area";
  branches: Branch[];
  selected: Branch | null;
  places: Place[];
  /** 점선 원 반경 (m, 0 이면 없음) */
  radius: number;
  /** 차량 모드면 팝업에 차로 걸리는 시간 */
  drive?: boolean;
  /** n 은 같은 가게를 다시 눌러도 이동하도록 바꾸는 값 */
  focus: { id: string; n: number } | null;
  onSelectBranch: (code: string | null) => void;
  onShowCard: (id: string) => void;
}

const TILE_URL = import.meta.env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR =
  import.meta.env.VITE_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** 캔버스로 그리는 도형은 CSS 변수를 못 읽어서 실제 색으로 바꿔 넘긴다 */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function BranchMap({ mode, branches, selected, places, radius, drive = false, focus, onSelectBranch, onShowCard }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const branchLayer = useRef<L.LayerGroup | null>(null);
  const placeLayer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const handlers = useRef({ onSelectBranch, onShowCard });
  handlers.current = { onSelectBranch, onShowCard };

  // 지도 만들기 (한 번)
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { preferCanvas: true, zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(m);
    branchLayer.current = L.layerGroup().addTo(m);
    placeLayer.current = L.layerGroup().addTo(m);
    const syncZoomClass = () => el.current?.classList.toggle("map--far", m.getZoom() < 11);
    m.on("zoomend", syncZoomClass);
    m.setView([36.4, 127.6], 7);
    syncZoomClass();
    map.current = m;

    // 카드 쪽에서 팝업 안 '카드 보기' 버튼을 누르면
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-show-card]");
      if (btn?.dataset.showCard) handlers.current.onShowCard(btn.dataset.showCard);
    };
    el.current.addEventListener("click", onClick);
    const node = el.current;
    return () => {
      node.removeEventListener("click", onClick);
      m.remove();
      map.current = null;
    };
  }, []);

  // 지점 핀
  useEffect(() => {
    const m = map.current;
    const layer = branchLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    for (const b of branches) {
      const isSel = selected?.code === b.code;
      const icon = L.divIcon({
        className: "",
        html: `<div class="pin${isSel ? " pin--on" : ""}"><span class="pin__dot"></span><span class="pin__label">${escapeHtml(b.label)}</span></div>`,
        iconSize: [0, 0],
      });
      L.marker([b.lat, b.lng], { icon, title: b.label, zIndexOffset: isSel ? 1000 : 0, keyboard: true })
        .on("click", () => handlers.current.onSelectBranch(b.code))
        .addTo(layer);
    }
  }, [branches, selected]);

  // 지점을 고르면 그쪽으로 이동, 안 고르면 전체 보기
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (mode === "area" && selected) {
      const zoom = radius && radius <= 300 ? 17 : radius > 2500 ? 14 : radius > 1200 ? 15 : 16;
      m.flyTo([selected.lat, selected.lng], zoom, { duration: 0.8 });
    } else if (branches.length) {
      m.fitBounds(L.latLngBounds(branches.map((b) => [b.lat, b.lng] as [number, number])), { padding: [24, 24] });
    }
  }, [mode, selected, branches, radius]);

  // 식당 점과 도보 반경
  useEffect(() => {
    const layer = placeLayer.current;
    if (!layer) return;
    layer.clearLayers();
    markers.current.clear();
    if (!selected || mode !== "area") return;
    if (radius > 0) {
      L.circle([selected.lat, selected.lng], {
        radius,
        color: cssVar("--green", "#005B41"),
        weight: 1.5,
        dashArray: "4 6",
        fillOpacity: 0.04,
        interactive: false,
      }).addTo(layer);
    }
    for (const p of places) {
      const cat = CATEGORY_BY_KEY[p.category];
      const mk = L.circleMarker([p.lat, p.lng], {
        radius: 6.5,
        color: "#141414",
        weight: 2,
        fillColor: cat.color,
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<div class="pop"><div class="pop__cat">${cat.emoji} ${escapeHtml(p.categoryPath)}</div>` +
            `<strong class="pop__name">${escapeHtml(p.name)}</strong>` +
            `<div class="pop__meta">${drive ? `차로 약 ${driveMinutes(p.distance)}분` : `도보 ${p.walkMin}분`} · ${p.distance}m</div>` +
            `<button type="button" class="pop__btn" data-show-card="${escapeHtml(p.id)}">카드 보기</button></div>`,
          { closeButton: false, offset: [0, -2] },
        )
        .addTo(layer);
      markers.current.set(p.id, mk);
    }
  }, [mode, places, selected, radius, drive]);

  // 카드에서 '지도에서 보기'
  useEffect(() => {
    if (!focus || !map.current) return;
    const mk = markers.current.get(focus.id);
    if (!mk) return;
    map.current.flyTo(mk.getLatLng(), Math.max(map.current.getZoom(), 17), { duration: 0.6 });
    mk.openPopup();
  }, [focus]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="application" aria-label="지점과 식당 지도" />
      {selected && mode === "area" && (
        <button type="button" className="map-reset" onClick={() => map.current?.flyTo([selected.lat, selected.lng], 16)}>
          {selected.label}로 돌아가기
        </button>
      )}
    </div>
  );
}
