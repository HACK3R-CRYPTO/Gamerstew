"use client";

// ─── UP NEPA 3D — the charging game ──────────────────────────────────────────
// A frantic hustle: NEPA gives you a short window of light, you RUSH between the
// devices around the hood and bank their value before the blackout. The fun comes
// from four things:
//   • RACE THE CUT  — charging stops the instant NEPA cuts, and anything you were
//     mid-charging is LOST. Starting the fridge with 2s of light left is a gamble.
//   • COMBO         — bank devices back-to-back to climb a x1→x5 multiplier.
//     Getting caught mid-charge by a cut breaks the combo.
//   • ESCALATION    — each light window is shorter and pays more than the last.
//   • SPEED         — fast charges + fast movement, so you are always moving and
//     banking, never standing watching a bar.
//
// HOT state (deviceState, mutated every frame in GameDirector) stays out of React;
// only the HUD numbers live in the zustand store, pushed a few times a second.
// Self-contained + scored locally — never touches the 2D game's scoring/anti-cheat.

import { create } from "zustand";

export interface DeviceDef {
  id: string;
  label: string;
  icon: string;
  value: number; // base ₦ (scaled up each window)
  chargeTime: number; // seconds of standing on it (with light) to fill — kept SHORT
  pos: [number, number];
  color: string;
}

// Short charge times → you tap through devices fast; the fridge is the only real
// commitment (and the big risk when the light is running out).
// Values and charge times follow the original UP NEPA design: cheap things fill
// fast, the fridge is the jackpot and the gamble. `pos` is where the device lives
// around your place; `weight` slows you while you carry it (1 = no slowdown).
export const DEVICES: DeviceDef[] = [
  { id: "phone", label: "Phone", icon: "📱", value: 8000, chargeTime: 2.0, pos: [4.3, 10.5], color: "#4ea1ff" },
  { id: "lamp", label: "Rechargeable lamp", icon: "🔦", value: 10000, chargeTime: 2.5, pos: [4.3, -1.5], color: "#ffd36a" },
  { id: "powerbank", label: "Power bank", icon: "🔋", value: 12000, chargeTime: 3.0, pos: [-4.3, 9], color: "#9b7aff" },
  { id: "fan", label: "Standing fan", icon: "🌀", value: 15000, chargeTime: 4.0, pos: [-4.3, -5], color: "#7af0d0" },
  { id: "inverter", label: "Inverter", icon: "🔌", value: 30000, chargeTime: 6.0, pos: [4.3, -17], color: "#ff9e5e" },
  { id: "fridge", label: "Fridge", icon: "🧊", value: 40000, chargeTime: 8.0, pos: [-4.3, 21], color: "#aee9ff" },
];
export const WEIGHT: Record<string, number> = { phone: 1, lamp: 1, powerbank: 1, fan: 0.86, inverter: 0.76, fridge: 0.64 };

// ── The three sockets ────────────────────────────────────────────────────────
// The whole game is this limit. Light just came, you own ONE extension box with
// three sockets, and everything needs charging. Carry a device to the box and it
// plugs itself in; all three charge at once while the light is on; a full one is
// collected the moment you are back at the box. When NEPA takes the light, any
// device still charging is caught: it pops out unpaid and you carry it again.
// So every trip is a bet: is there enough light left for the fridge?
export const STATION: [number, number] = [4.3, 4.6];
export const SOCKET_COUNT = 3;
export const PICK_RADIUS = 1.55; // walk this close to a device (empty-handed) to pick it up
export const STATION_RADIUS = 2.3; // …and this close to the box to plug in / collect
export const RESPAWN_DELAY = 1.6; // a collected device is back at its spot after this
export const FINAL_MULT = 2; // the last light pays double

