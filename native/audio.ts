// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the quiet desk
// ambience (looped noise lowpassed at 320 Hz) and the adaptive generative
// music (a slow pentatonic line with a low triangle every 16 steps; chains
// make it denser). The browser build ran both live (a noise loop and
// oscillators on a 300 ms timer); here they are rendered once into clips
// (createClip, a slice a frame) and looped on the music bus — the line's
// extra notes for chains are a second loop faded in by the intensity — as the
// runtime has no ambience bus. The browser build's bus levels (music × 0.5,
// ambience × 0.35 of their sliders' defaults) are the voices' gains. The
// runtime's Options own the volumes, the mute and the voice limit. The
// oscillator blips the browser build synthesized while a sample decoded are
// not ported (a live synthesis graph makes clip loads fail on the web
// runtime): a clip still loading is silent. Clips load once the mixer runs
// (natively at once, in a browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { createStream } from "../js/rules.js";

/** audio.js SFX. */
const SFX: Record<string, string> = {
  select: "tile-select", deselect: "tile-deselect", clear: "pair-clear", clearChain: "chain-clear", collapse: "row-collapse",
  addRows: "rows-added", invalid: "invalid-pair", win: "round-win", lose: "round-lose", hint: "hint-reveal", undo: "undo-move",
  uiClick: "ui-click",
};
export type Sfx = keyof typeof SFX;
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

export function play(event: Sfx): void {
  const file = SFX[event];
  if (!file || suspended) return;
  const clip = clips.get(file);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(file); if (!queue.includes(file)) queue.push(file); }
}

// -- the ambience and the music ------------------------------------------------------------------
const RATE = 22050;
const AMB_N = RATE * 2;
const amb = new Float32Array(AMB_N);
let ambPos = 0, ambS = 987654321, ambY = 0;
/** audio.js startAmbience: seeded noise × 0.3, then the 320 Hz lowpass (one pole, run twice round so the loop joins). */
function renderAmbience(count: number): boolean {
  const k = 1 - Math.exp((-2 * Math.PI * 320) / RATE);
  const end = Math.min(2 * AMB_N, ambPos + count);
  for (; ambPos < end; ambPos++) {
    const i = ambPos % AMB_N;
    if (ambPos < AMB_N) {
      ambS = (ambS * 1103515245 + 12345) & 0x7fffffff;
      amb[i] = (ambS / 0x3fffffff - 1) * 0.3;
    } else {
      ambY += k * (amb[i]! - ambY);
      amb[i] = ambY * 2.2; // the biquad's resonance lifted the band a little
    }
  }
  return ambPos >= 2 * AMB_N;
}

/** audio.js startMusic: 300 ms steps; a note every 4 steps (2 when excited), a 131 Hz triangle every 16. 64 steps loop. */
const STEPS = 64, STEP_S = 0.3;
const MUSIC_N = Math.round(RATE * STEPS * STEP_S);
const SCALE = [262, 294, 330, 392, 440, 523, 587];
interface Note { t: number; f: number; dur: number; gain: number; tri: boolean }
const calm: Note[] = [], dense: Note[] = [];
{
  const s = createStream("audio-variants");
  for (let step = 1; step <= STEPS; step++) {
    const t = (step - 1) * STEP_S;
    if (step % 2 === 0) {
      const note = SCALE[Math.floor(s.next() * SCALE.length)]!;
      const list = step % 4 === 0 ? calm : dense;
      list.push({ t, f: note, dur: 0.5, gain: 0.12, tri: false });
      if (s.next() < (step % 4 === 0 ? 0.3 : 0.5)) list.push({ t: t + 0.18, f: note * 1.5, dur: 0.4, gain: 0.07, tri: false });
    }
    if (step % 16 === 0) calm.push({ t, f: 131, dur: 1.2, gain: 0.1, tri: true });
  }
}
const musicA = new Float32Array(MUSIC_N), musicB = new Float32Array(MUSIC_N);
let noteA = 0, noteB = 0;
/** One blip (audio.js blip): 8 ms attack, exponential decay to silence over `dur`, wrapping round the loop. */
function renderNote(buf: Float32Array, n: Note): void {
  const len = Math.round((n.dur + 0.02) * RATE), start = Math.round(n.t * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = t < 0.008 ? (t / 0.008) * n.gain : n.gain * Math.pow(0.0001 / n.gain, Math.min(1, (t - 0.008) / (n.dur - 0.008)));
    const ph = (n.f * t) % 1;
    const w = n.tri ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(ph * 2 * Math.PI);
    buf[(start + i) % MUSIC_N]! += w * env;
  }
}
function renderMusic(): boolean {
  if (noteA < calm.length) { renderNote(musicA, calm[noteA++]!); return false; }
  if (noteB < dense.length) { renderNote(musicB, dense[noteB++]!); return false; }
  return true;
}

let ambClip: AudioClip | null = null, aClip: AudioClip | null = null, bClip: AudioClip | null = null;
let ambVoice: Sound | null = null, aVoice: Sound | null = null, bVoice: Sound | null = null;
const AMB_GAIN = 0.35 * 0.4 / (0.5 * 0.5), MUSIC_GAIN = 1;
let intensity = 0;
/** audio.js excite: a clear makes the line denser for a while. */
export function excite(): void { intensity = Math.min(1, intensity + 0.4); }
/** audio.js setBackgrounded: a hidden window (and the pause screen) silences the page. */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  try {
    ambVoice?.fade(on ? 0 : AMB_GAIN, 0.2);
    aVoice?.fade(on ? 0 : MUSIC_GAIN, 0.2);
    bVoice?.fade(on ? 0 : MUSIC_GAIN * intensity, 0.2);
  } catch { /* gone */ }
}

let lastIntensity = -1;
/** Each frame: the clips once the mixer runs (one at a time), then the ambience and the music. */
export function update(dt: number): void {
  // audio.js: the intensity eases off by 0.02 a step (300 ms).
  intensity = Math.max(0, intensity - (0.02 / STEP_S) * dt);
  if (bVoice && !suspended && Math.abs(intensity - lastIntensity) > 0.02) {
    lastIntensity = intensity;
    try { bVoice.fade(MUSIC_GAIN * intensity, 0.3); } catch { /* gone */ }
  }
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of Object.values(SFX)) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
    }
    return;
  }
  if (loading) return;
  if (!ambClip) {
    if (!renderAmbience(8000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : AMB_GAIN, loop: true }); } catch { ambVoice = null; }
    return;
  }
  if (!aClip || !bClip) {
    if (!renderMusic()) return;
    try { aClip = createClip([musicA], RATE); bClip = createClip([musicB], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); }
    return;
  }
  if (!aVoice) {
    try { aVoice = playClip(aClip, { bus: "music", gain: suspended ? 0 : MUSIC_GAIN, loop: true }); } catch { aVoice = null; }
    return;
  }
  if (!bVoice) {
    try { bVoice = playClip(bClip, { bus: "music", gain: suspended ? 0 : MUSIC_GAIN * intensity, loop: true }); } catch { bVoice = null; }
  }
}
