import type { Branch, BranchPlaces } from "../shared/types";
import { HttpError, type Env } from "./env";

async function asset<T>(env: Env, request: Request, path: string): Promise<T | null> {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
  return (await res.json()) as T;
}

export async function getBranch(env: Env, request: Request, code: string): Promise<Branch> {
  const list = await asset<Branch[]>(env, request, "/data/branches.json");
  const b = list?.find((x) => x.code === code);
  if (!b) throw new HttpError(404, "지점을 찾을 수 없어요.");
  return b;
}

export async function getPlaces(env: Env, request: Request, code: string): Promise<BranchPlaces> {
  const data = await asset<BranchPlaces>(env, request, `/data/places/${code}.json`);
  if (!data) throw new HttpError(404, "이 지점의 식당 정보가 아직 없어요.");
  return data;
}