export type Where = "home" | "carried" | "socket";
export interface LiveDevice {
  where: Where;
  socket: number; // 0..2 while in a socket
  progress: number; // 0..1
  ready: boolean; // full: safe from a cut, waiting to be collected
  respawn: number; // >0 = just collected, hidden until this runs out
  pulse: number; // >0 just after an event (plug / ready / bust), decays: drives a flash
}
export const live: LiveDevice[] = DEVICES.map(() => ({ where: "home", socket: -1, progress: 0, ready: false, respawn: 0, pulse: 0 }));
export const hands = { idx: -1 }; // which device you are carrying (-1 = none)
export function resetLive() {
  for (const d of live) {
    d.where = "home";
    d.socket = -1;
    d.progress = 0;
    d.ready = false;
    d.respawn = 0;
    d.pulse = 0;
  }
  hands.idx = -1;
}
/** Streak bonus for collecting without being caught: +15% per clean collect, up
 *  to ×1.9 (the original UP NEPA curve). Deliberately gentle, so the DECISION of
 *  what to plug in matters more than the multiplier. */
export function streakMult(combo: number): number {
  return Math.round((1 + 0.15 * Math.min(Math.max(combo - 1, 0), 6)) * 100) / 100;
}
/** First free socket, or -1. */
export function freeSocket(): number {
  for (let s = 0; s < SOCKET_COUNT; s++) if (!live.some((d) => d.where === "socket" && d.socket === s)) return s;
  return -1;
}
// ── Upgrades: pick one in every blackout ─────────────────────────────────────
// When NEPA takes the light you are offered three of these and may take one. It
// is what makes one run different from the last: a run with two fast chargers
// plays nothing like a run with a generator and strong legs.
export type PerkId = "charge" | "legs" | "gen" | "back" | "price";
export const PERKS: Record<PerkId, { icon: string; name: string; desc: string; max: number }> = {
  charge: { icon: "⚡", name: "Fast charger", desc: "Everything charges 25% faster", max: 2 },
  legs: { icon: "👟", name: "Fast legs", desc: "You move 12% faster", max: 2 },
  gen: { icon: "🛢️", name: "Small gen", desc: "Saves your best device from the next cut", max: 3 },
  back: { icon: "💪", name: "Strong back", desc: "Heavy things no longer slow you", max: 1 },
  price: { icon: "💰", name: "Better price", desc: "Everything pays 20% more", max: 2 },
};
export const perks: Record<PerkId, number> = { charge: 0, legs: 0, gen: 0, back: 0, price: 0 };
/** A neighbour's rush job: this device pays double if it is banked before the light goes (-1 = none). */
export const rush = { idx: -1 };
export const RUSH_MULT = 2;
export function resetPerks() { for (const k of Object.keys(perks) as PerkId[]) perks[k] = 0; rush.idx = -1; }
/** Three different upgrades you can still take, picked at random. */
export function drawPerks(rand: () => number = Math.random): PerkId[] {
  const open = (Object.keys(PERKS) as PerkId[]).filter((k) => perks[k] < PERKS[k].max);
  for (let i = open.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [open[i], open[j]] = [open[j], open[i]]; }
  return open.slice(0, 3);
}

export interface SocketView {
  idx: number; // device index, -1 = empty
  pct: number; // 0..100
  ready: boolean;
}

export const CHARGE_RADIUS = 2.4;
export const COOLDOWN = 3.6; // a device you just banked stays spent a while, so
// camping one spot stalls your combo — you have to keep ROUTING to new devices.
// No round countdown: you play through a fixed number of NEPA light windows, each
// shorter + richer than the last; the run ends on the final blackout — OR early,
// the moment you run out of strikes (see CHARGE_LIVES).
export const TOTAL_WINDOWS = 4; // four lights ≈ a 60-70 s run

// STAKES: you can now LOSE. Getting caught mid-charge when NEPA cuts costs a
// strike; three strikes and the hustle is over before the 5 windows are up. This
// gives the blackout gamble ("dare I start the fridge with 2s of light left?")
// real teeth and a reason to retry.
export const CHARGE_LIVES = 3;

