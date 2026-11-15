// Original score and sound design, synthesised in code (no samples, no licensed audio). 48 kHz stereo WAV.
// Reads src/timeline.json: drop at the SPak reveal, groove under the product, a lighter bed for Intelligence,
// and a final impact on the logo. The music ducks under every voiceover line.
import { readFileSync, writeFileSync } from "node:fs";
const T = JSON.parse(readFileSync("src/timeline.json"));
const V = JSON.parse(readFileSync("src/voice.json"));
const SR = 48000, N = Math.ceil(T.duration * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const BPM = 112, beat = 60 / BPM;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
const scene = (t) => T.scenes.find((s) => t >= s.from && t < s.to)?.id ?? "outro";
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// A minor progression: Am F C G (bars of 4 beats)
const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const bar = 4 * beat;

// Pad: detuned saws through a soft low-pass, present everywhere, brighter in the outro.
{
  let lp = [0, 0];
  for (let i = 0; i < N; i++) {
    const t = i / SR, ch = CH[Math.floor(t / bar) % 4], sc = scene(t);
    let v = 0;
    for (const m of ch) for (const d of [-0.07, 0.07]) { const ph = (t * hz(m - 12) * (1 + d / 100)) % 1; v += (2 * ph - 1) * 0.045; }
    const cut = sc === "problem" ? 0.02 : sc === "outro" ? 0.09 : 0.05;
    lp[0] += cut * (v - lp[0]); lp[1] += cut * (lp[0] - lp[1]);
    const amp = sc === "problem" ? 0.5 : sc === "intel" ? 0.8 : 0.7;
    add(i, lp[1] * amp, lp[1] * amp * 0.94);
  }
}
// Kick, sub bass, hats, arp: from the reveal on; sparse ticking in the problem scene.
for (let b = 0; b * beat < T.duration; b++) {
  const t0 = b * beat, sc = scene(t0), groove = ["how", "demo"].includes(sc) || (sc === "outro" && t0 < 91), light = sc === "intel" || sc === "intro";
  if (sc === "problem") { // tense ticks
    const s0 = Math.floor(t0 * SR);
    for (let k = 0; k < 900; k++) add(s0 + k, rnd() * 0.05 * Math.exp(-k / 120) * (b % 2 ? 0.6 : 1));
    continue;
  }
  if (groove || (light && b % 2 === 0)) { // kick
    const s0 = Math.floor(t0 * SR);
    for (let k = 0; k < SR * 0.28; k++) { const tt = k / SR; const f = 48 + 90 * Math.exp(-tt * 28); add(s0 + k, Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 9) * 0.55); }
  }
  if (groove) { // offbeat hat
    const s0 = Math.floor((t0 + beat / 2) * SR);
    let hp = 0, prev = 0;
    for (let k = 0; k < 2600; k++) { const n = rnd(); hp = 0.85 * (hp + n - prev); prev = n; add(s0 + k, hp * 0.07 * Math.exp(-k / 500), hp * 0.06 * Math.exp(-k / 500)); }
  }
  if (groove || light) { // bass: root of the chord, eighths
    const root = CH[Math.floor(t0 / bar) % 4][0] - 24;
    for (const off of [0, beat / 2]) {
      const s0 = Math.floor((t0 + off) * SR);
      for (let k = 0; k < SR * beat * 0.45; k++) { const tt = k / SR; add(s0 + k, Math.sin(2 * Math.PI * hz(root) * tt) * 0.16 * Math.min(1, tt * 200) * Math.exp(-tt * 3)); }
    }
  }
  if (groove || sc === "intel") { // arp: chord tones in sixteenths, plucked
    const ch = CH[Math.floor(t0 / bar) % 4];
    for (let q = 0; q < 4; q++) {
      const m = ch[(b * 4 + q) % 3] + 12 + (q === 3 ? 12 : 0), s0 = Math.floor((t0 + q * beat / 4) * SR);
      const pan = q % 2 ? 0.75 : 1;
      for (let k = 0; k < SR * 0.18; k++) { const tt = k / SR, ph = (tt * hz(m)) % 1; const v = (ph < 0.5 ? 1 : -1) * 0.035 * Math.exp(-tt * 18); add(s0 + k, v * pan, v * (1.75 - pan)); }
    }
  }
}
// Sound design: impacts, whooshes, UI clicks.
for (const h of T.hits) {
  const s0 = Math.floor(h * SR), big = h === 12.0 || h >= 85;
  for (let k = 0; k < SR * 1.6; k++) { const tt = k / SR; const f = 38 + 60 * Math.exp(-tt * 6); add(s0 + k, Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * (big ? 2.2 : 4)) * (big ? 0.7 : 0.4) + rnd() * 0.08 * Math.exp(-tt * 14)); }
}
for (const w of T.whooshes) {
  const s0 = Math.floor((w - 0.45) * SR); let lp = 0;
  for (let k = 0; k < SR * 0.7; k++) { const x = k / (SR * 0.7); const cut = 0.02 + 0.3 * x * x; lp += cut * (rnd() - lp); const env = Math.sin(Math.PI * Math.min(1, x * 1.15)) ** 2; add(s0 + k, lp * env * 0.22 * (1 - x * 0.3), lp * env * 0.22 * (0.7 + x * 0.3)); }
}
for (const c of T.clicks) {
  const s0 = Math.floor(c * SR);
  for (let k = 0; k < 900; k++) add(s0 + k, (Math.sin(2 * Math.PI * 2400 * k / SR) * 0.1 + rnd() * 0.05) * Math.exp(-k / 90));
}
// Duck the music under narration (smooth 150 ms ramps), then fade in, fade out, soft clip.
const duck = new Float32Array(N).fill(1);
for (const [id, start] of Object.entries(T.vo)) {
  const a = Math.floor(start * SR), b = Math.floor((start + V[id].seconds) * SR), r = Math.floor(0.15 * SR);
  for (let i = a - r; i < b + r; i++) if (i >= 0 && i < N) duck[i] = Math.min(duck[i], i < a ? 1 - 0.55 * (i - (a - r)) / r : i > b ? 0.45 + 0.55 * (i - b) / r : 0.45);
}
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / 1.2, (T.duration - t) / 2.5);
  L[i] = Math.tanh(L[i] * duck[i] * fade * 1.4) * 0.8; R[i] = Math.tanh(R[i] * duck[i] * fade * 1.4) * 0.8;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * 32767), 46 + i * 4); }
writeFileSync("public/audio/score.wav", buf);
console.log("score.wav", T.duration, "s, peak", peak.toFixed(3));
