/**
 * Supabase REST (PostgREST · Storage) 를 fetch 로 직접 부른다. 키는 Worker 시크릿에만 있다.
 */
import { HttpError, type Env } from "./env";

function cfg(env: Env): { url: string; headers: Record<string, string> } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new HttpError(503, "저장소(Supabase)가 아직 연결되지 않았어요.");
  const key = env.SUPABASE_SECRET_KEY;
  const headers: Record<string, string> = { apikey: key };
  // 예전 service_role 키(JWT)는 Authorization 도 필요하다. 새 secret key 는 apikey 만.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return { url: env.SUPABASE_URL.replace(/\/$/, ""), headers };
}

export function hasSupabase(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

export async function sbSelect<T>(env: Env, table: string, query: string): Promise<T[]> {
  const { url, headers } = cfg(env);
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: { ...headers, Accept: "application/json" } });
  if (!res.ok) throw new HttpError(502, `저장소 읽기 실패 (${res.status})`);
  return (await res.json()) as T[];
}

export async function sbInsert<T>(
  env: Env,
  table: string,
  rows: unknown,
  opts: { upsertOn?: string; returning?: boolean } = {},
): Promise<T[]> {
  const { url, headers } = cfg(env);
  const prefer = [opts.returning === false ? "return=minimal" : "return=representation"];
  if (opts.upsertOn) prefer.push("resolution=merge-duplicates");
  const qs = opts.upsertOn ? `?on_conflict=${opts.upsertOn}` : "";
  const res = await fetch(`${url}/rest/v1/${table}${qs}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: prefer.join(",") },
    body: JSON.stringify(rows),
  });
  if (res.status === 409) throw new HttpError(409, "이미 있는 값이에요.");
  if (!res.ok) throw new HttpError(502, `저장소 쓰기 실패 (${res.status})`);
  return opts.returning === false ? [] : ((await res.json()) as T[]);
}

export async function sbUpdate(env: Env, table: string, query: string, patch: unknown): Promise<void> {
  const { url, headers } = cfg(env);
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new HttpError(502, `저장소 쓰기 실패 (${res.status})`);
}

export async function sbUpload(env: Env, bucket: string, path: string, body: ArrayBuffer, contentType: string): Promise<void> {
  const { url, headers } = cfg(env);
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType, "x-upsert": "false" },
    body,
  });
  if (!res.ok) throw new HttpError(502, `사진 저장 실패 (${res.status})`);
}