// DECISION: each light window NEPA leaves ONE appliance "hot" (a surge line) —
// banking it pays HOT_MULT extra. It's usually the far/expensive one, so every
// window you choose: sprint for the hot money and risk the cut, or grab the safe
// nearby devices. The guide arrow points at the hot one. `chargeMeta` is hot
// (non-react) state the director writes and the device meshes read each frame.
export const HOT_MULT = 2;

// GOLDEN RARE: now and then (not every window) ONE device turns GOLDEN — it glows
// gold, the guide screams at it, and banking it pays GOLDEN_MULT. It's the "do I go
// for the big one?" gamble: usually a pricier/slower device, so chasing it across the
// street late in a window risks the cut for a huge payout. Rare on purpose.
export const GOLDEN_MULT = 6;
export const GOLDEN_CHANCE = 0.4; // per non-surge window, odds a golden appears
export const chargeMeta: { hotIdx: number | null; goldenIdx: number | null } = { hotIdx: null, goldenIdx: null };
export function resetChargeMeta() {
  chargeMeta.hotIdx = null;
  chargeMeta.goldenIdx = null;
}

// ── Scoring helpers ──────────────────────────────────────────────────────────
/** Combo → multiplier: x1 up to 2 banks, then +1 every 3 banks, capped at x5. */
export function comboMultiplier(combo: number): number {
  return Math.min(5, 1 + Math.floor(combo / 3));
}
/** Device value rises ~12% per light window, rounded to the nearest ₦100. */
export function scaledValue(base: number, windowIndex: number): number {
  return Math.round((base * (1 + 0.12 * windowIndex)) / 100) * 100;
}

// ── Hot per-frame state (NOT react) ──────────────────────────────────────────
export interface DeviceHot {
  progress: number;
  cooldown: number;
  flash: number;
}
export const deviceState: DeviceHot[] = DEVICES.map(() => ({ progress: 0, cooldown: 0, flash: 0 }));

export function resetDeviceState() {
  for (const d of deviceState) {
    d.progress = 0;
    d.cooldown = 0;
    d.flash = 0;
  }
}

// ── Hold-to-charge greed meter (Charge's core VERB — a press-and-HOLD, not a tap)
// This is what makes Charge feel like a different game from Restore's single precise
// FLIP. You HOLD the PUMP button and the charge climbs — fast at first, then
// DECELERATING as it nears the top (ease-out, so the sweet-spot is tense, not luck).
// RELEASE inside the GREEN band to bank; dead on the PEAK = PERFECT. Hold too long
// and it FRIES — device lost + a strike — but a red/spark WARNING telegraphs the fry
// for ~0.4s first, so it's always "I pushed it", never "the game stole it". The
// first couple of banks get a wider band and no fry-strike (front-loaded forgiveness).
// Research-tuned (fishing/golf power-bar lore): green ≈ top fifth, peak ≈ 0.9, fry @ 1.
export const CHARGE_GREEN_LO = 0.8; // bottom of the green release band (normal play)
export const CHARGE_GREEN_LO_EASY = 0.66; // wider band during the forgiveness window
export const CHARGE_PEAK = 0.9; // charge level that pays MAX
export const CHARGE_PERFECT_W = 0.05; // |charge − peak| ≤ this on release = PERFECT
export const CHARGE_FRY = 1.0; // hold the charge up to here = FRY (total loss)
export const CHARGE_WARN_FROM = 0.9; // red/spark fry-warning begins at this charge
export const CHARGE_FORGIVE_BANKS = 2; // first N banks: easy band + a fry costs no strike
export const CHARGE_MIN_BANK = 0.4; // release below this = nothing banked (just let go)

export interface ChargeTiming {
  activeIdx: number | null;
  charge: number; // 0..1 current charge level while holding
  held: boolean; // currently holding this frame (drives the meter fill + glow)
  greenLo: number; // bottom of the green band for THIS attempt (forgiveness-adjusted)
  rate: number; // charge units per second for the active device (big = slow = risky)
  noFry: boolean; // forgiveness: a fry on this attempt costs no strike
  warn: number; // 0..1 depth into the fry-warning zone (meter spark + rising audio pitch)
  result: number; // >0 just after a good bank (decays — gold/green flash); 2 = perfect
  fried: number; // >0 just after a fry (decays — red flash)
}
export const chargeTiming: ChargeTiming = {
  activeIdx: null,
  charge: 0,
  held: false,
  greenLo: CHARGE_GREEN_LO,
  rate: 0.5,
  noFry: false,
  warn: 0,
  result: 0,
  fried: 0,
};

