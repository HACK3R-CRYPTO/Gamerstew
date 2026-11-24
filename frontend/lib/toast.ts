// A small message that appears at the bottom of the screen and fades away.
// Plain DOM, so any screen can call it without finding a place to render it.
export function toast(message: string, ms = 4200): void {
  if (typeof document === "undefined") return;
  document.getElementById("ga-toast")?.remove();
  const el = document.createElement("div");
  el.id = "ga-toast";
  el.setAttribute("role", "alert");
  el.textContent = message;
  el.style.cssText = [
    "position:fixed", "left:50%", "bottom:calc(env(safe-area-inset-bottom,0px) + 28px)", "transform:translate(-50%,12px)",
    "z-index:9999", "max-width:min(92vw,420px)", "padding:13px 18px", "border-radius:16px",
    "background:#22104f", "color:#fff", "font:700 14px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif",
    "text-align:center", "box-shadow:0 18px 40px -14px rgba(0,0,0,.7)", "opacity:0", "transition:opacity .22s ease,transform .22s ease", "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translate(-50%,0)"; });
  window.setTimeout(() => { el.style.opacity = "0"; window.setTimeout(() => el.remove(), 260); }, ms);
}

/** What to tell a player when a ranked run could not be opened. */
export function startProblem(error?: string): string {
  if (error && /unauthori|sign in/i.test(error)) return "Your sign-in has expired. Sign in again to play ranked.";
  return "Can't reach the game server, so this run can't be ranked right now. Try again, or play a free mode.";
}
