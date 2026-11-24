"use client";

// The sidebar's links, with the page you are on marked.
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };
export default function SideNav({ groups }: { groups: { name: string; items: NavItem[] }[] }) {
  const path = usePathname() || "";
  const on = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));
  return (
    <nav aria-label="Admin sections">
      {groups.map((g) => (
        <div key={g.name} className="adm-group"><div className="adm-group-name">{g.name}</div>
          {g.items.map((i) => <Link key={i.href} href={i.href} className={`adm-link${on(i.href) ? " on" : ""}`} aria-current={on(i.href) ? "page" : undefined}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={i.icon} /></svg><span>{i.label}</span></Link>)}
        </div>
      ))}
    </nav>
  );
}