/** Line up on a device: reset the charge and compute its rise rate (bigger, pricier
 *  devices charge slower, so committing to the fridge near a cut is the real gamble).
 *  `forgiving` widens the green band and waives the fry-strike for the first banks. */
export function armChargeTiming(idx: number, forgiving: boolean) {
  const def = DEVICES[idx];
  chargeTiming.activeIdx = idx;
  chargeTiming.charge = 0;
  chargeTiming.held = false;
  chargeTiming.greenLo = forgiving ? CHARGE_GREEN_LO_EASY : CHARGE_GREEN_LO;
  // Reach the PEAK in ~chargeTime seconds at full rate; the ease-out in the director
  // stretches the real time a little past that, which is the intended tension.
  chargeTiming.rate = CHARGE_PEAK / def.chargeTime;
  chargeTiming.noFry = forgiving;
  chargeTiming.warn = 0;
}

export function resetChargeTiming() {
  chargeTiming.activeIdx = null;
  chargeTiming.charge = 0;
  chargeTiming.held = false;
  chargeTiming.warn = 0;
  chargeTiming.result = 0;
  chargeTiming.fried = 0;
}

/** Payout tier for a RELEASE at charge level `c` given this attempt's green floor.
 *  Below MIN_BANK → nothing (you just let go). Building → partial. Green band →
 *  up to max at the peak. Overshoot past the peak → a gentle fall-off (still worth
 *  grabbing, so there's no cliff right after the peak — only the held-to-fry death). */
export function chargePayout(c: number, greenLo: number): { mult: number; perfect: boolean; tier: "none" | "weak" | "green" | "over" } {
  if (c < CHARGE_MIN_BANK) return { mult: 0, perfect: false, tier: "none" };
  if (c < greenLo) {
    const t = (c - CHARGE_MIN_BANK) / Math.max(0.001, greenLo - CHARGE_MIN_BANK);
    return { mult: 0.45 + 0.35 * t, perfect: false, tier: "weak" }; // 0.45 → 0.80
  }
  if (c <= CHARGE_PEAK) {
    const t = (c - greenLo) / Math.max(0.001, CHARGE_PEAK - greenLo);
    return { mult: 0.85 + 0.15 * t, perfect: c >= CHARGE_PEAK - CHARGE_PERFECT_W, tier: "green" }; // 0.85 → 1.0
  }
  const t = (c - CHARGE_PEAK) / Math.max(0.001, CHARGE_FRY - CHARGE_PEAK);
  return { mult: Math.max(0.8, 1.0 - 0.2 * t), perfect: c <= CHARGE_PEAK + CHARGE_PERFECT_W, tier: "over" }; // 1.0 → 0.8
}

/** Buzzer-beater gamble: banking in the final seconds of a light window pays a
 *  climbing bonus — 1× with time to spare, ramping toward 3× in the last blink. The
 *  reward for daring a late commit (which is exactly when the fry risk is highest). */
export function buzzerMult(lightLeft: number): number {
  if (lightLeft > 2) return 1;
  const t = Math.max(0, Math.min(1, (2 - lightLeft) / 1.6)); // 0 at 2s → 1 at 0.4s
  return 1 + 2 * t; // 1× → 3×
}

// ── Reactive store (HUD only) ────────────────────────────────────────────────
export type GameMode = "idle" | "playing" | "over";

export interface NearInfo {
  idx: number;
  progress: number;
  charging: boolean;
  cooldown: boolean;
}

/** Floating popup: a bank (+₦ with multiplier) or a "caught"/"fumble" (combo lost). */
export interface Popup {
  id: number;
  kind: "bank" | "caught";
  icon: string;
  value: number;
  mult: number;
  combo: number;
  perfect?: boolean;
  label?: string; // override text for a caught/fumble
}

