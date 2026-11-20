/**
 * BookGrid 지점 주소 엑셀 → public/data/branches.json
 *
 *   npm run import:branches -- <엑셀 파일 경로>
 *
 * '지점 주소 (수불처)' 시트에서 위도·경도가 있는 줄만 가져온다.
 * 엑셀 원본에는 내부 정보(매출자료 날짜, 비고 등)가 있어 저장소에는 넣지 않고 JSON 만 커밋한다.
 */
import ExcelJS from "exceljs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Branch } from "../shared/types";

const SHEET_NAME = "지점 주소 (수불처)";
const OUT = path.resolve("public/data/branches.json");
/** 엑셀에 없는 지점 (본사 등). 좌표가 대략이면 coordSource "approx" — 수집 때 카카오로 맞춘다 */
const EXTRA = path.resolve("pipeline/extra-branches.json");

const REGION_PREFIX: Array<[string, string]> = [
  ["서울", "서울"],
  ["경기", "경기"],
  ["인천", "인천"],
  ["부산", "부산"],
  ["대구", "대구"],
  ["광주", "광주"],
  ["대전", "대전"],
  ["울산", "울산"],
  ["세종", "세종"],
  ["충청남", "충남"],
  ["충청북", "충북"],
  ["전북", "전북"],
  ["전라북", "전북"],
  ["전라남", "전남"],
  ["경상남", "경남"],
  ["경상북", "경북"],
  ["강원", "강원"],
  ["제주", "제주"],
];

function regionOf(address: string): string {
  for (const [prefix, region] of REGION_PREFIX) if (address.startsWith(prefix)) return region;
  return "기타";
}

function labelOf(name: string): string {
  return /(점|센터|스토어|서점)$/.test(name) ? name : `${name}점`;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String(v.text).trim();
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  return String(v).trim();
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("사용법: npm run import:branches -- <엑셀 파일 경로>");
    process.exit(1);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) throw new Error("시트를 찾을 수 없습니다");

  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map(cellText);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`'${name}' 열이 없습니다`);
    return i;
  };
  const C = {
    division: col("사업단"),
    code: col("수불처코드"),
    name: col("지점(수불처)"),
    address: col("주소"),
    lat: col("위도"),
    lng: col("경도"),
  };

  const branches: Branch[] = [];
  const skipped: string[] = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const v = row.values as ExcelJS.CellValue[];
    const name = cellText(v[C.name]);
    const lat = Number(cellText(v[C.lat]));
    const lng = Number(cellText(v[C.lng]));
    const address = cellText(v[C.address]);
    const code = cellText(v[C.code]);
    if (!name) return;
    if (!code || !address || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
      skipped.push(name);
      return;
    }
    branches.push({
      code: code.padStart(3, "0"),
      name,
      label: labelOf(name),
      division: cellText(v[C.division]) || "(미지정)",
      region: regionOf(address),
      address,
      lat,
      lng,
      coordSource: "bookgrid",
    });
  });

  // 엑셀에 없는 지점 붙이기 (이미 카카오로 맞춘 좌표가 branches.json 에 있으면 그대로 쓴다)
  const extra = JSON.parse(await readFile(EXTRA, "utf8").catch(() => "[]")) as Branch[];
  const current = JSON.parse(await readFile(OUT, "utf8").catch(() => "[]")) as Branch[];
  for (const e of extra) {
    if (branches.some((b) => b.code === e.code)) continue;
    const known = current.find((b) => b.code === e.code && b.coordSource === "kakao");
    branches.push(known ? { ...e, lat: known.lat, lng: known.lng, coordSource: "kakao" } : e);
  }

  // '(미지정)' 사업단은 맨 뒤로
  const unassigned = (d: string) => (d.startsWith("(") ? 1 : 0);
  branches.sort(
    (a, b) =>
      unassigned(a.division) - unassigned(b.division) ||
      a.division.localeCompare(b.division, "ko") ||
      a.name.localeCompare(b.name, "ko"),
  );
  await writeFile(OUT, JSON.stringify(branches, null, 2) + "\n", "utf8");
  console.log(`✅ ${branches.length}개 지점 → ${path.relative(process.cwd(), OUT)}`);
  if (skipped.length) console.log(`⏭  주소·좌표가 없어 건너뜀 (${skipped.length}): ${skipped.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
