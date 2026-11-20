/**
 * 책장 효과음 — 외부 오디오 파일 없이 Web Audio 로 합성한다.
 * 브라우저 정책상 사용자가 클릭한 뒤에만 소리가 난다.
 */
import { readStore, writeStore } from "./storage";

type Ctx = AudioContext;

class SoundEngine {
  enabled = readStore<boolean>("rlem:sfx", true);
  private ctx: Ctx | null = null;

  setEnabled(on: boolean) {
    this.enabled = on;
    writeStore("rlem:sfx", on);
  }

  private audio(): Ctx | null {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0) {
    const ctx = this.audio();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, now + dur * 0.9);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  /** 책등을 뽑을 때 */
  spinePop() {
    this.tone("triangle", 220, 520, 0.09, 0.22);
  }
  /** 책갈피(분류) 클릭 */
  tagClick() {
    this.tone("sine", 640, 320, 0.055, 0.15);
  }
  /** 페이지 넘김 */
  pageFlip(step = 0) {
    this.tone("triangle", 360 + (step % 5) * 45, 140, 0.05, 0.16);
  }
  /** 당첨 화음 (도-미-솔-도) */
  revealChime() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone("triangle", f, f, 0.35, 0.18, i * 0.065));
  }
  /** 반품 불가 도장 */
  stampSlam() {
    this.tone("sawtooth", 150, 38, 0.24, 0.35);
  }
  /** 버튼이 도망갈 때 */
  dodgeBoing() {
    this.tone("sine", 300, 780, 0.13, 0.18);
  }
}

export const sfx = new SoundEngine();

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
