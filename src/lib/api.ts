/** Worker API 호출 모음 */
import type { BalanceResponse, MenuReport, NaverIdsResponse, PlaceLiveResponse, PlacePhotosResponse, ReviewSummary, WeatherResponse } from "../../shared/api";
import { readStore, writeStore } from "./storage";

export type { MenuReport, PlaceLiveResponse, ReviewSummary, WeatherResponse };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

const post = <T>(url: string, body: unknown) =>
  call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function fetchWeather(branch: string): Promise<WeatherResponse> {
  return call<WeatherResponse>(`/api/weather?branch=${encodeURIComponent(branch)}`).catch(() => ({ available: false }));
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface ChatReply {
  reply: string;
  picks: Array<{ id: string; reason: string }>;
  quickReplies: string[];
}
export function sendChat(body: { branch: string; ids: string[]; messages: ChatMessage[]; context: { weather?: string; timeBudget?: number } }) {
  return post<ChatReply>("/api/chat", body);
}

/** 상세 화면 실시간 확인: 영업시간 · 메뉴 (AI 웹 검색, 여러 사람이 함께 쓰는 캐시) */
export function fetchPlaceLive(branch: string, placeId: string): Promise<PlaceLiveResponse> {
  return call<PlaceLiveResponse>(`/api/place-live?b=${encodeURIComponent(branch)}&id=${encodeURIComponent(placeId)}`);
}

/* ---------- 투표방 ---------- */

export interface RoomPrefs {
  want: string;
  avoid: string;
  budget: "any" | "10000" | "15000";
  maxWalk: 5 | 10 | 15;
}
export interface RoomView {
  code: string;
  branch: string;
  title: string;
  deadline: string | null;
  candidates: Array<{ id: string; reason: string; notes: Array<{ nickname: string; note: string }> }>;
  mediation: { comment: string; at: string } | null;
  decided: string | null;
  members: Array<{ nickname: string; prefs: RoomPrefs; vote: string | null; isMe: boolean }>;
}

/** 이 브라우저를 알아보는 무작위 키 (로그인 대신) */
export function memberKey(): string {
  let k = readStore<string | null>("lmp:memberKey", null);
  if (!k || !/^[A-Za-z0-9_-]{8,64}$/.test(k)) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    k = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
    writeStore("lmp:memberKey", k);
  }
  return k;
}

export const savedNickname = () => readStore<string>("lmp:nickname", "");
export const saveNickname = (n: string) => writeStore("lmp:nickname", n);

export const createRoom = (branch: string, title: string) => post<{ code: string }>("/api/rooms", { branch, title });
export const getRoom = (code: string) => call<RoomView>(`/api/rooms/${code}?me=${memberKey()}`);
export const joinRoom = (code: string, nickname: string, prefs: RoomPrefs) =>
  post<RoomView>(`/api/rooms/${code}/join`, { memberKey: memberKey(), nickname, prefs });
export const voteRoom = (code: string, placeId: string | null) => post<RoomView>(`/api/rooms/${code}/vote`, { memberKey: memberKey(), placeId });
export const mediateRoom = (code: string) => post<RoomView>(`/api/rooms/${code}/mediate`, { memberKey: memberKey() });
export const decideRoom = (code: string) => post<RoomView>(`/api/rooms/${code}/decide`, { memberKey: memberKey() });

/* ---------- 밸런스 게임 ---------- */

export const fetchBalance = () => call<BalanceResponse>(`/api/balance?me=${memberKey()}`);
export const voteBalance = (choice: "a" | "b") => post<BalanceResponse>("/api/balance", { memberKey: memberKey(), choice });

/* ---------- 사내 한줄평 ---------- */

export function fetchReviews(branch: string): Promise<Record<string, ReviewSummary>> {
  return call<Record<string, ReviewSummary>>(`/api/reviews?b=${encodeURIComponent(branch)}&me=${memberKey()}`).catch(() => ({}));
}

export function postReview(body: { branch: string; placeId: string; nickname: string; rating: number; comment: string }) {
  return post<ReviewSummary | null>("/api/reviews", { ...body, memberKey: memberKey() });
}

/* ---------- 메뉴판 사진 ---------- */

export function fetchMenus(branch: string): Promise<Record<string, MenuReport[]>> {
  return call<Record<string, MenuReport[]>>(`/api/menus?branch=${encodeURIComponent(branch)}`).catch(() => ({}));
}

/** 긴 변 1600px JPEG 로 줄여서 올린다 (휴대폰 사진은 수 MB) */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("변환 실패"))), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

export async function uploadMenuPhoto(args: { branch: string; placeId: string; placeName: string; nickname: string; file: File }) {
  const blob = await shrink(args.file);
  const form = new FormData();
  form.set("branch", args.branch);
  form.set("placeId", args.placeId);
  form.set("placeName", args.placeName);
  form.set("nickname", args.nickname);
  form.set("image", new File([blob], "menu.jpg", { type: blob.type || "image/jpeg" }));
  return call<{ items: MenuReport["items"]; note: string | null }>("/api/menu-photo", { method: "POST", body: form });
}

/* ---------- 네이버 지도 가게 번호 ---------- */

export const fetchNaverIds = (branch: string) => call<NaverIdsResponse>(`/api/naver-ids?b=${encodeURIComponent(branch)}`);

/* ---------- 음식 · 메뉴판 사진 ---------- */

export const fetchPlacePhotos = (branch: string, id: string) =>
  call<PlacePhotosResponse>(`/api/place-photos?b=${encodeURIComponent(branch)}&id=${encodeURIComponent(id)}`);
