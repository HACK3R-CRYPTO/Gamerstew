// ─── Telegram deep links ─────────────────────────────────────────────────────
// One helper, every surface that nudges the player into the community chat.
//
// Constraint that shaped the design:
//   Telegram invite links of the form `t.me/+<hash>` (private/invite-only
//   groups) DO NOT support the `?text=` pre-fill query param. Only public
//   `t.me/<username>` links do. The GameArena chat group is invite-only
//   (`t.me/+oY4inbBoglViNmE0`), so the pre-fill goes through the system
//   clipboard instead · copy the message, open the invite, player joins
//   and pastes. Same pattern Discord uses for share-and-paste flows.
//
// Callers should:
//   1. Call `openTelegramWithContext(ctx)` from the click handler.
//   2. That single call copies the formatted message to the clipboard AND
//      opens the invite link in a new tab/window. Returns true on success,
//      false if the clipboard write failed (the link still opens either way
//      so the player has the manual fallback of typing the message).
//   3. Show a toast confirming "Message copied · paste in Telegram" so the
//      player knows what just happened.

export const TG_GROUP_INVITE =
  process.env.NEXT_PUBLIC_TG_GROUP_INVITE || "https://t.me/+oY4inbBoglViNmE0";

export type TelegramContext =
  | { kind: "gas-help"; wallet?: string; game?: string; score?: number }
  | { kind: "prize-claim"; wallet?: string; week?: number; gameLabel?: string }
  | { kind: "general"; wallet?: string };

const GAME_LABEL: Record<string, string> = {
  rhythm: "Rhythm Rush",
  simon: "Simon Memory",
  stack: "Stack Tower",
  survivor: "Slime Survivor",
};

// Builds the message a player will paste into the chat. Tailored to the
// intent so the recipient can act on it without a back-and-forth. Wallet
// always last · easy to copy out of the message for a manual top-up.
export function buildTelegramMessage(ctx: TelegramContext): string {
  const lines: string[] = [];
  if (ctx.kind === "gas-help") {
    lines.push("Hey · need a tiny CELO top-up to save my scores onchain.");
    if (ctx.game && typeof ctx.score === "number" && ctx.score > 0) {
      const label = GAME_LABEL[ctx.game] || ctx.game;
      lines.push(`Last run: ${label} · ${ctx.score}`);
    } else if (ctx.game) {
      const label = GAME_LABEL[ctx.game] || ctx.game;
      lines.push(`Game: ${label}`);
    }
    if (ctx.wallet) lines.push(`Wallet: ${ctx.wallet}`);
  } else if (ctx.kind === "prize-claim") {
    if (typeof ctx.week === "number" && ctx.week > 0) {
      lines.push(`Claiming prize for week ${ctx.week}.`);
    } else {
      lines.push("Claiming a leaderboard prize.");
    }
    if (ctx.gameLabel) lines.push(`Game: ${ctx.gameLabel}`);
    if (ctx.wallet) lines.push(`Wallet: ${ctx.wallet}`);
  } else {
    lines.push("Hi from GameArena.");
    if (ctx.wallet) lines.push(`Wallet: ${ctx.wallet}`);
  }
  return lines.join("\n");
}

// Best-effort clipboard write. Falls back silently if the browser blocks it
// (e.g. permissions denied, in-app webview without clipboard API). The link
// still opens · the player can type the message manually.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Single call site for every "open Telegram" CTA. Returns whether the
// clipboard write succeeded so the caller can show the right toast copy.
export async function openTelegramWithContext(
  ctx: TelegramContext,
): Promise<{ opened: boolean; copied: boolean }> {
  const msg = buildTelegramMessage(ctx);
  const copied = await copyToClipboard(msg);
  let opened = false;
  try {
    const win = window.open(TG_GROUP_INVITE, "_blank", "noopener,noreferrer");
    opened = !!win;
  } catch {
    opened = false;
  }
  if (!opened) {
    // Pop-up blockers fall through to here · navigate the current tab
    // instead so the user always reaches Telegram.
    try { window.location.href = TG_GROUP_INVITE; opened = true; } catch {}
  }
  return { opened, copied };
}
