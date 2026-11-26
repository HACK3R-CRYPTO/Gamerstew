"use client";

// The lobby for a friend room: make one or join one, see who is in, start.
// The same sheet for every game; the game supplies its name.
//
// How the room is laid out (2026-11-26), and why:
//   - What the round is played FOR sits at the very top. A player must never
//     find out there is a G$ entry by scrolling past the chat.
//   - The one thing this player has to do next (agree, start, or wait) is a bar
//     fixed to the bottom of the sheet, under the thumb, whatever is scrolled.
//   - Everything else is made small: the code is a chip beside the title, the
//     four seats are a two-by-two grid, and the chat is one folded line on a
//     phone. On a wide screen the chat stands open beside the room instead.
// Sources are in docs/friend-rooms.md.

import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useRoomPermit } from "@/hooks/useRoomPermit";
import { gd, winnerGain, type RoomView } from "@/hooks/useFriendRoom";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import type { FriendRoom } from "@/hooks/useFriendRoom";
import InviteFriends from "@/components/InviteFriends";
import AddSeat from "@/components/AddSeat";
import RoomChat from "@/components/RoomChat";
import { friendLabel, useFriends } from "@/hooks/useFriends";

const NAME_KEY = "gamearena:roomName";
const DISPLAY = '"Melon Pop", "Fredoka", ui-sans-serif, system-ui, sans-serif';

