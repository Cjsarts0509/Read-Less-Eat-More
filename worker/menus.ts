/**
 * 메뉴판 사진 제보 — 직원이 올린 사진에서 Claude 가 메뉴 · 가격을 뽑아 저장한다.
 * 사진은 비공개 버킷(lunch-menus)에 남기고, 화면에는 뽑아낸 글자만 보여 준다.
 */
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { MenuReport } from "../shared/api";
import { BRANCH_RE, claude, HttpError, json, limit, type Env } from "./env";
import { sbInsert, sbSelect, sbUpload } from "./supabase";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const MenuSchema = z.object({
  isMenu: z.boolean(),
  items: z.array(z.object({ name: z.string(), price: z.number().int().nullable() })),
  note: z.string().nullable(),
});


function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function handleMenuPhoto(request: Request, env: Env): Promise<Response> {
  await limit(env, request, "menu");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 64_000) throw new HttpError(413, "사진이 너무 커요 (4MB 까지).");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "사진을 읽지 못했어요.");
  }
  const branch = String(form.get("branch") ?? "");
  const placeId = String(form.get("placeId") ?? "");
  const placeName = String(form.get("placeName") ?? "").slice(0, 60);
  const nickname = String(form.get("nickname") ?? "").trim().slice(0, 20) || null;
  const image = form.get("image");
  if (!BRANCH_RE.test(branch) || !/^[\w-]{1,64}$/.test(placeId)) throw new HttpError(400, "식당 정보가 올바르지 않아요.");
  if (!image || typeof image === "string") throw new HttpError(400, "사진을 골라 주세요.");
  const file = image as File;
  const ext = TYPES[file.type];
  if (!ext) throw new HttpError(415, "JPG · PNG · WEBP 사진만 올릴 수 있어요.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "사진이 너무 커요 (4MB 까지).");
  const bytes = await file.arrayBuffer();

  const { client, model, fallback } = claude(env);
  const res = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: fallback ? ["server-side-fallback-2026-07-01"] : undefined,
    fallbacks: fallback ? "default" : undefined,
    output_config: { effort: "low", format: betaZodOutputFormat(MenuSchema) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/webp", data: toBase64(bytes) } },
          {
            type: "text",
            text:
              `「${placeName}」의 메뉴판 사진입니다. 메뉴판(가격표)이 맞으면 isMenu=true 로 하고, 보이는 메뉴 이름과 1인분 가격(원, 정수)을 최대 30개까지 적어 주세요. ` +
              "가격이 안 보이면 null. 사진에 사람 얼굴 등 메뉴판이 아닌 것이 주로 찍혀 있으면 isMenu=false 와 빈 목록. " +
              "note 에는 점심 특선 · 시간 한정 · 브레이크타임처럼 점심에 쓸모 있는 안내를 40자 이내로 (없으면 null).",
          },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new HttpError(422, "사진을 읽지 못했어요. 다른 사진으로 해 주세요.");
  const out = res.parsed_output;
  if (!out.isMenu || out.items.length === 0) throw new HttpError(422, "메뉴판 사진이 아닌 것 같아요. 가격표가 잘 보이게 찍어 주세요.");

  const items = out.items
    .map((i) => ({ name: i.name.trim().slice(0, 30), price: i.price !== null && i.price >= 500 && i.price <= 500000 ? i.price : null }))
    .filter((i) => i.name)
    .slice(0, 30);
  const path = `${branch}/${placeId}/${Date.now()}.${ext}`;
  await sbUpload(env, "lunch-menus", path, bytes, file.type);
  await sbInsert(
    env,
    "lunch_menu_reports",
    { branch_code: branch, place_id: placeId, place_name: placeName, nickname, image_path: path, items, note: out.note?.slice(0, 60) ?? null, model },
    { returning: false },
  );
  return json({ items, note: out.note });
}

export async function handleMenus(request: Request, env: Env): Promise<Response> {
  const branch = new URL(request.url).searchParams.get("branch") ?? "";
  if (!BRANCH_RE.test(branch)) throw new HttpError(400, "지점을 골라 주세요.");
  const rows = await sbSelect<{ place_id: string; nickname: string | null; items: MenuReport["items"]; note: string | null; created_at: string }>(
    env,
    "lunch_menu_reports",
    `branch_code=eq.${branch}&status=eq.visible&select=place_id,nickname,items,note,created_at&order=created_at.desc&limit=300`,
  );
  const byPlace: Record<string, MenuReport[]> = {};
  for (const r of rows) {
    const list = (byPlace[r.place_id] ??= []);
    if (list.length < 2) list.push({ placeId: r.place_id, nickname: r.nickname, items: r.items, note: r.note, createdAt: r.created_at });
  }
  return json(byPlace, 200, { "cache-control": "public, max-age=60" });
}
