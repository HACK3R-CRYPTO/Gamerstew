"use client";

// Everything a game screen shows for a friend room, in one component:
//   · the "Play with friends" button on the start screen
//   · the lobby sheet (also when the host calls a rematch)
//   · a small strip of who is in the round and how far they have got
//   · the room's standings once this player has finished
// The game keeps only the room hook and three calls: start its run when the
// room's round starts, report progress, and send the finished run.

import { gd, type FriendRoom, type RoomView } from "@/hooks/useFriendRoom";
import FriendsSheet from "@/components/FriendsSheet";
import AddSeat from "@/components/AddSeat";
import RoomChat from "@/components/RoomChat";
import { useFriends } from "@/hooks/useFriends";

const DISPLAY = '"Melon Pop", "Fredoka", ui-sans-serif, system-ui, sans-serif';

export default function FriendsPlay({ room, gameName, sharePath, atStart, progressMax, progressWord = "round", dark = false, part = "all", strip = true }: {
  room: FriendRoom; gameName: string; sharePath: string;
  /** true while the game is on its start screen */
  atStart: boolean;
  /** how many pips the strip shows; omit for a plain number */
  progressMax?: number;
  /** what one unit of progress is called, for "round 4" */
  progressWord?: string;
  /** game screens that are dark need a light button */
  dark?: boolean;
  /** Big game pages draw their start screen in one place and the rest in another.
   *  They mount this twice: "button" on the start screen, "overlays" at the page root. */
  part?: "all" | "button" | "overlays";
  /** false for a game that already draws every player on its own screen (Street Strike shows each card) */
  strip?: boolean;
}) {
  const v = room.view;
  const open = room.sheetOpen, code = room.inviteCode;
  const friends = useFriends(); // who in this room is already a friend, and who can be added
  const me = v && v.you >= 0 ? v.players[v.you] : null;
  const lobby = room.inRoom && v?.status === "waiting";
  const playing = room.inRoom && v?.status === "playing" && me && !me.done;
  const standings = room.inRoom && v && v.status !== "waiting" && me && (me.done || v.status === "over");

  return (
    <>
      {part !== "overlays" && atStart && !room.inRoom && (
        <button className={`fp-btn${dark ? " dark" : ""}`} onClick={room.openSheet}>
          <b>Play with friends</b><span>Same round, same time. Up to 4.</span>
        </button>
      )}
      {((part !== "overlays" && open && atStart && !room.inRoom) || (part !== "button" && lobby)) && <FriendsSheet room={room} gameName={gameName} sharePath={sharePath} initialCode={code} onClose={room.closeSheet} />}

      {part !== "button" && strip && playing && v && (
        <div className="fp-strip" aria-label="Players in this room">
          {v.players.map((p, i) => (
            <span key={i} className={`${i === v.you ? "me" : ""}${p.away ? " away" : ""}${p.done ? " done" : ""}`}>
              <b>{p.name}</b>
              {progressMax ? <em>{Array.from({ length: progressMax }, (_, k) => <i key={k} className={k < p.progress ? "on" : ""} />)}</em> : <u>{p.done ? "done" : `${progressWord} ${p.progress + 1}`}</u>}
            </span>
          ))}
        </div>
      )}

      {part !== "button" && standings && v && (
        <div className="fp-over" role="dialog" aria-label="Room standings">
          <div className="fp-card">
            <div className="fp-kicker">ROOM {v.code} · {v.status === "over" ? "FINAL" : "STILL PLAYING"}</div>
            <ol>
              {v.players.map((p, i) => ({ p, i })).sort((a, b) => (b.p.score ?? -1) - (a.p.score ?? -1)).map(({ p, i }, rank) => (
                <li key={i} className={`${i === v.you ? "me" : ""}${v.status === "over" && rank === 0 && p.score != null ? " win" : ""}`}>
                  <span>{p.score != null ? rank + 1 : "·"}</span>
                  <b>{p.name}{i === v.you ? " (you)" : ""}{i !== v.you && <AddSeat f={friends} wallet={p.wallet} />}</b>
                  <i>{p.score != null ? p.score : p.away ? "left" : `${progressWord} ${p.progress + 1}`}{p.chain?.state === "recorded" && p.chain.tx ? <a className="fp-tick" href={`https://celoscan.io/tx/${p.chain.tx}`} target="_blank" rel="noreferrer" aria-label="See this score on the chain" title="On-chain">✓</a> : null}</i>
                </li>
              ))}
            </ol>
            {(() => { const c = v.you >= 0 ? v.players[v.you]?.chain : undefined; if (!c) return null; return (
              <div className={`fp-chain ${c.state}`} role="status">
                {c.state === "sending" ? "Saving your score on-chain…" : c.state === "recorded" ? <>Your score is on-chain. {c.tx && <a href={`https://celoscan.io/tx/${c.tx}`} target="_blank" rel="noreferrer">View</a>}</> : "Your score did not reach the chain this time. It still counts in this room."}
              </div>
            ); })()}
            {v.stake && v.status === "over" && <StakeResult view={v} />}
            <RoomChat lines={v.chat ?? []} you={v.you} send={room.chat} />
            {(v.watching ?? 0) > 0 && <div className="fp-note">👁 {v.watching} watching</div>}
            {room.error && <div className="fp-err">{room.error}</div>}
            {v.status === "over"
              ? (room.isHost ? <button className="fp-go" style={{ fontFamily: DISPLAY }} disabled={room.busy} onClick={() => room.rematch()}>Play again</button> : <div className="fp-note">Waiting for the host to start another round…</div>)
              : <div className="fp-note">Scores appear as each friend finishes.</div>}
            <button className="fp-leave" onClick={() => room.leave()}>Leave room</button>
          </div>
        </div>
      )}

      <style>{`
        .fp-btn { width: min(340px, 88vw); display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border-radius: 16px; cursor: pointer; text-align: left; background: #fff; border: 1.5px solid rgba(109,40,217,0.45); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .fp-btn b { font-size: 15px; color: #6d28d9; } .fp-btn span { font-size: 12.5px; font-weight: 600; color: rgba(34,16,79,0.62); }
        .fp-btn.dark { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.3); } .fp-btn.dark b { color: #fff; } .fp-btn.dark span { color: rgba(255,255,255,0.72); }
        .fp-strip { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 8px); left: 50%; transform: translateX(-50%); z-index: 70; display: flex; gap: 5px; max-width: 96vw; pointer-events: none; font-family: ui-sans-serif, system-ui, sans-serif; }
        .fp-strip span { display: flex; flex-direction: column; gap: 3px; min-width: 62px; max-width: 96px; padding: 5px 8px; border-radius: 11px; background: rgba(255,255,255,0.94); border: 1.5px solid rgba(76,29,149,0.18); box-shadow: 0 6px 16px -8px rgba(0,0,0,0.5); color: #22104f; }
        .fp-money { margin: 2px 0 4px; padding: 10px 12px; border-radius: 14px; background: #f0fdf4; border: 1px solid rgba(22,163,74,0.4); font-size: 13.5px; line-height: 1.45; color: #14532d; text-align: left; } .fp-money.none { background: #faf7ff; border-color: rgba(76,29,149,0.16); color: rgba(34,16,79,0.75); } .fp-money b { font-weight: 800; }
        .fp-strip span.me { border-color: #6d28d9; } .fp-strip span.away { opacity: 0.5; } .fp-strip span.done { background: #ecfdf3; border-color: #16a34a; }
        .fp-strip b { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .fp-strip u { text-decoration: none; font-size: 10.5px; font-weight: 700; color: rgba(34,16,79,0.62); }
        .fp-strip em { display: flex; gap: 2px; } .fp-strip em i { flex: 1; height: 4px; border-radius: 2px; background: rgba(76,29,149,0.16); } .fp-strip em i.on { background: #16a34a; }
        .fp-over { position: fixed; inset: 0; z-index: 75; display: flex; align-items: flex-end; justify-content: center; background: rgba(34,16,79,0.5); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fpFade .2s ease both; }
        @media (min-width: 620px) { .fp-over { align-items: center; } .fp-card { border-radius: 26px !important; } }
        .fp-card { width: 100%; max-width: 440px; padding: 20px 18px calc(env(safe-area-inset-bottom, 0px) + 18px); border-radius: 26px 26px 0 0; background: #fff; color: #22104f; display: flex; flex-direction: column; gap: 10px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; animation: fpUp .28s cubic-bezier(.2,.9,.3,1.1) both; }
        @keyframes fpFade { from { opacity: 0; } } @keyframes fpUp { from { transform: translateY(30px); opacity: 0; } }
        .fp-kicker { font-size: 11px; font-weight: 900; letter-spacing: 0.18em; color: #6d28d9; text-align: center; }
        .fp-card ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .fp-card li { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 12px 14px; border-radius: 15px; background: #faf7ff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12); font-size: 15px; }
        .fp-card li.me { box-shadow: 0 0 0 2px #6d28d9; } .fp-card li.win { background: #fffbeb; box-shadow: 0 0 0 2px #f59e0b; }
        .fp-card li span { font-weight: 900; color: rgba(34,16,79,0.55); } .fp-card li b { font-weight: 800; } .fp-card li i { font-style: normal; font-weight: 900; color: #6d28d9; }
        .fp-go { padding: 15px 0; border: none; border-radius: 18px; font-size: 19px; color: #fff; background: #6d28d9; box-shadow: 0 5px 0 #4c1d95; cursor: pointer; } .fp-go:disabled { opacity: 0.6; }
        .fp-note { text-align: center; font-size: 13.5px; font-weight: 700; color: rgba(34,16,79,0.62); padding: 4px 0; }
        .fp-leave { align-self: center; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 700; color: rgba(34,16,79,0.6); text-decoration: underline; text-underline-offset: 3px; padding: 4px 10px; }
        .fp-err { text-align: center; font-size: 13px; font-weight: 700; color: #be123c; }
        .fp-tick { margin-left: 6px; color: #15803d; font-style: normal; font-weight: 900; text-decoration: none; }
        .fp-chain { text-align: center; font-size: 13px; font-weight: 700; color: rgba(34,16,79,0.72); background: #f3effc; border-radius: 12px; padding: 9px 12px; }
        .fp-chain.recorded { color: #166534; background: #dcfce7; } .fp-chain.recorded a { color: #166534; }
        .fp-chain.failed { color: #9a3412; background: #ffedd5; }
        @media (prefers-reduced-motion: reduce) { .fp-over, .fp-card { animation: none; } }
      `}</style>
    </>
  );
}

