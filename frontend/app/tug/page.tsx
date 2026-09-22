"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import TugRope, { TEAM_RED, TEAM_BLUE } from "@/components/TugRope";
import TugRules from "@/components/TugRules";
import { nextAction, type TugStandings, type TugMe } from "./types";

// ─── Verified Tug of War ─────────────────────────────────────────────────────
// Ordering is deliberate and follows what the screen has to achieve, in order:
//
//   1. WHO IS WINNING — answered before a single number is read, by the
//      battlefield tint bleeding in from each team's own edge.
//   2. IS IT STILL WINNABLE — the today-only tick, which resets nightly, so a
//      trailing side always has something live to fight for. This is the
//      anti-quit lever; handing the loser bonus points instead would read as
//      the house picking a winner, which with real money attached is fatal.
//   3. WHAT DO I GET — the bounty, stated as TEAM-INDEPENDENT in permanent
//      copy. A player on the losing side can still have banked a full 2,500 G$,
//      and they must be able to see that at any moment.
//   4. WHAT DO I DO NOW — exactly ONE instruction, pinned to the bottom of the
//      viewport so it is always reachable with a thumb.
//
// What is deliberately NOT here: a rules panel. Three bullet points explaining
// how scoring works is a manual, and nobody reads a manual during an event. The
// one thing a player needs to know is in the single CTA.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.72)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.5)",
  hairline: "rgba(255,255,255,0.09)",
  accent: "#a78bfa",
  gold: "#fde68a",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const PREVIEW: { standings: TugStandings; me: TugMe } = {
  standings: {
    eventId: "tug-1", status: "live",
    startsAt: "2026-09-23T17:00:00Z", endsAt: "2026-09-30T17:00:00Z",
    red: 1840, blue: 1595,
    today: { red: 210, blue: 265, date: "2026-09-25" },
    humans: { red: 96, blue: 84 },
    bounty: { slots: 160, claimed: 118, amountG: 2500 },
    prizeTotalG: 1_000_000,
    serverTime: "2026-09-25T14:10:00Z",
  },
  me: {
    wallet: "0xabc", team: "red", qualified: true, bountyRank: 118,
    pullsToday: 2, dailyPullCap: 5, pullsTotal: 47,
    gamesToQualify: 3, gamesPlayed: 12,
    verified: true, verificationDaysLeft: 174, teamPercentile: 24,
    neighbours: [
      { rank: 21, name: "zara", pulls: 54 },
      { rank: 22, name: "thunder", pulls: 51 },
      { rank: 23, name: "ogazboiz", pulls: 47, isMe: true },
      { rank: 24, name: "kelvin", pulls: 45 },
      { rank: 25, name: "ada", pulls: 44 },
    ],
  },
};

const PREVIEW_UPCOMING: { standings: TugStandings; me: TugMe } = {
  standings: {
    ...PREVIEW.standings,
    status: "scheduled",
    red: 0, blue: 0,
    today: { red: 0, blue: 0, date: "" },
    humans: { red: 0, blue: 0 },
    bounty: { slots: 160, claimed: 0, amountG: 2500 },
    serverTime: "2026-09-22T09:00:00Z",
  },
  me: {
    ...PREVIEW.me,
    team: null, qualified: false, bountyRank: null,
    pullsToday: 0, pullsTotal: 0, gamesPlayed: 0,
    verified: false, verificationDaysLeft: 0, teamPercentile: null,
    neighbours: undefined,
  },
};

