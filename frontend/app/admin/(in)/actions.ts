"use server";

// What an admin can change from the dashboard. Each one goes to the backend,
// which checks the admin's role again and writes the action to the admin log.
import { redirect } from "next/navigation";
import { adminPost } from "@/lib/server/adminApi";

const back = (path: string, r: { ok: boolean; error?: string }, done: string): never => redirect(`${path}?${r.ok ? `ok=${done}` : `err=${r.error ?? "failed"}`}`);
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function recordPayout(f: FormData) {
  const r = await adminPost("admin/payouts", { wallet: s(f, "wallet"), amount: Number(s(f, "amount")), token: s(f, "token") || "G$", reason: s(f, "reason"), txHash: s(f, "txHash"), status: s(f, "status") || "sent", paidAt: s(f, "paidAt") || undefined, note: s(f, "note") });
  back("/admin/rewards", r, "recorded");
}
export async function setPayoutStatus(f: FormData) {
  const r = await adminPost("admin/payouts/status", { id: Number(s(f, "id")), status: s(f, "status") });
  back("/admin/rewards", r, "updated");
}
export async function saveAdmin(f: FormData) {
  const r = await adminPost("admin/admins", { email: s(f, "email"), name: s(f, "name"), role: s(f, "role"), password: String(f.get("password") ?? "") });
  back("/admin/admins", r, "saved");
}
export async function disableAdmin(f: FormData) {
  const r = await adminPost("admin/admins/disable", { email: s(f, "email"), disabled: s(f, "disabled") !== "false" });
  back("/admin/admins", r, "updated");
}

/** Send a "what is new" message to every player: the bell, the pop-up, and a push if one was written. */
export async function sendAnnouncement(f: FormData) {
  const pushOnly = f.get("pushOnly") === "on";
  const r = await adminPost("admin/announce", { title: s(f, "title"), body: s(f, "body"), pushTitle: s(f, "pushTitle"), pushBody: s(f, "pushBody"), url: s(f, "url") || "/dashboard", live: f.get("live") === "on", pushOnly });
  if (r.ok) {
    // the whole story of the push goes back to the page: phones found, sent, muted, expired, failed
    const p = (r.body.push ?? null) as { sent?: number; skipped?: number; devices?: number; expired?: number; failed?: number; why?: string | null; crashed?: boolean } | null;
    const q = new URLSearchParams({ ok: pushOnly ? "push" : "sent", pushed: p ? String(p.sent ?? 0) : "none" });
    if (p) { q.set("devices", String(p.devices ?? 0)); q.set("muted", String(p.skipped ?? 0)); q.set("expired", String(p.expired ?? 0)); q.set("failed", String(p.failed ?? 0)); if (p.crashed) q.set("crashed", "1"); if (p.why) q.set("why", p.why.slice(0, 120)); }
    redirect(`/admin/announce?${q.toString()}`);
  }
  back("/admin/announce", r, "sent");
}
