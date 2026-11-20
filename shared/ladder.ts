/** 사다리 타기: 가로 막대 만들기 · 경로 따라가기 */

/** 가로 막대 만들기: 같은 줄에 이웃한 막대가 붙지 않게 */
export function makeRungs(n: number, rows: number, rand: () => number = Math.random): boolean[][] {
  const out: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n - 1; c++) row.push(!row[c - 1] && rand() < 0.5);
    out.push(row);
  }
  // 세로줄마다 적어도 한 번은 옆으로 건너가게
  for (let c = 0; c < n - 1; c++) {
    if (!out.some((row) => row[c])) {
      const r = Math.floor(rand() * rows);
      out[r]![c] = true;
      if (out[r]![c - 1]) out[r]![c - 1] = false;
      if (out[r]![c + 1]) out[r]![c + 1] = false;
    }
  }
  return out;
}

/** 위에서 i 번째로 출발하면 아래 몇 번째에 닿는지 + 그림 경로 */
export function traceLadder(rungs: boolean[][], start: number): { end: number; points: Array<[number, number]> } {
  const rows = rungs.length;
  let x = start;
  const points: Array<[number, number]> = [[x, 0]];
  rungs.forEach((row, r) => {
    const y = (r + 1) / (rows + 1);
    if (row[x]) {
      points.push([x, y], [x + 1, y]);
      x += 1;
    } else if (x > 0 && row[x - 1]) {
      points.push([x, y], [x - 1, y]);
      x -= 1;
    }
  });
  points.push([x, 1]);
  return { end: x, points };
}
