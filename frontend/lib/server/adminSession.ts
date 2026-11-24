// Server only. The admin's signed-in state: a cookie the server signs and only
// the server can read or forge. It holds who they are and when it runs out.
// The role inside it is for showing the right menu; the backend looks the admin
// up again on every request and decides what they may do.
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export type AdminRole = "analyst" | "admin" | "super_admin";
export interface AdminSession { email: string; name: string | null; role: AdminRole; exp: number }
export const ADMIN_COOKIE = "ga_admin";
const HOURS = 12;

function key(): Buffer {
  const secret = process.env.INTERNAL_SECRET || "";
  if (!secret) throw new Error("INTERNAL_SECRET is not set");
  return createHmac("sha256", secret).update("gamearena-admin-session-v1").digest(); // a key of its own, derived from the server secret
}
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export function sealSession(s: Omit<AdminSession, "exp">): { value: string; maxAge: number } {
  const maxAge = HOURS * 3600;
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + maxAge * 1000 })).toString("base64url");
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

export function openSession(value: string | undefined): AdminSession | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  try {
    const want = Buffer.from(sign(payload)); const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    return typeof s.email === "string" && typeof s.exp === "number" && s.exp > Date.now() ? s : null;
  } catch { return null; }
}

export async function currentAdmin(): Promise<AdminSession | null> {
  return openSession((await cookies()).get(ADMIN_COOKIE)?.value);
}