export default function TugPage() {
  const [standings, setStandings] = useState<TugStandings | null>(null);
  const [me, setMe] = useState<TugMe | null>(null);
  const [age, setAge] = useState(0);
  const [preview, setPreview] = useState(false);
  const { address } = useAccount();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, m] = await Promise.all([
          fetch("/api/tug").then(r => (r.ok ? r.json() : null)),
          // Per-wallet, so it is only asked for once a wallet is connected.
          address
            ? fetch(`/api/tug/me?wallet=${address.toLowerCase()}`).then(r => (r.ok ? r.json() : null))
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        if (s && !s.error) {
          setStandings(s); setMe(m && !m.error ? m : null); setAge(0); setPreview(false);
        } else if (!standings) {
          // Only fall back to the fixture if we have NOTHING yet. Once real
          // standings have loaded, a failed poll keeps the last good rope and
          // lets the "updated Ns ago" line tell the truth — blanking the hero
          // mid-event reads as the event being broken.
          const f = fixture(); setStandings(f.standings); setMe(f.me); setPreview(true);
        }
      } catch {
        if (alive && !standings) { const f = fixture(); setStandings(f.standings); setMe(f.me); setPreview(true); }
      }
    };
    load();

    // ── Polling budget ──────────────────────────────────────────────────────
    // Poll, don't socket: a missed poll is one stale read, not a broken
    // connection to recover from on flaky mobile data.
    //
    // Three rules keep this cheap at scale, because request count is the cost
    // here — not payload:
    //   1. NEVER while the tab is hidden. A backgrounded phone polling every
    //      10s burns the player's data allowance for nothing, and at ₦431/GB
    //      that is real money to this audience.
    //   2. Back off when they stop looking. 15s while the tab is focused,
    //      60s once it has been idle for a minute. A rope that is a minute old
    //      on an unattended screen costs nobody anything.
    //   3. Poll on WAKE, not just on a timer — returning to the tab refreshes
    //      immediately, so backing off never feels stale.
    const FOCUSED_MS = 15_000;
    const IDLE_MS = 60_000;
    let lastInteraction = Date.now();
    const bump = () => { lastInteraction = Date.now(); };
    ["pointerdown", "keydown", "scroll"].forEach(e => window.addEventListener(e, bump, { passive: true }));

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const idle = Date.now() - lastInteraction > 60_000;
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await load();
        schedule();
      }, idle ? IDLE_MS : FOCUSED_MS);
    };
    schedule();

    const onVisible = () => { if (document.visibilityState === "visible") { bump(); load(); } };
    document.addEventListener("visibilitychange", onVisible);

    // The "updated Ns ago" counter is local only — no network, and it stops
    // with the tab so a hidden page is doing literally nothing.
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") setAge(a => a + 1);
    }, 1000);

    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      ["pointerdown", "keydown", "scroll"].forEach(e => window.removeEventListener(e, bump));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const action = useMemo(() => nextAction(me), [me]);

  if (!standings) {
    return <main style={shell(0)}><div style={{ color: T.inkSoft, padding: 40 }}>Loading…</div></main>;
  }

  // Pre-event screen. This is not a placeholder — the days before the start are
  // when a player has to get VERIFIED, because the bounty is first-come and a
  // first-ever GoodDollar check takes a real face scan. Someone who turns up on
  // day one unverified has already lost slots to people who prepared.
  if (standings.status === "scheduled") {
    return <Upcoming standings={standings} me={me} preview={preview} />;
  }

  const total = standings.red + standings.blue;
  const share = total > 0 ? standings.red / total : 0.5;
  const left = standings.bounty.slots - standings.bounty.claimed;
  const todayLeader = standings.today.red === standings.today.blue
    ? null : standings.today.red > standings.today.blue ? "red" : "blue";
  const todayLead = Math.abs(standings.today.red - standings.today.blue);

  return (
    <main style={shell(share)}>
      {/* Battlefield tint. Two static radial gradients anchored to each team's
          own edge, their strength following the score — so "who is winning" is
          answered by the screen itself before any number is read. Static
          gradients, never a blur filter: blur is the single most expensive
          thing you can put on a mid-range Android. */}
      <div aria-hidden style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background:
          `radial-gradient(ellipse 70% 52% at 0% 28%, rgba(220,38,38,${(0.10 + share * 0.30).toFixed(3)}) 0%, transparent 62%),` +
          `radial-gradient(ellipse 70% 52% at 100% 28%, rgba(103,232,249,${(0.10 + (1 - share) * 0.26).toFixed(3)}) 0%, transparent 62%)`,
      }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 13 }}>
        {preview && (
          <div style={{
            padding: "6px 11px", borderRadius: 9,
            background: "rgba(251,191,36,0.13)", border: "1px solid rgba(251,191,36,0.4)",
            fontSize: 10.5, fontWeight: 800, color: T.gold, fontFamily: T.body, letterSpacing: "0.02em",
          }}>
            PREVIEW · sample numbers · the live API returned nothing
          </div>
        )}

        {/* 1 · title + clock, one line each, no wasted vertical */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", color: T.accent }}>
              {dayOf(standings)}
            </div>
            <h1 style={{ fontFamily: T.display, fontSize: 25, color: T.ink, margin: "2px 0 0", letterSpacing: "-0.01em" }}>
              Tug of War
            </h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em", color: T.inkSoft }}>
              ENDS IN
            </div>
            <div style={{ fontFamily: T.display, fontSize: 19, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
              {msLeft(standings.endsAt, standings.serverTime)}
            </div>
          </div>
        </div>

        {/* 2 · the battle */}
        <TugRope
          red={standings.red} blue={standings.blue}
          redHumans={standings.humans.red} blueHumans={standings.humans.blue}
          updatedSecondsAgo={age} myTeam={me?.team ?? null}
        />

        {/* 3 · today — the reason a trailing side keeps playing */}
        <div style={{
          display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderRadius: 13,
          background: T.surface, border: `1px solid ${T.hairline}`,
        }}>
          <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.13em", color: T.inkSoft }}>
            TODAY
          </span>
          <span style={{ flex: 1, fontFamily: T.body, fontSize: 13, fontWeight: 800, color: T.ink }}>
            {todayLeader
              ? <>{todayLeader === "red" ? "RED" : "BLUE"} <span style={{ color: todayLeader === "red" ? TEAM_RED : TEAM_BLUE }}>+{todayLead}</span></>
              : "Level so far"}
          </span>
          <span style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700 }}>
            resets at midnight
          </span>
        </div>

        {/* 4 · the bounty — scarcity, and team-independence stated permanently */}
        <section style={{
          padding: 14, borderRadius: 16,
          background: "linear-gradient(135deg, rgba(251,191,36,0.16), rgba(120,53,15,0.26))",
          border: "1px solid rgba(251,191,36,0.42)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.13em", color: T.gold }}>
              GUARANTEED · NOT A PRIZE DRAW
            </span>
            <span style={{ fontFamily: T.display, fontSize: 15, color: T.gold, fontVariantNumeric: "tabular-nums" }}>
              {left} left
            </span>
          </div>
          <div style={{ fontFamily: T.display, fontSize: 21, color: T.ink, marginTop: 4, lineHeight: 1.15 }}>
            {standings.bounty.amountG.toLocaleString()} G$ each
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, fontWeight: 600, marginTop: 2 }}>
            to the first {standings.bounty.slots} verified players
          </div>
          <div style={{ height: 7, borderRadius: 4, background: "rgba(0,0,0,0.35)", overflow: "hidden", marginTop: 10 }}>
            <div style={{
              width: `${(standings.bounty.claimed / standings.bounty.slots) * 100}%`, height: "100%",
              background: "linear-gradient(90deg, #fde68a, #d97706)",
              transition: "width 600ms cubic-bezier(0.22, 1, 0.36, 1)",
            }} />
          </div>
          <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.gold, fontWeight: 800, marginTop: 8 }}>
            Yours even if your team loses the rope.
          </div>
        </section>

        {/* 5 · you */}
        <section style={{ padding: "12px 14px", borderRadius: 16, background: T.surface, border: `1px solid ${T.hairline}` }}>
          <div style={{ display: "flex" }}>
            <Cell label="YOUR PULLS" value={me?.pullsTotal?.toLocaleString() ?? "—"} />
            <Cell label="TEAM RANK" value={me?.teamPercentile != null ? `TOP ${me.teamPercentile}%` : "—"} />
            <Cell label="BOUNTY" value={me?.bountyRank ? `#${me.bountyRank} ✓` : `${left} left`} />
          </div>
        </section>

        {/* 6 · where you sit on YOUR team. Neighbourhood only — a global
               1..N board turns "rank 4,112" into a reason to close the tab,
               while five rows either side of you is a gap you can close
               tonight. */}
        {me?.neighbours?.length ? (
          <section style={{ padding: "12px 6px 8px", borderRadius: 16, background: T.surface, border: `1px solid ${T.hairline}` }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              padding: "0 9px 8px",
            }}>
              <span style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 900, letterSpacing: "0.13em", color: T.accent }}>
                YOUR TEAM
              </span>
              <span style={{ fontFamily: T.body, fontSize: 11, fontWeight: 800, color: T.inkSoft }}>
                {me.teamPercentile != null ? `top ${me.teamPercentile}%` : ""}
              </span>
            </div>
            {me.neighbours.map((n) => (
              <div key={n.rank} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 10,
                background: n.isMe ? (me.team === "red" ? "rgba(220,38,38,0.20)" : "rgba(103,232,249,0.16)") : "transparent",
                border: n.isMe ? `1px solid ${me.team === "red" ? TEAM_RED : TEAM_BLUE}66` : "1px solid transparent",
              }}>
                <span style={{
                  width: 24, fontFamily: T.body, fontSize: 11.5, fontWeight: 800,
                  color: n.isMe ? T.ink : T.inkSoft, fontVariantNumeric: "tabular-nums",
                }}>
                  {n.rank}
                </span>
                <span style={{
                  flex: 1, minWidth: 0, fontFamily: T.body, fontSize: 13,
                  fontWeight: n.isMe ? 900 : 700, color: n.isMe ? T.ink : T.inkDim,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  @{n.name}{n.isMe && " · you"}
                </span>
                <span style={{
                  fontFamily: T.display, fontSize: 14, color: n.isMe ? T.ink : T.inkDim,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {n.pulls}
                </span>
              </div>
            ))}
          </section>
        ) : null}

        {/* 7 · share. Text first, deliberately: a copyable grid costs no bytes,
               renders on any connection, and Wordle proved it outperforms an
               image at exactly this job. At ~₦431/GB a 250KB card sent ten
               times is real money to this audience. */}
        <button
          onClick={() => {
            const txt = shareText(standings, me);
            navigator.clipboard?.writeText(txt).catch(() => {});
          }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            padding: "13px", borderRadius: 14, cursor: "pointer",
            background: "rgba(255,255,255,0.06)", border: `1px solid ${T.hairline}`,
          }}
        >
          <span style={{ fontSize: 15 }}>📣</span>
          <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink }}>
            Copy your battle card
          </span>
        </button>

        <TugRules
          prizeTotalG={standings.prizeTotalG}
          bountySlots={standings.bounty.slots}
          bountyAmountG={standings.bounty.amountG}
          dailyPullCap={me?.dailyPullCap ?? 5}
          qualifyGames={me?.gamesToQualify ?? 3}
        />

        <div style={{ height: 78 }} />
      </div>

      {/* 6 · one instruction, always in thumb reach */}
      <div style={stickyBar}>
        <button style={ctaButton}>
          <span style={{ fontFamily: T.display, fontSize: 17, color: "#fff", textAlign: "left" }}>
            {actionLabel(action)}
          </span>
          <span style={ctaPill}>{actionCta(action)}</span>
        </button>
      </div>
    </main>
  );
}

