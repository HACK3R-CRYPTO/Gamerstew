import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentAdmin } from "@/lib/server/adminSession";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "GameArena Admin", robots: { index: false, follow: false } };

const NAV: [string, string, "analyst" | "super_admin"][] = [
  ["/admin", "Overview", "analyst"], ["/admin/users", "Users & players", "analyst"], ["/admin/games", "Games", "analyst"], ["/admin/traffic", "Visits", "analyst"],
  ["/admin/verification", "Verification", "analyst"], ["/admin/money", "Money", "analyst"], ["/admin/rewards", "Rewards", "analyst"], ["/admin/onchain", "On-chain", "analyst"],
  ["/admin/activity", "Activity", "analyst"], ["/admin/reports", "Reports", "analyst"], ["/admin/admins", "Admins", "super_admin"],
];
const ROLE = { analyst: "Analyst", admin: "Admin", super_admin: "Super Admin" } as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await currentAdmin();
  if (!me) redirect("/admin/login");
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f6f1ff 0%, #ece3ff 100%)", color: "#22104f", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(76,29,149,0.14)" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link href="/admin" style={{ fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif', fontSize: 20, color: "#22104f", textDecoration: "none" }}>GameArena <span style={{ color: "#6d28d9" }}>Admin</span></Link>
          <span style={{ marginLeft: "auto", fontSize: 13, color: "rgba(34,16,79,0.7)" }}>{me.name || me.email} · <b>{ROLE[me.role]}</b></span>
          <form action="/api/admin/logout" method="post"><button style={{ padding: "7px 12px", borderRadius: 10, border: "1px solid rgba(76,29,149,0.2)", background: "#fff", color: "#22104f", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Sign out</button></form>
        </div>
        <nav aria-label="Admin sections" style={{ maxWidth: 1240, margin: "0 auto", padding: "0 16px 10px", display: "flex", gap: 6, overflowX: "auto" }}>
          {NAV.filter(([, , need]) => need === "analyst" || me.role === "super_admin").map(([href, label]) => (
            <Link key={href} href={href} style={{ flex: "0 0 auto", padding: "7px 12px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, color: "#22104f", background: "#f3effc", textDecoration: "none" }}>{label}</Link>
          ))}
        </nav>
      </header>
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 16px 60px" }}>{children}</main>
    </div>
  );
}
