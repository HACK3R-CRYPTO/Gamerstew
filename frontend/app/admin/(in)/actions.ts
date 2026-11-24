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