function Upcoming({ standings, me, preview }: { standings: TugStandings; me: TugMe | null; preview: boolean }) {
  const [now, setNow] = useState(() => new Date(standings.serverTime).getTime());
  useEffect(() => { const i = setInterval(() => setNow(n => n + 1000), 1000); return () => clearInterval(i); }, []);
  const ms = Math.max(0, new Date(standings.startsAt).getTime() - now);
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);

  return (
    <main style={shell(0.5)}>
      <div aria-hidden style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background:
          "radial-gradient(ellipse 70% 52% at 0% 26%, rgba(220,38,38,0.22) 0%, transparent 62%)," +
          "radial-gradient(ellipse 70% 52% at 100% 26%, rgba(103,232,249,0.20) 0%, transparent 62%)",
      }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
        {preview && <PreviewChip />}

        {/* Full-bleed hero. The pre-event screen's whole job is to let someone
            PICTURE the thing before it exists, and a countdown over flat copy
            cannot do that. The art carries the concept — two crowds, one rope,
            a prize in the middle — in one glance, and the gradient underneath
            hands off into the page instead of ending on a hard edge. */}
        <div style={{
          position: "relative", marginLeft: -16, marginRight: -16, marginTop: -4,
          height: 196, overflow: "hidden",
        }}>
          <img
            src="/tug/hero.jpg"
            alt="Two teams of slimes pulling a rope"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(180deg, rgba(10,2,38,0.10) 0%, rgba(10,2,38,0.0) 38%, rgba(26,5,82,0.72) 78%, #1a0552 100%)",
          }} />
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 10, textAlign: "center" }}>
            <div style={{
              fontFamily: T.body, fontSize: 10, fontWeight: 900, letterSpacing: "0.18em", color: "#fde68a",
              textShadow: "0 2px 8px rgba(0,0,0,0.6)",
            }}>
              COMING {startWeekday(standings.startsAt).toUpperCase()}
            </div>
            <h1 style={{
              fontFamily: T.display, fontSize: 36, color: T.ink, margin: "3px 0 0", lineHeight: 1.05,
              textShadow: "0 3px 14px rgba(0,0,0,0.65)",
            }}>
              Tug of War
            </h1>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: -4 }}>
          <div style={{ fontFamily: T.body, fontSize: 13, color: T.inkDim, fontWeight: 600 }}>
            Two sides. Seven days. One rope.
          </div>
        </div>

        {/* countdown — the whole point of this screen is urgency */}
        <div style={{ display: "flex", gap: 7, justifyContent: "center" }}>
          {[[d, "DAYS"], [h, "HRS"], [m, "MIN"], [sec, "SEC"]].map(([v, l]) => (
            <div key={l as string} style={{
              flex: 1, maxWidth: 82, textAlign: "center", padding: "10px 4px", borderRadius: 13,
              background: T.surface, border: `1px solid ${T.hairline}`,
            }}>
              <div style={{
                fontFamily: T.display, fontSize: 26, color: T.ink, lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}>
                {String(v).padStart(2, "0")}
              </div>
              <div style={{ fontFamily: T.body, fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", color: T.inkSoft, marginTop: 4 }}>
                {l as string}
              </div>
            </div>
          ))}
        </div>

        {/* the prize */}
        <section style={{
          padding: 16, borderRadius: 18, textAlign: "center",
          background: "linear-gradient(135deg, rgba(251,191,36,0.18), rgba(120,53,15,0.28))",
          border: "1px solid rgba(251,191,36,0.45)",
        }}>
          <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: T.gold }}>
            PRIZE POOL
          </div>
          <div style={{ fontFamily: T.display, fontSize: 34, color: T.ink, lineHeight: 1.1, marginTop: 2 }}>
            {standings.prizeTotalG.toLocaleString()} G$
          </div>
          <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, fontWeight: 600, marginTop: 4 }}>
            {standings.bounty.amountG.toLocaleString()} G$ guaranteed to the first {standings.bounty.slots} verified players
          </div>
        </section>

        {/* sides */}
        <div style={{ display: "flex", gap: 10 }}>
          {([["RED", TEAM_RED], ["BLUE", TEAM_BLUE]] as const).map(([name, colour]) => (
            <div key={name} style={{
              flex: 1, padding: "14px 10px", borderRadius: 16, textAlign: "center",
              background: `${colour}1f`, border: `1px solid ${colour}66`,
            }}>
              <div style={{
                width: 42, height: 42, margin: "0 auto", borderRadius: 13,
                background: `linear-gradient(160deg, ${colour}, ${colour}77)`,
                border: "2px solid rgba(255,255,255,0.35)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: T.display, fontSize: 19, color: "#fff",
              }}>{name[0]}</div>
              <div style={{ fontFamily: T.display, fontSize: 15, color: T.ink, marginTop: 7 }}>Team {name[0] + name.slice(1).toLowerCase()}</div>
              <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 700, marginTop: 3 }}>
                drawn when you verify
              </div>
            </div>
          ))}
        </div>

        {/* Before the event the rules ARE the pitch — someone deciding whether
            to show up wants the whole thing, so this opens by default here and
            stays collapsed once the event is live. */}
        <TugRules
          prizeTotalG={standings.prizeTotalG}
          bountySlots={standings.bounty.slots}
          bountyAmountG={standings.bounty.amountG}
          dailyPullCap={me?.dailyPullCap ?? 5}
          qualifyGames={me?.gamesToQualify ?? 3}
          defaultOpen
        />

        <div style={{ height: 78 }} />
      </div>

      {/* The pre-event CTA is VERIFY, not "remind me". The bounty is
          first-come and a first-ever face check is a real 30-second scan, so
          anyone who arrives on day one unverified has already lost slots. */}
      <div style={stickyBar}>
        <button style={ctaButton}>
          <span style={{ fontFamily: T.display, fontSize: 17, color: "#fff", textAlign: "left" }}>
            {me?.verified ? "You're verified — you're ready" : "Verify now, be ready on day one"}
          </span>
          <span style={ctaPill}>{me?.verified ? "DONE" : "VERIFY"}</span>
        </button>
      </div>
    </main>
  );
}

