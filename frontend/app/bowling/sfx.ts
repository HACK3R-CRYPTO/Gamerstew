// Sound for Street Strike: a tyre rumble that thumps in time with the wheel,
// and REAL recordings for everything else: each bottle's own glass hit and
// rolling knocks, and the crowd. Nothing loops. No jingles or electronic notes (public/bowling/audio, credited in public/world/CREDITS.md).
// Starts on the first gesture (browsers require it).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let rumble: { gain: GainNode; filter: BiquadFilterNode; beat: OscillatorNode; depth: GainNode } | null = null;
const SAMPLES = { cheer: "/bowling/audio/crowd-cheer.mp3", yeah: "/bowling/audio/crowd-yeah.mp3", clap: "/bowling/audio/crowd-clap.mp3", g1: "/bowling/audio/glass-1.mp3", g2: "/bowling/audio/glass-2.mp3", g3: "/bowling/audio/glass-3.mp3", g4: "/bowling/audio/glass-4.mp3", g5: "/bowling/audio/glass-5.mp3", g6: "/bowling/audio/glass-6.mp3", night: "/bowling/audio/night.mp3" } as const;
const GLASS = ["g1", "g2", "g3", "g4", "g5", "g6"] as const;
let night: GainNode | null = null; // the night itself: insects and still air, under everything
let voices = 0; // glass sounds playing right now, capped so a full rack never turns to mush
const bufs: Partial<Record<keyof typeof SAMPLES, AudioBuffer>> = {};
let muted = false;