export default function FriendsSheet({ room, gameName, sharePath, initialCode, onClose }: { room: FriendRoom; gameName: string; sharePath: string; initialCode?: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode ?? "");
  const [copied, setCopied] = useState(false);
  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) || ""); } catch { /* private window */ } }, []);
  const keep = (v: string) => { setName(v); try { localStorage.setItem(NAME_KEY, v); } catch { /* ignore */ } };
  // A signed-in player already has a GameArena username: use it, and do not ask.
  const { address } = useAccount();
  const { data: chainName } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`, abi: GAME_PASS_ABI, functionName: "getUsername",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const username = typeof chainName === "string" && chainName.trim() ? chainName.trim() : "";
  const who = username || name.trim() || "Player";
  const v = room.view;
  const link = typeof window !== "undefined" && room.session ? `${window.location.origin}${sharePath}?room=${room.session.code}` : "";
  const invite = `Join my ${gameName} room on GameArena. Code ${room.session?.code ?? ""}\n${link}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ } };
  const active = v ? v.players.filter((p) => !p.away).length : 0;

  const friends = useFriends(); const online = friends.friends.filter((p) => p.online);
  const stake = useStake(room, v);
  const st = v?.stake; const duo = !!v && v.players.length > 1;
  const waitingOnStake = !!st && st.state !== "ready";
  return (
    <div className="fs-wrap" role="dialog" aria-modal="true" aria-label="Play with friends">
      <div className={`fs${room.inRoom ? " room" : ""}${duo ? " duo" : ""}`}>
        <div className="fs-top">
          <div>
            <div className="fs-kicker">{gameName.toUpperCase()}</div>
            <h2 style={{ fontFamily: DISPLAY }}>{room.inRoom ? "Your room" : "Play with friends"}</h2>
          </div>
          {room.inRoom && <button className="fs-codechip" onClick={copy} aria-label={`Room code ${room.session!.code}. Tap to copy the link.`}><small>{copied ? "LINK COPIED" : "CODE"}</small><b>{room.session!.code}</b></button>}
          <button className="fs-x" onClick={() => { if (room.inRoom) room.leave(); onClose(); }} aria-label="Close">✕</button>
        </div>
        <div className="fs-body">

        {!room.inRoom ? (
          <>
            <p className="fs-sub">Everyone plays the same round at the same time. Highest score wins.</p>
            {username ? (
              <div className="fs-as">Playing as <b>@{username}</b></div>
            ) : (
              <label className="fs-label">Your name
                <input value={name} onChange={(e) => keep(e.target.value.slice(0, 16))} placeholder="Player" maxLength={16} autoComplete="nickname" />
              </label>
            )}
            {/* friends who have the app open right now: one tap opens a room and invites them */}
            {online.length > 0 && (
              <div className="fs-on">
                <div className="fs-on-h"><i /> {online.length} {online.length === 1 ? "friend is" : "friends are"} online</div>
                <div className="fs-on-row">{online.slice(0, 6).map((p) => <button key={p.wallet} disabled={room.busy} onClick={() => { try { window.sessionStorage.setItem("ga_invite_next", p.wallet); } catch { /* they can still be invited from the room */ } void room.create(who); }}><b>{(p.name ?? p.wallet.slice(2)).slice(0, 1).toUpperCase()}</b>{friendLabel(p)}<em>Invite</em></button>)}</div>
              </div>
            )}
            {friends.state === "ready" && friends.friends.length > 0 && online.length === 0 && <div className="fs-off">None of your {friends.friends.length} friends are online right now. Open a room and send the link.</div>}
            <button className="fs-primary" style={{ fontFamily: DISPLAY }} disabled={room.busy} onClick={() => room.create(who)}>Open a room</button>
            <div className="fs-or">or join one</div>
            <div className="fs-join">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))} placeholder="CODE" maxLength={5} inputMode="text" autoCapitalize="characters" aria-label="Room code" />
              <button disabled={room.busy || code.length !== 5} onClick={() => room.join(code, who)}>Join</button>
            </div>
          </>
        ) : (
          <>
            {/* what this round is played for, before anything else */}
            {st && v && (
              <div className="fs-for" role="status">
                <em>Playing for G$</em>
                <b>{gd(st.entryWei)} G$ each · <u>winner gets {winnerGain(st.entryWei, st.feeBps, active)} G$</u></b>
                <p>Nothing is taken now. The others pay the winner when the round ends, and a tie moves nothing. {st.feeBps / 100}% of each entry is the fee.</p>
                {room.isHost && <button className="fs-link" disabled={stake.working || room.busy} onClick={() => void room.clearEntry()}>Play for free instead</button>}
              </div>
            )}
            <div className="fs-cols">
            <div className="fs-main">
            <div className="fs-share">
              <a href={`https://wa.me/?text=${encodeURIComponent(invite)}`} target="_blank" rel="noreferrer">WhatsApp</a>
              <button onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
              {/* a link for people who only want to look on */}
              <button onClick={() => { const w = `${window.location.origin}/watch/${v?.watchId || room.session?.code || ""}`; if (navigator.share) void navigator.share({ title: `Watch our ${gameName} room`, text: `Watch our ${gameName} round live on GameArena`, url: w }).catch(() => {}); else void navigator.clipboard?.writeText(w); }}>Watch link</button>
            </div>
            {v?.status === "waiting" && <InviteFriends game={room.session!.game} code={room.session!.code} />}
            <ul className="fs-players" aria-label="Players in this room">
              {(v?.players ?? []).map((p, i) => {
                const state = p.away ? "away" : st ? (st.signed[i] ? "agreed" : "not yet") : p.host ? "host" : "ready";
                return (
                  <li key={i} className={`${p.away ? "away" : ""}${i === v!.you ? " me" : ""}`}>
                    <span className="fs-face" aria-hidden>{(p.name || "P").slice(0, 1).toUpperCase()}</span>
                    <span className="fs-who"><b>{p.name}</b><i className={st && !st.signed[i] && !p.away ? "wait" : ""}>{state}{i === v!.you ? " · you" : ""}</i></span>
                    {i !== v!.you && <AddSeat f={friends} wallet={p.wallet} />}
                  </li>
                );
              })}
              {Array.from({ length: Math.max(0, 4 - (v?.players.length ?? 1)) }, (_, i) => <li key={`e${i}`} className="empty"><span className="fs-face" aria-hidden>+</span><span className="fs-who"><b>Open seat</b></span></li>)}
            </ul>
            {/* the host may put an entry on the round; shown where they are looking, not under the chat */}
            {v?.stakes && v.stakeTerms && !st && room.isHost && (
              <div className="fs-stake">
                <em>Play for G$ · optional</em>
                <div className="fs-chips">
                  <button className="on" disabled>Free</button>
                  {v.stakeTerms.entries.map((e) => <button key={e} disabled={!stake.canSign || stake.working || room.busy} onClick={() => void stake.agree(e, true)}>{gd(e)} G$</button>)}
                </div>
                <p>{stake.canSign ? "Pick an entry and everyone agrees to it. Nothing leaves a wallet unless its owner loses the round." : "Sign in to play for G$."}</p>
              </div>
            )}
            </div>
            {duo && v && <div className="fs-side"><RoomChat lines={v.chat ?? []} you={v.you} send={room.chat} fold /></div>}
            </div>
          </>
        )}
        </div>

        {/* the one next step, always in view */}
        {room.inRoom && (
          <div className="fs-foot">
            {room.error && <div className="fs-err" role="alert">{room.error}</div>}
            {st && !stake.mine ? (
              stake.canSign
                ? <button className="fs-primary agree" style={{ fontFamily: DISPLAY }} disabled={stake.working || room.busy} onClick={() => void stake.agree(st.entryWei, false)}>{stake.working ? "Check your wallet…" : `Agree to ${gd(st.entryWei)} G$`}</button>
                : <div className="fs-wait"><b>Sign in to agree</b>, or ask the host to play for free.</div>
            ) : room.isHost ? (
              <button className="fs-primary" style={{ fontFamily: DISPLAY }} disabled={room.busy || active < 2 || waitingOnStake} onClick={() => room.start()}>{active < 2 ? "Waiting for a friend" : waitingOnStake ? "Waiting for everyone to agree" : `Start for ${active}`}</button>
            ) : (
              <div className="fs-wait">{waitingOnStake ? "You agreed. Waiting for the others…" : "Waiting for the host to start…"}</div>
            )}
          </div>
        )}
        {!room.inRoom && room.error && <div className="fs-foot"><div className="fs-err" role="alert">{room.error}</div></div>}
      </div>
      <style>{`
        .fs-wrap { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; background: rgba(34,16,79,0.42); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fsFade .2s ease both; }
        .fs { position: relative; box-sizing: border-box; width: 100%; max-width: 440px; max-height: 94dvh; overflow: hidden; border-radius: 28px 28px 0 0; background: #fff; color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 -20px 50px -20px rgba(34,16,79,0.6); display: flex; flex-direction: column; animation: fsUp .28s cubic-bezier(.2,.9,.3,1.1) both; }
        .fs-top { flex: none; display: flex; align-items: center; gap: 10px; padding: 16px 16px 10px 18px; }
        .fs-top > div { flex: 1; min-width: 0; }
        .fs-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 18px 16px; display: flex; flex-direction: column; gap: 12px; }
        .fs:not(.room) .fs-body { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 20px); }
        .fs-foot { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 18px calc(env(safe-area-inset-bottom, 0px) + 14px); background: #fff; border-top: 1px solid rgba(76,29,149,0.1); box-shadow: 0 -10px 24px -14px rgba(34,16,79,0.28); }
        .fs-cols, .fs-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .fs-side { min-width: 0; }
        @media (min-width: 620px) { .fs-wrap { align-items: center; padding: 20px; } .fs { border-radius: 28px; max-height: min(94dvh, 760px); } .fs-foot { padding-bottom: 16px; } }
        /* a wide screen with someone to talk to: the chat stands beside the room */
        @media (min-width: 860px) { .fs.room.duo { max-width: 840px; } .fs.room.duo .fs-cols { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr); gap: 16px; align-items: start; } .fs.room.duo .fs-foot { align-items: center; } .fs.room.duo .fs-foot > * { width: 100%; max-width: 420px; } }
        @keyframes fsFade { from { opacity: 0; } } @keyframes fsUp { from { transform: translateY(30px); opacity: 0; } }
        .fs button, .fs input, .fs a { font: inherit; }
        .fs-x { flex: none; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(76,29,149,0.16); background: #fff; color: #22104f; cursor: pointer; }
        .fs-kicker { font-size: 10.5px; font-weight: 900; letter-spacing: 0.2em; color: #6d28d9; }
        .fs h2 { margin: 1px 0 0; font-size: 26px; line-height: 1.05; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fs-codechip { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 44px; padding: 4px 12px; border-radius: 14px; border: 1.5px dashed rgba(109,40,217,0.45); background: #f6f1ff; color: #4c1d95; cursor: pointer; }
        .fs-codechip small { font-size: 9px; font-weight: 900; letter-spacing: 0.14em; color: #6d28d9; }
        .fs-codechip b { font-size: 19px; font-weight: 900; letter-spacing: 0.16em; line-height: 1.1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .fs-for { display: flex; flex-direction: column; gap: 5px; padding: 13px 15px; border-radius: 18px; background: linear-gradient(180deg, #fff8dc, #ffefb0); box-shadow: 0 0 0 1.5px #f0c23b, 0 6px 16px -10px rgba(180,120,0,0.6); text-align: left; }
        .fs-for em { font-style: normal; font-size: 10.5px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #92590a; }
        .fs-for b { font-size: 18px; font-weight: 800; line-height: 1.25; color: #22104f; } .fs-for b u { text-decoration: none; color: #166534; white-space: nowrap; }
        .fs-for p { margin: 0; font-size: 13px; line-height: 1.4; color: rgba(34,16,79,0.78); }
        .fs-sub { margin: -4px 0 2px; font-size: 14px; line-height: 1.45; color: rgba(34,16,79,0.66); }
        .fs-as { padding: 12px 14px; border-radius: 14px; background: #f1e9ff; font-size: 14.5px; font-weight: 600; color: rgba(34,16,79,0.7); } .fs-as b { color: #4c1d95; }
        .fs-label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 800; color: rgba(34,16,79,0.6); }
        .fs input { box-sizing: border-box; width: 100%; min-width: 0; padding: 13px 14px; border-radius: 14px; border: 1.5px solid rgba(76,29,149,0.2); background: #faf7ff; color: #22104f; font-size: 16px; font-weight: 700; outline: none; }
        .fs input:focus { border-color: #6d28d9; }
        .fs-primary { width: 100%; padding: 15px 0; border: none; border-radius: 18px; font-size: 19px; color: #fff !important; background: #6d28d9; box-shadow: 0 5px 0 #4c1d95; cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, opacity .2s ease; }
        .fs-primary:active { transform: translateY(3px); box-shadow: 0 2px 0 #4c1d95; }
        .fs-primary:disabled { opacity: 0.55; cursor: default; }
        .fs-or { text-align: center; font-size: 12px; font-weight: 700; color: rgba(34,16,79,0.5); }
        .fs-join { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
        .fs-join input { text-align: center; letter-spacing: 0.3em; font-size: 20px; text-transform: uppercase; }
        @media (max-width: 380px) { .fs-join input { letter-spacing: 0.18em; font-size: 18px; } .fs-join button { padding: 0 16px; } }
        .fs-join button { padding: 0 22px; border-radius: 14px; border: 1.5px solid #6d28d9; background: #fff; color: #6d28d9 !important; font-weight: 900; cursor: pointer; }
        .fs-join button:disabled { opacity: 0.4; cursor: default; }
        .fs-on { display: grid; gap: 8px; padding: 12px; border-radius: 16px; background: #f0fdf4; box-shadow: 0 0 0 1px rgba(22,163,74,0.3); }
        .fs-on-h { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 800; color: #166534; } .fs-on-h i { width: 9px; height: 9px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,0.22); }
        .fs-on-row { display: grid; gap: 6px; } .fs-on-row button { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 8px 0 8px; border-radius: 13px; border: none; background: #fff; color: #22104f; font-weight: 800; font-size: 14.5px; cursor: pointer; text-align: left; box-shadow: 0 0 0 1px rgba(22,163,74,0.25); }
        .fs-on-row button b { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #6d28d9; color: #fff; font-size: 13px; flex: 0 0 auto; } .fs-on-row button em { margin-left: auto; font-style: normal; padding: 7px 13px; border-radius: 10px; background: #16a34a; color: #fff; font-size: 13px; }
        .fs-off { font-size: 13px; font-weight: 600; color: rgba(34,16,79,0.62); text-align: center; }
        .fs-share { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        .fs-share a, .fs-share button { padding: 11px 0; border-radius: 13px; text-align: center; text-decoration: none; font-size: 14px; font-weight: 800; cursor: pointer; }
        .fs-share a { background: #16a34a; color: #fff !important; border: none; }
        .fs-share button { background: #fff; color: #22104f; border: 1px solid rgba(76,29,149,0.2); }
        .fs-players { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .fs-players li { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 9px; min-width: 0; min-height: 56px; padding: 8px 10px; border-radius: 15px; background: #faf7ff; border: 1px solid rgba(76,29,149,0.12); }
        .fs-players li.me { background: #f1e9ff; border-color: rgba(109,40,217,0.35); }
        .fs-face { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: #6d28d9; color: #fff; font-size: 15px; font-weight: 800; }
        .fs-who { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
        .fs-who b { font-size: 14.5px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fs-players li i { font-style: normal; font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #15803d; }
        .fs-players li i.wait { color: #b45309; }
        .fs-players li .as-pill { margin-left: 0; }
        .fs-stake { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 16px; background: #fff; border: 1px solid rgba(76,29,149,0.16); text-align: left; }
        .fs-stake > em { font-style: normal; font-size: 10.5px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #6d28d9; }
        .fs-stake > b { font-size: 16px; font-weight: 800; } .fs-stake > b u { text-decoration: none; color: #166534; }
        .fs-stake p { margin: 0; font-size: 12.5px; line-height: 1.4; color: rgba(34,16,79,0.7); }
        .fs-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .fs-chips button { flex: 1; min-width: 62px; padding: 9px 0; border-radius: 12px; border: 1px solid rgba(76,29,149,0.18); background: #faf7ff; font: inherit; font-size: 13.5px; font-weight: 800; color: #22104f; cursor: pointer; }
        .fs-chips button.on { background: #22104f; border-color: #22104f; color: #fff; } .fs-chips button:disabled { opacity: 0.5; cursor: default; }
        .fs-link { align-self: flex-start; min-height: 40px; padding: 0; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: #6d28d9 !important; cursor: pointer; }
        .fs-players li.away { opacity: 0.5; } .fs-players li.away i { color: rgba(34,16,79,0.6); }
        .fs-players li.empty { background: transparent; border-style: dashed; color: rgba(34,16,79,0.45); } .fs-players li.empty .fs-face { background: transparent; border: 1.5px dashed rgba(76,29,149,0.3); color: rgba(34,16,79,0.4); } .fs-players li.empty b { font-weight: 600; }
        .fs-wait { text-align: center; padding: 13px 0; font-size: 14.5px; font-weight: 700; color: rgba(34,16,79,0.66); } .fs-wait b { color: #22104f; }
        .fs-primary.agree { background: #15803d; box-shadow: 0 5px 0 #14532d; } .fs-primary.agree:active { box-shadow: 0 2px 0 #14532d; }
        .fs-err { text-align: center; font-size: 13px; font-weight: 700; color: #be123c; }
        @media (prefers-reduced-motion: reduce) { .fs-wrap, .fs { animation: none; } }
      `}</style>
    </div>
  );
}

// Playing the round for G$. The host picks an entry; everyone agrees by signing.
// A signature is not a payment: nothing leaves a wallet unless its owner loses.
// One place for it, because three parts of the room need it: the banner at the
// top, the host's picker, and the bar at the bottom.
function useStake(room: FriendRoom, view: RoomView | null | undefined) {
  const { sign, canSign } = useRoomPermit();
  const [working, setWorking] = useState(false);
  const terms = view?.stakeTerms; const st = view?.stake; const mine = !!view && !!st?.signed[view.you];
  const agree = async (entryWei: string, asHost: boolean) => {
    if (working || !terms) return;
    setWorking(true); room.say(null);
    const permit = await sign(terms.spender, entryWei);
    if ("error" in permit) room.say(permit.error);
    else if (asHost) await room.setEntry(entryWei, permit);
    else await room.agreeEntry(permit);
    setWorking(false);
  };
  return { agree, working, canSign, mine };
}
