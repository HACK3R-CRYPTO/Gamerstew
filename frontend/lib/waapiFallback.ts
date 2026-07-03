// ─── WAAPI animation fallback ────────────────────────────────────────────────
// Some devices refuse to APPLY CSS animations from any stylesheet (content
// blockers injecting `animation: none !important`, aggressive data/battery
// savers, certain webviews) while the Web Animations API on the very same
// compositor works fine — verified on-device via /animtest (CSS ✗, WAAPI ✓).
//
// This module makes animations device-proof without duplicating anything:
//   1. Probe once whether CSS animations actually run.
//   2. If dead: walk the root, read each element's inline `animation`
//      shorthand, look the keyframes up in the CSSOM (the stylesheet IS
//      loaded — only its application is blocked), and replay via
//      element.animate(). A MutationObserver keeps up with React remounts.
// Healthy browsers: pure no-op, zero cost, CSS runs as authored.

let cssWorksCache: boolean | null = null;

// Probe: animate a detached-ish element for 3 frames and see if the
// computed transform moves. ~50ms, runs once per session.
export function probeCssAnimations(): Promise<boolean> {
  return new Promise((resolve) => {
    if (cssWorksCache !== null) return resolve(cssWorksCache);
    if (typeof document === "undefined") return resolve(true);
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;left:-9999px;top:0;width:10px;height:10px;pointer-events:none;" +
      "animation: animtestPump 0.3s linear infinite;";
    document.body.appendChild(el);
    const t0 = getComputedStyle(el).transform;
    setTimeout(() => {
      const t1 = getComputedStyle(el).transform;
      el.remove();
      cssWorksCache = t0 !== t1;
      resolve(cssWorksCache);
    }, 90);
  });
}

// ─── CSSOM keyframe extraction ───────────────────────────────────────────────
const kfCache = new Map<string, Keyframe[] | null>();

function camel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function getKeyframes(name: string): Keyframe[] | null {
  if (kfCache.has(name)) return kfCache.get(name)!;
  let found: Keyframe[] | null = null;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin
    for (const rule of Array.from(rules)) {
      if (rule.type !== CSSRule.KEYFRAMES_RULE) continue;
      const kr = rule as CSSKeyframesRule;
      if (kr.name !== name) continue;
      const frames: Keyframe[] = [];
      for (const fr of Array.from(kr.cssRules) as CSSKeyframeRule[]) {
        // keyText may hold several offsets: "0%,100%"
        for (const key of fr.keyText.split(",")) {
          const k = key.trim();
          const offset = k === "from" ? 0 : k === "to" ? 1 : parseFloat(k) / 100;
          const frame: Keyframe = { offset };
          for (let i = 0; i < fr.style.length; i++) {
            const prop = fr.style.item(i);
            (frame as Record<string, unknown>)[camel(prop)] = fr.style.getPropertyValue(prop);
          }
          frames.push(frame);
        }
      }
      frames.sort((a, b) => (a.offset as number) - (b.offset as number));
      found = frames.length ? frames : null;
      break;
    }
    if (found) break;
  }
  kfCache.set(name, found);
  return found;
}

// ─── animation shorthand parsing ─────────────────────────────────────────────
const EASINGS = /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\))$/;
const FILLS = /^(none|forwards|backwards|both)$/;

type Parsed = { name: string; duration: number; delay: number; easing: string; iterations: number; fill: FillMode };

function parseShorthand(anim: string): Parsed | null {
  const tokens = anim.trim().split(/\s+/);
  if (!tokens.length) return null;
  const out: Parsed = { name: "", duration: 0, delay: 0, easing: "ease", iterations: 1, fill: "none" };
  const times: number[] = [];
  for (const t of tokens) {
    if (/^-?\d*\.?\d+m?s$/.test(t)) { times.push(t.endsWith("ms") ? parseFloat(t) : parseFloat(t) * 1000); continue; }
    if (EASINGS.test(t)) { out.easing = t; continue; }
    if (t === "infinite") { out.iterations = Infinity; continue; }
    if (/^\d+$/.test(t)) { out.iterations = parseInt(t, 10); continue; }
    if (FILLS.test(t)) { out.fill = t as FillMode; continue; }
    if (!out.name) out.name = t;
  }
  out.duration = times[0] ?? 0;
  out.delay = times[1] ?? 0;
  return out.name && out.duration > 0 ? out : null;
}

// ─── the runner ──────────────────────────────────────────────────────────────
const running = new WeakMap<Element, { decl: string; anim: Animation }>();

function drive(el: HTMLElement) {
  const decl = el.style.animation;
  const prev = running.get(el);
  if (!decl || decl === "none") {
    if (prev) { prev.anim.cancel(); running.delete(el); }
    return;
  }
  if (prev?.decl === decl) return; // already driving this exact animation
  if (prev) { prev.anim.cancel(); running.delete(el); }
  const p = parseShorthand(decl);
  if (!p) return;
  const kf = getKeyframes(p.name);
  if (!kf) return;
  try {
    const anim = el.animate(kf, {
      duration: p.duration,
      delay: p.delay,
      easing: p.easing,
      iterations: p.iterations,
      fill: p.fill,
    });
    running.set(el, { decl, anim });
  } catch { /* malformed frames — skip, CSS-dead device just misses this one */ }
}

function scan(root: HTMLElement) {
  if (root.style?.animation) drive(root);
  root.querySelectorAll<HTMLElement>('[style*="animation"]').forEach(drive);
}

// Mount on a page root. Returns cleanup. No-op on healthy browsers.
export function startWaapiFallback(root: HTMLElement): () => void {
  let observer: MutationObserver | null = null;
  let cancelled = false;

  probeCssAnimations().then((works) => {
    if (works || cancelled) return;
    scan(root);
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => { if (n instanceof HTMLElement) scan(n); });
        } else if (m.type === "attributes" && m.target instanceof HTMLElement) {
          drive(m.target);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  });

  return () => { cancelled = true; observer?.disconnect(); };
}
