/** Tiny synthesised sound effects: no audio files to load or license. */

let ctx: AudioContext | undefined;
let master: GainNode | undefined;

/** Call from a user gesture (browsers block audio until then). */
export function unlockAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
  } catch {
    ctx = undefined;
  }
}

function tone(freq: number, to: number, dur: number, type: OscillatorType, gain = 1, delay = 0): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, freq: number, gain = 1): void {
  if (!ctx || !master) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

export const sfx = {
  swing: () => noise(0.16, 900, 0.5),
  roll: () => noise(0.22, 400, 0.4),
  bonk: (head: boolean) => {
    tone(head ? 620 : 420, head ? 300 : 200, 0.14, "triangle", 0.9);
    noise(0.07, 1800, 0.35);
  },
  hurt: () => tone(330, 110, 0.3, "square", 0.45),
  thud: () => {
    tone(120, 40, 0.4, "sine", 1);
    noise(0.25, 200, 0.7);
  },
  roar: () => {
    tone(190, 90, 0.9, "sawtooth", 0.5);
    tone(140, 70, 0.9, "square", 0.3, 0.05);
  },
  munch: () => {
    for (let i = 0; i < 3; i++) tone(500 + i * 60, 380, 0.08, "triangle", 0.5, i * 0.25);
  },
  stars: () => {
    for (let i = 0; i < 4; i++) tone(900 + i * 220, 1200 + i * 220, 0.12, "sine", 0.4, i * 0.07);
  },
  win: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.28, "triangle", 0.6, i * 0.13));
  },
  lose: () => {
    [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.97, 0.35, "triangle", 0.5, i * 0.2));
  },
  start: () => {
    [392, 523, 659].forEach((f, i) => tone(f, f, 0.2, "square", 0.3, i * 0.1));
  },
};
