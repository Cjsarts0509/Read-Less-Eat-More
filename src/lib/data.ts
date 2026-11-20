import type { Branch, BranchPlaces, DataIndex } from "../../shared/types";
import { makeDemoPlaces } from "./demo";

const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(url: string): Promise<T | null> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url, { headers: { Accept: "application/json" } }).then(async (res) => {
        if (!res.ok) return null;
        // SPA 폴백으로 index.html 이 오는 경우를 걸러낸다
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("json")) return null;
        return res.json();
      }),
    );
  }
  return (await cache.get(url)) as T | null;
}

export function loadBranches(): Promise<Branch[] | null> {
  return getJson<Branch[]>("/data/branches.json");
}

export function loadIndex(): Promise<DataIndex | null> {
  return getJson<DataIndex>("/data/index.json");
}

export async function loadPlaces(branch: Branch, demo: boolean): Promise<BranchPlaces | null> {
  if (demo) return makeDemoPlaces(branch);
  return getJson<BranchPlaces>(`/data/places/${branch.code}.json`);
}

export interface AppConfig {
  ai: boolean;
}

export async function loadConfig(): Promise<AppConfig> {
  return (await getJson<AppConfig>("/api/config")) ?? { ai: false };
}

/** 한국 시간 오늘 YYYY-MM-DD */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
