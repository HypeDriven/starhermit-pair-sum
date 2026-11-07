// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the quiet desk
// ambience (looped noise lowpassed at 320 Hz) and the adaptive generative
// music (a slow pentatonic line with a low triangle every 16 steps; chains
// make it denser). The browser build ran both live (a noise loop and
// oscillators on a 300 ms timer); here they are rendered once at start
// (OfflineAudioContext, one a stem) and looped on the music bus — the line's
// extra notes for chains are a second loop faded in by the intensity — as the
// runtime has no ambience bus. The browser build's bus levels (music × 0.5,
// ambience × 0.35 of their sliders' defaults) are the voices' gains. The
// runtime's Options own the volumes, the mute and the voice limit. The
// oscillator blips the browser build synthesized while a sample decoded are
// not ported (a live synthesis graph makes clip loads fail on the web
// runtime): a clip still loading is silent. Every clip loads at start.
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { createStream } from "../js/rules.js";

/** audio.js SFX. */
const SFX: Record<string, string> = {
  select: "tile-select", deselect: "tile-deselect", clear: "pair-clear", clearChain: "chain-clear", collapse: "row-collapse",
  addRows: "rows-added", invalid: "invalid-pair", win: "round-win", lose: "round-lose", hint: "hint-reveal", undo: "undo-move",
  uiClick: "ui-click",
};
export type Sfx = keyof typeof SFX;
const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once (onStart); a sound whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SFX))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); });
  }
  const failed = (e: unknown): void => { console.warn(`audio: ${String(e)}`); };
  renderAmbience().then((c) => { ambClip = c; }, failed);
  renderLine(calm).then((c) => { aClip = c; }, failed);
  renderLine(dense).then((c) => { bClip = c; }, failed);
}

export function play(event: Sfx): void {
  const file = SFX[event];
  if (!file || suspended) return;
  const clip = clips.get(file);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { /* the mixer is full this frame: skip it */ }
}

// -- the ambience and the music ------------------------------------------------------------------
const RATE = 22050;
const AMB_LEVEL = 0.606; // old stem rms 0.0794 (one-pole × 2.2 over the LCG noise), measured
/** audio.js startAmbience: noise lowpassed at 320 Hz; filtered periodic noise is periodic once settled, so the loop joins. */
async function renderAmbience(): Promise<AudioClip> {
  const n = RATE * 2, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ seed: 7, seconds: 2 });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
  const g = off.createGain(); g.gain.value = AMB_LEVEL;
  noise.connect(lp).connect(g).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
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
const TAIL_N = Math.round(RATE * 1.3);
/** One line's blips (audio.js blip): 8 ms attack, exponential decay to silence over `dur`, what passes the end wraps round. */
async function renderLine(notes: Note[]): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, MUSIC_N + TAIL_N, RATE);
  for (const n of notes) {
    const osc = off.createOscillator(); osc.type = n.tri ? "triangle" : "sine"; osc.frequency.value = n.f;
    const g = off.createGain();
    g.gain.setValueAtTime(0, n.t); g.gain.linearRampToValueAtTime(n.gain, n.t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, n.t + n.dur);
    osc.connect(g).connect(off.destination); osc.start(n.t); osc.stop(n.t + n.dur + 0.02);
  }
  const data = (await off.startRendering()).getChannelData(0);
  const out = data.slice(0, MUSIC_N);
  for (let i = 0; i < TAIL_N; i++) out[i]! += data[MUSIC_N + i]!;
  return createClip([out], RATE);
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
/** Each frame: once the mixer runs and the renders are in, the ambience and the music start. */
export function update(dt: number): void {
  // audio.js: the intensity eases off by 0.02 a step (300 ms).
  intensity = Math.max(0, intensity - (0.02 / STEP_S) * dt);
  if (bVoice && !suspended && Math.abs(intensity - lastIntensity) > 0.02) {
    lastIntensity = intensity;
    try { bVoice.fade(MUSIC_GAIN * intensity, 0.3); } catch { /* gone */ }
  }
  if (context.state !== "running") return;
  try {
    if (ambClip && !ambVoice) ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : AMB_GAIN, loop: true });
    if (aClip && !aVoice) aVoice = playClip(aClip, { bus: "music", gain: suspended ? 0 : MUSIC_GAIN, loop: true });
    if (bClip && !bVoice) bVoice = playClip(bClip, { bus: "music", gain: suspended ? 0 : MUSIC_GAIN * intensity, loop: true });
  } catch { /* the mixer is full this frame: next frame */ }
}
