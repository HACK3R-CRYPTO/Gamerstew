// Server only. How the admin pages reach the backend: with the internal secret
// and the signed-in admin's email. Never called from the browser.
import { currentAdmin } from "./adminSession";

const BACKEND = () => process.env.BACKEND_URL || "http://localhost:3005";
const headers = (email?: string): Record<string, string> => ({ "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "", ...(email ? { "x-admin-email": email } : {}) });

export interface AdminReply<T> { ok: boolean; data: T | null; total?: number; error?: string; status: number }

/** One dashboard read. `what` is the name the backend knows it by. */
export async function adminRead<T>(what: string, query: Record<string, string | number | undefined> = {}): Promise<AdminReply<T>> {
  const me = await currentAdmin();
  if (!me) return { ok: false, data: null, error: "not_signed_in", status: 401 };
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  try {
    const r = await fetch(`${BACKEND()}/internal/admin/q/${what}${qs ? `?${qs}` : ""}`, { headers: headers(me.email), cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: (j.data ?? null) as T | null, total: j.total, error: j.error, status: r.status };
  } catch { return { ok: false, data: null, error: "unreachable", status: 502 }; }
}

export async function adminPost(path: string, body: Record<string, unknown>, asEmail?: string): Promise<{ ok: boolean; error?: string; body: Record<string, unknown> }> {
  const email = asEmail ?? (await currentAdmin())?.email;
  try {
    const r = await fetch(`${BACKEND()}/internal/${path}`, { method: "POST", headers: headers(email), body: JSON.stringify(body), cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, error: typeof j.error === "string" ? j.error : undefined, body: j };
  } catch { return { ok: false, error: "unreachable", body: {} }; }
}
