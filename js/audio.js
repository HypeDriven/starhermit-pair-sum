// Pair Sum — audio module.
// All sounds are original, synthesized with WebAudio: short transients tied to
// logical events, layered material impacts, quiet ambience, and an adaptive
// generative music stem. Buses: music / effects / ambience / voice, each with
// an independent slider. Seeded pitch variants keep replays consistent.

import { createStream } from './rules.js';

// Authored sample one-shots (sfx/<name>.opus, see sfx/manifest.json), mapped
// onto the existing logical events. Each event prefers its sample and falls
// back to the synthesized path while the clip is still loading or missing.
const SFX = {
  select: 'tile-select',
  deselect: 'tile-deselect',
  clear: 'pair-clear',
  clearChain: 'chain-clear',
  collapse: 'row-collapse',
  addRows: 'rows-added',
  invalid: 'invalid-pair',
  win: 'round-win',
  lose: 'round-lose',
  hint: 'hint-reveal',
  undo: 'undo-move',
  uiClick: 'ui-click',
};

export class AudioEngine {
  constructor(settings, emitCaption = () => {}) {
    this.settings = settings;       // live settings object (volumes 0..1, muted)
    this.emitCaption = emitCaption; // text cues for meaningful audio
    this.ctx = null;
    this.buses = {};
    this.musicTimer = null;
    this.ambienceSrc = null;
    this.stream = createStream('audio-variants');
    this.sfxCache = new Map();      // name -> { buffer, promise, failed }
    this.started = false;
  }