function PreviewChip() {
  return (
    <div style={{
      padding: "6px 11px", borderRadius: 9,
      background: "rgba(251,191,36,0.13)", border: "1px solid rgba(251,191,36,0.4)",
      fontSize: 10.5, fontWeight: 800, color: T.gold, fontFamily: T.body,
    }}>
      PREVIEW · sample numbers · add ?state=live or ?state=upcoming to switch
    </div>
  );
}

function startWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long" });
}

const stickyBar: React.CSSProperties = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 2,
  padding: "10px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
  background: "linear-gradient(180deg, rgba(10,2,38,0) 0%, rgba(10,2,38,0.92) 38%)",
};
const ctaButton: React.CSSProperties = {
  width: "100%", maxWidth: 448, margin: "0 auto",
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  padding: "15px 18px", borderRadius: 16, cursor: "pointer", border: "none",
  background: "linear-gradient(180deg, #22c55e, #15803d)",
  boxShadow: "0 12px 26px -8px rgba(34,197,94,0.6), inset 0 1px 0 rgba(255,255,255,0.35)",
};
const ctaPill: React.CSSProperties = {
  fontFamily: T.display, fontSize: 13, color: "#fff", letterSpacing: "0.06em",
  padding: "6px 12px", borderRadius: 999, background: "rgba(0,0,0,0.22)", whiteSpace: "nowrap",
};

