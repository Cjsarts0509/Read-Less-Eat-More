// localStorage 는 사생활 보호 모드 등에서 막힐 수 있어 항상 try/catch 로 감싼다.

export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 못 해도 화면은 그대로 동작 */
  }
}

export interface PickRecord {
  id: string;
  name: string;
  date: string;
}

const HISTORY_KEY = (branch: string) => `rlem:history:${branch}`;

export function readHistory(branch: string): PickRecord[] {
  return readStore<PickRecord[]>(HISTORY_KEY(branch), []);
}

export function addHistory(branch: string, rec: PickRecord): PickRecord[] {
  const next = [rec, ...readHistory(branch).filter((r) => !(r.id === rec.id && r.date === rec.date))].slice(0, 30);
  writeStore(HISTORY_KEY(branch), next);
  return next;
}

export function clearHistory(branch: string): void {
  writeStore(HISTORY_KEY(branch), []);
}