// What happened to the G$ once a staked round ended, in one or two plain lines.
function StakeResult({ view }: { view: RoomView }) {
  const st = view.stake!;
  if (st.state === "void") return <div className="fp-money none"><b>No G$ moved.</b> There was no single winner, so nobody pays.</div>;
  if (st.state !== "settled") return <div className="fp-money none">Sending the winner their G$…</div>;
  const each = Math.floor(gd(st.entryWei) * (1 - st.feeBps / 10000));
  const paid = st.pays.filter((x) => x === "paid").length; const missed = view.players.filter((_, i) => st.pays[i] === "unpaid" || st.pays[i] === "expired").map((p) => p.name);
  const winner = view.players[st.winnerSeat]?.name ?? "The winner"; const me = view.you;
  const mine = st.pays[me];
  return (
    <div className="fp-money">
      <b>{me === st.winnerSeat ? `You received ${each * paid} G$.` : `${winner} received ${each * paid} G$.`}</b>
      {mine === "paid" && <> Your {gd(st.entryWei)} G$ entry went to {winner}.</>}
      {(mine === "unpaid" || mine === "expired") && <> Your entry could not be sent.</>}
      {missed.length > 0 && me === st.winnerSeat && <> {missed.join(", ")} did not pay.</>}
    </div>
  );
}