export function armSfx() {
  // a phone can put sound to sleep (a call, a tab switch): wake it on any touch
  if (ctx && ctx.state !== "running") { ctx.resume().catch(() => { /* ignore */ }); voices = 0; }
  if (ctx || typeof window === "undefined") return;
  try {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8; // respect a mute pressed before the first touch
    master.connect(ctx.destination);
    // rumble: looped noise through a low-pass, gain driven by tyre speed
    const n = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // the tread thumps the road once per bit of turn: a pulse on the rumble whose
    // rate follows the wheel, so the roll has a beat instead of a flat hiss
    const pulse = ctx.createGain();
    pulse.gain.value = 0.55;
    const beat = ctx.createOscillator();
    beat.type = "triangle";
    beat.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 0.45;
    beat.connect(depth).connect(pulse.gain);
    beat.start();
    src.connect(filter).connect(pulse).connect(gain).connect(master);
    src.start();
    rumble = { gain, filter, beat, depth };
    const c = ctx;
    (Object.keys(SAMPLES) as (keyof typeof SAMPLES)[]).forEach((k) => {
      fetch(SAMPLES[k]).then((r) => r.arrayBuffer()).then((a) => c.decodeAudioData(a)).then((b) => {
        bufs[k] = b;
        // A quiet night bed: a real recording of insects on a still night, faded in
        // slowly. It is the only thing that loops, and it sits well under the game.
        if (k === "night" && ctx === c && master && !night) {
          const src = c.createBufferSource();
          src.buffer = b;
          src.loop = true;
          night = c.createGain();
          night.gain.setValueAtTime(0, c.currentTime);
          night.gain.linearRampToValueAtTime(0.5, c.currentTime + 2.5);
          src.connect(night).connect(master);
          src.start();
        }
      }).catch(() => { /* the game still plays without it */ });
    });
  } catch {
    ctx = null;
  }
}
export function setMuted(v: boolean) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.8;
}
export function closeSfx() {
  try { ctx?.close(); } catch { /* ignore */ }
  ctx = null;
  master = null;
  rumble = null;
  night = null;
  voices = 0;
  muted = false; // the page's mute button starts un-muted on every visit, so match it
}
/** speed in m/s, 0 = silent */
export function setRumble(speed: number) {
  if (!ctx || !rumble) return;
  const v = Math.min(1, speed / 10);
  // quick to die: when the tyre stops or leaves the road the sound stops with it
  rumble.gain.gain.setTargetAtTime(v * 0.26, ctx.currentTime, v > 0 ? 0.06 : 0.03);
  rumble.filter.frequency.setTargetAtTime(140 + v * 320, ctx.currentTime, 0.1);
  rumble.beat.frequency.setTargetAtTime(3 + speed * 1.6, ctx.currentTime, 0.08);
}
function sample(name: keyof typeof SAMPLES, vol: number, rate = 1) {
  const b = bufs[name];
  if (!ctx || !master || muted || !b) return false;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start();
  return true;
}
// ── Bottles: one voice per bottle, one sound per event ───────────────────────
// Every bottle has its own note (its own recorded hit and its own pitch, like
// ten real bottles that are never quite the same), and it only ever sounds when
// THAT bottle does something: gets struck, lands, or knocks the road as it
// rolls. Nothing loops. When a bottle stops moving it is silent.
function glass(i: number, vol: number, pan: number, dur: number, bright: number) {
  const b = bufs[GLASS[i % GLASS.length]];
  if (!ctx || !master || muted || !b || voices >= 9 || vol < 0.015) return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = b;
  // each bottle keeps its own pitch (a little lower than the drinking glasses in
  // the recording, since a beer bottle is thicker), with a touch of variation
  src.playbackRate.value = (0.68 + ((i * 7) % 10) * 0.034) * (0.97 + Math.random() * 0.06);
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2200 + bright * 7000; // soft knocks are duller than hard hits
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.min(1, vol), now);
  g.gain.setTargetAtTime(0.0001, now + dur * 0.35, dur * 0.3); // ring out, then gone
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); src.connect(tone).connect(g).connect(p).connect(master); }
  else src.connect(tone).connect(g).connect(master);
  voices++;
  src.onended = () => { voices = Math.max(0, voices - 1); };
  src.start(now);
  src.stop(now + dur + 0.05);
}
/** bottle `i` was struck or landed. `strength` 0..1 from how hard, `pan` -1..1 from where */
/** counts, so a test can prove bottles are silent at rest */
export const sfxCount = { hits: 0, rolls: 0 };
export function bottleHit(i: number, strength: number, pan = 0) {
  sfxCount.hits++;
  const s = Math.min(1, strength);
  glass(i, 0.12 + s * 0.88, pan, 0.28 + s * 0.4, s);
}
/** bottle `i` knocked the road once as it rolled: a short, soft, dull tick */
export function bottleRoll(i: number, speed: number, pan = 0) {
  sfxCount.rolls++;
  const s = Math.min(1, speed);
  glass(i, 0.04 + s * 0.13, pan, 0.09, 0.12 + s * 0.2);
}
/** the crowd is loud: pull the night bed down under it, then let it come back */
function duckNight(sec: number) {
  if (!ctx || !night) return;
  const t = ctx.currentTime;
  night.gain.cancelScheduledValues(t);
  night.gain.setTargetAtTime(0.18, t, 0.08);
  night.gain.setTargetAtTime(0.5, t + sec, 0.6);
}
/** the street reacts out loud. "boo" is a synth groan: there is no recording for it yet */
export function crowdSound(mood: "wild" | "yeah" | "clap" | "boo") {
  if (!ctx || !master || muted) return;
  duckNight(mood === "wild" ? 4.5 : 2.2);
  if (mood === "wild") { sample("cheer", 0.95); return; }
  if (mood === "yeah") { sample("yeah", 0.8); return; }
  if (mood === "clap") { sample("clap", 0.6, 0.96 + Math.random() * 0.1); return; }
  // the groan: the same real crowd, slowed right down, so it drops to a low "ohhh"
  // (no electronic tones anywhere in the reactions)
  sample("yeah", 0.55, 0.58);
}
function ping(f: number, at: number, dur: number, peak: number, type: OscillatorType = "sine") {
  if (!ctx || !master || muted) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.03);
}
export function thud() {
  if (!ctx) return;
  ping(90, ctx.currentTime, 0.28, 0.25, "sine");
  ping(60, ctx.currentTime + 0.02, 0.35, 0.2, "sine");
}
export function buzz(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}
