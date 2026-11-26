import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentAdmin } from "@/lib/server/adminSession";
import SideNav from "@/components/admin/SideNav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "GameArena Admin", robots: { index: false, follow: false } };

type Item = [href: string, label: string, icon: string, need: "analyst" | "super_admin"];
const GROUPS: [string, Item[]][] = [
  ["Growth", [["/admin", "Overview", "M3 12 12 4l9 8v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", "analyst"], ["/admin/users", "Players", "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0M4 21a8 8 0 0 1 16 0z", "analyst"], ["/admin/games", "Games", "M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5.4 1.8L15 15H9l-1.6 1.8A3 3 0 0 1 2 15v-3a4 4 0 0 1 4-4m1 3v2m-1-1h2m7 0h.01M18 11h.01", "analyst"], ["/admin/runs", "Runs and shop", "M5 4l14 8-14 8zM19 4v16", "analyst"], ["/admin/traffic", "Visits", "M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7m9 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "analyst"], ["/admin/verification", "Verification", "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.500-8-9V6zm-3 9 2 2 4-4", "analyst"]]],
  ["Money", [["/admin/money", "Revenue", "M12 3v18M7 7h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8", "analyst"], ["/admin/rewards", "Payouts", "M4 8h16v12H4zM4 8l2-4h12l2 4M12 8v12M8 12h.01", "analyst"], ["/admin/onchain", "On-chain", "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.700-5.7l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", "analyst"]]],
  ["Records", [["/admin/announce", "Announce", "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zm13-3a5 5 0 0 1 0 8m2-11a9 9 0 0 1 0 14", "analyst"], ["/admin/activity", "Activity", "M3 12h4l3-8 4 16 3-8h4", "analyst"], ["/admin/reports", "Reports", "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7", "analyst"], ["/admin/admins", "Admins", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m9 4-2 1 .4 2.200-1.900 1.100-1.700-1.500-2 .8L13 19h-2l-.800-2.400-2-.8-1.700 1.500-1.900-1.100L5 13l-2-1 2-1-.4-2.200 1.900-1.100 1.700 1.500 2-.8L11 5h2l.8 2.400 2 .8 1.700-1.500 1.900 1.100L19 10z", "super_admin"]]],
];
const ROLE = { analyst: "Analyst", admin: "Admin", super_admin: "Super Admin" } as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await currentAdmin();
  if (!me) redirect("/admin/login");
  return (
    <div className="adm">
      <aside className="adm-side">
        <Link href="/admin" className="adm-brand"><span className="adm-mark">G</span><span>GameArena<small>Admin</small></span></Link>
        <SideNav groups={GROUPS.map(([name, items]) => ({ name, items: items.filter(([, , , need]) => need === "analyst" || me.role === "super_admin").map(([href, label, icon]) => ({ href, label, icon })) })).filter((g) => g.items.length)} />
        <div className="adm-me">
          <div><b>{me.name || me.email.split("@")[0]}</b><span>{ROLE[me.role]}</span></div>
          <form action="/api/admin/logout" method="post"><button>Sign out</button></form>
        </div>
      </aside>
      <main className="adm-main">{children}</main>
      <style>{`
        .adm { min-height: 100vh; display: grid; grid-template-columns: 236px minmax(0, 1fr); background: #f5f2fb; color: #1b0d42; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
        .adm-side { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: linear-gradient(180deg, #170a3a 0%, #24104f 100%); color: #e9e2ff; padding: 18px 12px; display: flex; flex-direction: column; gap: 6px; }
        .adm-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #fff; padding: 4px 8px 14px; font-family: "Melon Pop", "Fredoka", system-ui, sans-serif; font-size: 19px; line-height: 1; }
        .adm-brand small { display: block; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: #c4b5fd; margin-top: 4px; font-weight: 700; }
        .adm-mark { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(140deg, #fbbf24, #f472b6 60%, #7c3aed); color: #1b0d42; font-size: 21px; }
        .adm-group { margin-top: 10px; display: grid; gap: 2px; }
        .adm-group-name { font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: rgba(233,226,255,0.5); font-weight: 800; padding: 6px 10px 4px; }
        .adm-link { display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 12px; color: #e9e2ff; text-decoration: none; font-size: 14.5px; font-weight: 600; }
        .adm-link:hover { background: rgba(255,255,255,0.09); color: #fff; }
        .adm-link.on { background: linear-gradient(90deg, #7c3aed, #6d28d9); color: #fff; box-shadow: 0 8px 18px -10px rgba(124,58,237,0.9); }
        .adm-link:focus-visible { outline: 2px solid #c4b5fd; outline-offset: 1px; }
        .adm-me { margin-top: auto; padding: 12px 10px 4px; border-top: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .adm-me b { display: block; color: #fff; font-size: 14px; } .adm-me span { font-size: 12px; color: #c4b5fd; }
        .adm-me button { padding: 7px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.25); background: transparent; color: #fff; font-weight: 700; font-size: 12.5px; cursor: pointer; }
        .adm-main { padding: 26px 28px 70px; min-width: 0; max-width: 1380px; width: 100%; }
        @media (max-width: 900px) {
          .adm { grid-template-columns: minmax(0, 1fr); }
          .adm-side { position: sticky; top: 0; z-index: 20; height: auto; flex-direction: row; align-items: center; padding: 8px 10px; overflow-x: auto; gap: 4px; }
          .adm-brand { padding: 0 6px 0 0; } .adm-brand span:last-child { display: none; }
          .adm-side nav { display: flex; gap: 2px; } .adm-group { display: flex; margin: 0; gap: 2px; } .adm-group-name { display: none; }
          .adm-link { white-space: nowrap; padding: 8px 10px; } .adm-me { margin: 0 0 0 auto; border: none; padding: 0 0 0 8px; } .adm-me div { display: none; }
          .adm-main { padding: 16px 14px 60px; }
        }
      `}</style>
    </div>
  );
}