// Lets both states be walked through locally before the API exists.
function fixture(): { standings: TugStandings; me: TugMe } {
  if (typeof window === "undefined") return PREVIEW;
  const state = new URLSearchParams(window.location.search).get("state");
  return state === "upcoming" ? PREVIEW_UPCOMING : PREVIEW;
}

function shell(share: number): React.CSSProperties {
  void share;
  return {
    minHeight: "100vh", position: "relative",
    background: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 42%, #0a0226 100%)",
    color: T.ink, fontFamily: T.body,
    padding: "16px 16px 0", maxWidth: 480, margin: "0 auto",
    // The app's global layout makes <body> a flex container, so <main> is a
    // flex ITEM — and a flex item defaults to min-width:auto, meaning it
    // refuses to shrink below its min-content width. A few nowrap stat labels
    // were therefore pushing the whole page to 397px inside a 390px viewport
    // and producing a horizontal scroll. width + minWidth:0 pins it to the
    // viewport and lets the content inside do the shrinking instead.
    width: "100%", minWidth: 0,
  };
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
      <div style={{ fontFamily: T.body, fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", color: T.inkSoft, whiteSpace: "nowrap" }}>
        {label}
      </div>
      <div style={{ fontFamily: T.display, fontSize: 17, color: T.ink, marginTop: 3, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

function actionLabel(a: ReturnType<typeof nextAction>): string {
  switch (a.kind) {
    case "connect": return "Join the rope";
    case "verify": return "Verify — then you start pulling";
    case "reverify_soon": return `Your check expires in ${a.daysLeft}d`;
    case "play": return `${a.gamesLeft} more game${a.gamesLeft === 1 ? "" : "s"} to qualify`;
    case "pull_more": return `${a.pullsLeft} pull${a.pullsLeft === 1 ? "" : "s"} left today`;
    case "bounty_locked": return `Bounty locked at #${a.rank}`;
    case "recruit": return "Done today — bring someone in";
  }
}
function actionCta(a: ReturnType<typeof nextAction>): string {
  switch (a.kind) {
    case "connect": return "SIGN IN";
    case "verify": case "reverify_soon": return "VERIFY";
    case "play": case "pull_more": return "PLAY";
    case "bounty_locked": case "recruit": return "INVITE";
  }
}

// Wordle's grid, adapted. Self-documenting to someone who has never played,
// encodes team identity AND personal standing, and pastes perfectly into
// WhatsApp on any connection.
function shareText(s: TugStandings, me: TugMe | null): string {
  const total = s.red + s.blue;
  const redPct = total > 0 ? Math.round((s.red / total) * 100) : 50;
  const filled = Math.max(1, Math.min(9, Math.round((redPct / 100) * 10)));
  const bar = "🟥".repeat(filled) + "🟦".repeat(10 - filled);
  const mine = me?.team ? `I'm ${me.team.toUpperCase()}.` : "";
  const standing = me?.teamPercentile != null ? ` ${me.pullsTotal} pulls. Top ${me.teamPercentile}%.` : "";
  return [
    `GameArena Tug of War · ${dayOf(s).toLowerCase()}`,
    bar,
    `RED ${redPct}% ── BLUE ${100 - redPct}%`,
    `${mine}${standing}`.trim(),
    `gamearenahq.xyz/tug`,
  ].filter(Boolean).join("\n");
}

function dayOf(s: TugStandings): string {
  const start = new Date(s.startsAt).getTime();
  const now = new Date(s.serverTime).getTime();
  const total = Math.ceil((new Date(s.endsAt).getTime() - start) / 86400000);
  const day = Math.min(total, Math.max(1, Math.floor((now - start) / 86400000) + 1));
  return `DAY ${day} OF ${total}`;
}
function msLeft(endsAt: string, now: string): string {
  const ms = new Date(endsAt).getTime() - new Date(now).getTime();
  if (ms <= 0) return "0h";
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}
