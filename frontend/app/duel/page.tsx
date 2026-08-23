"use client";

// ─── /duel · the Rooms hub ───────────────────────────────────────────────────
// The native home for challenge rooms inside the app: create one, see the rooms
// you're in (including a private pool you've joined), and browse open public
// rooms to join. Cup visual language so it feels part of the platform.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { gameLabel, type DuelRoom } from "@/lib/duel";

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff", inkDim: "rgba(220,210,255,0.7)", inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.5)", hairline: "rgba(255,255,255,0.08)",
  gold: "#fde68a", green: "#34d399", cyan: "#22d3ee", accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

function fmtLeft(ms: number): string {
  if (ms <= 0) return "ended";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function RoomCard({ room, now }: { room: DuelRoom; now: number }) {
  const isPool = Number(room.seed_wei) > 0 && Number(room.stake_wei) === 0;
  const prize = formatEther(BigInt(room.seed_wei) + BigInt(room.stake_wei) * BigInt(room.capacity));
  const left = Date.parse(room.deadline) - now;
  const sealed = room.status !== "open" || left <= 0;
  return (
    <Link href={`/duel/${room.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div style={{ background: T.surface, border: `1px solid ${isPool ? `${T.gold}44` : T.hairline}`, borderRadius: 16, padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.12em", color: isPool ? T.gold : T.accent, textTransform: "uppercase" }}>{isPool ? "Prize pool" : "Duel"}</div>
          <div style={{ fontFamily: T.display, fontSize: 20, color: T.gold, marginTop: 2 }}>{prize} G$</div>
          <div style={{ fontSize: 11.5, color: T.inkDim, marginTop: 1 }}>{gameLabel(room.game_type)}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: sealed ? T.inkSoft : T.green, letterSpacing: "0.04em" }}>{sealed ? "sealed" : fmtLeft(left)}</div>
          <div style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 3 }}>{room.status === "resolved" ? "winner set" : "open"} ›</div>
        </div>
      </div>
    </Link>
  );
}

export default function DuelHubPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [open, setOpen] = useState<DuelRoom[]>([]);
  const [mine, setMine] = useState<DuelRoom[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    fetch("/api/duel/rooms", { cache: "no-store" }).then((r) => r.json()).then((j) => setOpen(j.rooms || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!address) { setMine([]); return; }
    fetch(`/api/duel/my?wallet=${address}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setMine(j.rooms || [])).catch(() => {});
  }, [address]);

  const Section = ({ title, tint, children }: { title: string; tint: string; children: React.ReactNode }) => (
    <div>
      <div style={{ fontFamily: T.body, fontSize: 11, color: tint, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <AppHeader />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "12px 16px 120px", display: "flex", flexDirection: "column", gap: 18 }}>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em" }}>ROOMS</div>
            <h1 style={{ fontFamily: T.display, fontSize: 26, margin: "4px 0 0", letterSpacing: "-0.01em" }}>Challenge rooms</h1>
          </div>
        </div>

        {/* create CTA */}
        <button onClick={() => router.push("/duel/create")}
          style={{ padding: "15px", borderRadius: 16, border: "none", cursor: "pointer", background: `linear-gradient(160deg, ${T.gold}, #f59e0b)`, color: "#150a2e", fontFamily: T.display, fontSize: 16 }}>
          + Create a room or prize pool
        </button>

        {mine.length > 0 && (
          <Section title="Your rooms" tint={T.gold}>
            {mine.map((r) => <RoomCard key={r.id} room={r} now={now} />)}
          </Section>
        )}

        <Section title="Open rooms" tint={T.green}>
          {open.length > 0
            ? open.map((r) => <RoomCard key={r.id} room={r} now={now} />)
            : <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5 }}>No open rooms right now. Create one, or if you were invited to a private pool, open the link your host shared.</div>}
        </Section>
      </div>
      <AppBottomNav wide={false} />
    </div>
  );
}