export interface Summary {
  score: number;
  banked: number;
  bestCombo: number;
  best: { label: string; value: number } | null;
}

interface GameStore {
  mode: GameMode;
  score: number;
  banked: number;
  combo: number;
  multiplier: number;
  pStreak: number; // consecutive PERFECT plugs
  lives: number; // strikes left; a cut catches you mid-charge → -1, 0 = game over
  hotIdx: number | null; // (legacy, unused by the sockets game)
  sockets: SocketView[]; // what the HUD tray shows
  carrying: number; // device index in your hands, -1 = none
  finalLight: boolean; // the last light window (pays double)
  atRisk: number; // naira sitting in the sockets that a cut would take
  offer: PerkId[] | null; // the three upgrades on offer in this blackout
  owned: PerkId[]; // every upgrade taken this run, in order
  rushIdx: number; // the neighbour's rush device, -1 = none
  takePerk: (id: PerkId) => void;
  windowIndex: number;
  lightLeft: number; // seconds of light before the next cut
  lightOn: boolean; // false during a blackout
  near: NearInfo | null;
  pop: Popup | null;
  summary: Summary | null;
  startGame: () => void;
  endGame: (summary: Summary) => void;
  backToIdle: () => void;
  setLive: (v: Partial<GameStore>) => void;
  pushBank: (icon: string, value: number, mult: number, combo: number, perfect: boolean) => void;
  pushCaught: (combo: number, label?: string) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  mode: "idle",
  score: 0,
  banked: 0,
  combo: 0,
  multiplier: 1,
  pStreak: 0,
  lives: CHARGE_LIVES,
  hotIdx: null,
  sockets: [],
  carrying: -1,
  finalLight: false,
  atRisk: 0,
  offer: null,
  owned: [],
  rushIdx: -1,
  takePerk: (id) => set((s) => {
    if (!s.offer || !s.offer.includes(id) || perks[id] >= PERKS[id].max) return {};
    perks[id] += 1;
    return { offer: null, owned: [...s.owned, id] };
  }),
  windowIndex: 0,
  lightLeft: 0,
  lightOn: true,
  near: null,
  pop: null,
  summary: null,
  startGame: () => {
    resetDeviceState();
    resetChargeMeta();
    resetLive();
    resetPerks();
    set({
      atRisk: 0,
      offer: null,
      owned: [],
      rushIdx: -1,
      sockets: [],
      carrying: -1,
      finalLight: false,
      mode: "playing",
      score: 0,
      banked: 0,
      combo: 0,
      multiplier: 1,
      pStreak: 0,
      lives: CHARGE_LIVES,
      hotIdx: null,
      windowIndex: 0,
      near: null,
      pop: null,
      summary: null,
    });
  },
  endGame: (summary) => set({ mode: "over", summary, near: null }),
  backToIdle: () => set({ mode: "idle", near: null }),
  setLive: (v) => set(v),
  pushBank: (icon, value, mult, combo, perfect) =>
    set({ pop: { id: Date.now() + Math.random(), kind: "bank", icon, value, mult, combo, perfect } }),
  pushCaught: (combo, label) =>
    set({ pop: { id: Date.now() + Math.random(), kind: "caught", icon: "💥", value: 0, mult: 0, combo, label } }),
}));

export const naira = (n: number) => "₦" + n.toLocaleString("en-NG");

// Dev-only: expose the store + the hot charge state so the headless harness can
// start a run and read the live charge level (for precise release timing) in QA.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __gameStore?: typeof useGameStore }).__gameStore = useGameStore;
  (window as unknown as { __chargeTiming?: typeof chargeTiming }).__chargeTiming = chargeTiming;
  (window as unknown as { __chargeMeta?: typeof chargeMeta }).__chargeMeta = chargeMeta;
  (window as unknown as { __chargeLive?: unknown }).__chargeLive = { live, hands, STATION, DEVICES };
}