  // Must be called from a user gesture.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    for (const bus of ['music', 'effects', 'ambience', 'voice']) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.buses[bus] = g;
    }
    this.applyVolumes();
    this.startAmbience();
    this.startMusic();
    this.started = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const mute = s.muted ? 0 : 1;
    this.master.gain.value = mute;
    this.buses.music.gain.value = (s.volMusic ?? 0.5) * 0.5;
    this.buses.effects.gain.value = (s.volEffects ?? 0.8);
    this.buses.ambience.gain.value = (s.volAmbience ?? 0.4) * 0.35;
    this.buses.voice.gain.value = (s.volVoice ?? 0.8);
    this.captions = !!s.captions;
  }

  caption(text) {
    if (this.settings.captions) this.emitCaption(text);
  }

  // --- authored sample one-shots (lazy fetch/decode after gesture unlock) ----

  loadSample(name) {
    // Starts a lazy fetch/decode on first use; returns the AudioBuffer only
    // once decoded, otherwise null (caller falls back to synthesis).
    if (!this.ctx) return null;
    let rec = this.sfxCache.get(name);
    if (!rec) {
      rec = { buffer: null, promise: null, failed: false };
      this.sfxCache.set(name, rec);
    }
    if (rec.buffer) return rec.buffer;
    if (rec.failed || rec.promise) return null;
    rec.promise = fetch(`sfx/${name}.opus`)
      .then((r) => { if (!r.ok) throw new Error(`sfx ${name}: ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buffer) => { rec.buffer = buffer; })
      .catch(() => { rec.failed = true; });
    return null;
  }

  playSample(name) {
    const buffer = this.loadSample(name);
    if (!buffer) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.buses.effects);
    src.start();
    return true;
  }

  // --- synth primitives -------------------------------------------------------

  blip(bus, { freq = 440, dur = 0.08, type = 'sine', gain = 0.25, slide = 0, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.buses[bus]);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  thud(bus, { freq = 140, dur = 0.12, gain = 0.3 }) {
    // Layered material impact: pitched knock + filtered noise tap.
    this.blip(bus, { freq, dur, type: 'triangle', gain, slide: -freq * 0.5 });
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 0.05);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.value = gain * 0.5;
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t0);
  }

  // --- event mapping ------------------------------------------------------------

  onGameEvent(e) {
    if (!this.ctx) return;
    const v = 0.94 + this.stream.next() * 0.12; // seeded pitch variant
    switch (e.type) {
      case 'select':
        if (this.playSample(SFX.select)) break;
        this.blip('effects', { freq: 520 * v, dur: 0.05, type: 'sine', gain: 0.12 });
        break;
      case 'deselect':
        if (this.playSample(SFX.deselect)) break;
        this.blip('effects', { freq: 380 * v, dur: 0.05, type: 'sine', gain: 0.1 });
        break;
      case 'clear': {
        this.caption(`Pair cleared${e.chain > 1 ? `, chain ${e.chain}` : ''}`);
        if (this.playSample((e.chain || 1) > 1 ? SFX.clearChain : SFX.clear)) break;
        const base = 440 * Math.pow(1.0595, Math.min(12, (e.chain || 1) - 1));
        this.thud('effects', { freq: 150 * v, gain: 0.22 });
        this.blip('effects', { freq: base * v, dur: 0.14, type: 'sine', gain: 0.22 });
        this.blip('effects', { freq: base * 1.5 * v, dur: 0.18, type: 'sine', gain: 0.16, delay: 0.05 });
        break;
      }
      case 'collapse':
        this.caption('Row cleared');
        if (this.playSample(SFX.collapse)) break;
        this.blip('effects', { freq: 300 * v, dur: 0.25, type: 'sine', gain: 0.2, slide: 500 });
        break;
      case 'addRows':
        this.caption('Rows added');
        if (this.playSample(SFX.addRows)) break;
        this.blip('effects', { freq: 240 * v, dur: 0.3, type: 'triangle', gain: 0.2, slide: 260 });
        break;
      case 'invalid':
        this.caption('That pair is not legal');
        if (this.playSample(SFX.invalid)) break;
        this.blip('effects', { freq: 160, dur: 0.15, type: 'square', gain: 0.08, slide: -40 });
        break;
      case 'win':
        this.caption('Board clear!');
        if (this.playSample(SFX.win)) break;
        [523, 659, 784, 1047].forEach((f, i) =>
          this.blip('effects', { freq: f, dur: 0.3, type: 'sine', gain: 0.2, delay: i * 0.11 }));
        break;
      case 'lose':
        this.caption('Round over');
        if (this.playSample(SFX.lose)) break;
        [392, 330, 262].forEach((f, i) =>
          this.blip('effects', { freq: f, dur: 0.3, type: 'sine', gain: 0.18, delay: i * 0.14 }));
        break;
      case 'hint':
        if (this.playSample(SFX.hint)) break;
        this.blip('effects', { freq: 880, dur: 0.1, type: 'sine', gain: 0.12 });
        break;
      case 'undo':
        if (this.playSample(SFX.undo)) break;
        this.blip('effects', { freq: 340, dur: 0.09, type: 'triangle', gain: 0.14, slide: -80 });
        break;
      default:
        break;
    }
  }

  uiClick() {
    if (!this.ctx) return;
    if (this.playSample(SFX.uiClick)) return;
    this.blip('effects', { freq: 660, dur: 0.04, type: 'sine', gain: 0.08 });
  }

  // --- ambience: filtered looping noise, quiet ----------------------------------

  startAmbience() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = 987654321;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i] = ((s / 0x3fffffff) - 1) * 0.3;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    src.connect(f).connect(this.buses.ambience);
    src.start();
    this.ambienceSrc = src;
  }

  // --- adaptive generative music stem --------------------------------------------
  // Slow pentatonic pattern; density rises with chain/streak events.

  startMusic() {
    if (this.musicTimer) return;
    const scale = [262, 294, 330, 392, 440, 523, 587];
    let step = 0;
    this.intensity = 0;
    const tick = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      step++;
      const dense = this.intensity > 0 ? 2 : 4;
      if (step % dense === 0) {
        const note = scale[Math.floor(this.stream.next() * scale.length)];
        this.blip('music', { freq: note, dur: 0.5, type: 'sine', gain: 0.12 });
        if (this.stream.next() < 0.3 + this.intensity * 0.2) {
          this.blip('music', { freq: note * 1.5, dur: 0.4, type: 'sine', gain: 0.07, delay: 0.18 });
        }
      }
      if (step % 16 === 0) {
        this.blip('music', { freq: 131, dur: 1.2, type: 'triangle', gain: 0.1 });
      }
      this.intensity = Math.max(0, this.intensity - 0.02);
    };
    this.musicTimer = setInterval(tick, 300);
  }

  excite() { this.intensity = Math.min(1, this.intensity + 0.4); }

  setBackgrounded(hidden) {
    // Background tabs: keep the graph but duck hard / suspend to save battery.
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend();
    else this.ctx.resume();
  }
}
