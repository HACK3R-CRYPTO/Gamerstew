"use client";

// The lobby for a friend room: make one or join one, see who is in, start.
// The same sheet for every game; the game supplies its name.

import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useRoomPermit } from "@/hooks/useRoomPermit";
import { gd, winnerGain, type RoomView } from "@/hooks/useFriendRoom";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI } from "@/lib/contracts";
import type { FriendRoom } from "@/hooks/useFriendRoom";

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

  return (
    <div className="fs-wrap" role="dialog" aria-modal="true" aria-label="Play with friends">
      <div className="fs">
        <button className="fs-x" onClick={() => { if (room.inRoom) room.leave(); onClose(); }} aria-label="Close">✕</button>
        <div className="fs-kicker">{gameName.toUpperCase()}</div>
        <h2 style={{ fontFamily: DISPLAY }}>{room.inRoom ? "Your room" : "Play with friends"}</h2>

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
            <button className="fs-primary" style={{ fontFamily: DISPLAY }} disabled={room.busy} onClick={() => room.create(who)}>Open a room</button>
            <div className="fs-or">or join one</div>
            <div className="fs-join">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))} placeholder="CODE" maxLength={5} inputMode="text" autoCapitalize="characters" aria-label="Room code" />
              <button disabled={room.busy || code.length !== 5} onClick={() => room.join(code, who)}>Join</button>
            </div>
          </>
        ) : (
          <>
            <div className="fs-code" aria-label={`Room code ${room.session!.code}`}>{room.session!.code.split("").map((c, i) => <b key={i}>{c}</b>)}</div>
            <div className="fs-share">
              <a href={`https://wa.me/?text=${encodeURIComponent(invite)}`} target="_blank" rel="noreferrer">WhatsApp</a>
              <button onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
              {/* a link for people who only want to look on */}
              <button onClick={() => { const w = `${window.location.origin}/watch/${room.session?.code ?? ""}`; if (navigator.share) void navigator.share({ title: `Watch our ${gameName} room`, text: `Watch our ${gameName} round live on GameArena`, url: w }).catch(() => {}); else void navigator.clipboard?.writeText(w); }}>Watch link</button>
            </div>
            <ul className="fs-players">
              {(v?.players ?? []).map((p, i) => (
                <li key={i} className={p.away ? "away" : ""}><span>{p.name}{i === v!.you ? " (you)" : ""}</span><i className={v!.stake && !v!.stake.signed[i] ? "wait" : ""}>{p.away ? "away" : v!.stake ? (v!.stake.signed[i] ? "agreed" : "not yet") : p.host ? "host" : "ready"}</i></li>
              ))}
              {Array.from({ length: Math.max(0, 4 - (v?.players.length ?? 1)) }, (_, i) => <li key={`e${i}`} className="empty"><span>Waiting for a friend…</span></li>)}
            </ul>
            {v?.stakes && v.stakeTerms && <StakeBox room={room} view={v} active={active} />}
            {room.isHost
              ? <button className="fs-primary" style={{ fontFamily: DISPLAY }} disabled={room.busy || active < 2 || (!!v?.stake && v.stake.state !== "ready")} onClick={() => room.start()}>{active < 2 ? "Waiting for a friend" : v?.stake && v.stake.state !== "ready" ? "Waiting for everyone to agree" : `Start for ${active}`}</button>
              : <div className="fs-wait">{v?.stake && v.stake.state !== "ready" ? "Waiting for everyone to agree…" : "Waiting for the host to start…"}</div>}
          </>
        )}
        {room.error && <div className="fs-err" role="alert">{room.error}</div>}
      </div>
      <style>{`
        .fs-wrap { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; background: rgba(34,16,79,0.42); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: fsFade .2s ease both; }
        .fs { position: relative; width: 100%; max-width: 440px; padding: 20px 18px calc(env(safe-area-inset-bottom, 0px) + 20px); border-radius: 28px 28px 0 0; background: #fff; color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 -20px 50px -20px rgba(34,16,79,0.6); display: flex; flex-direction: column; gap: 12px; animation: fsUp .28s cubic-bezier(.2,.9,.3,1.1) both; }
        @media (min-width: 620px) { .fs-wrap { align-items: center; } .fs { border-radius: 28px; } }
        @keyframes fsFade { from { opacity: 0; } } @keyframes fsUp { from { transform: translateY(30px); opacity: 0; } }
        .fs button, .fs input, .fs a { font: inherit; }
        .fs-x { position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(76,29,149,0.16); background: #fff; color: #22104f; cursor: pointer; }
        .fs-kicker { font-size: 10.5px; font-weight: 900; letter-spacing: 0.2em; color: #6d28d9; }
        .fs h2 { margin: -6px 0 0; font-size: 28px; font-weight: 400; }
        .fs-sub { margin: -4px 0 2px; font-size: 14px; line-height: 1.45; color: rgba(34,16,79,0.66); }
        .fs-as { padding: 12px 14px; border-radius: 14px; background: #f1e9ff; font-size: 14.5px; font-weight: 600; color: rgba(34,16,79,0.7); } .fs-as b { color: #4c1d95; }
        .fs-label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 800; color: rgba(34,16,79,0.6); }
        .fs input { padding: 13px 14px; border-radius: 14px; border: 1.5px solid rgba(76,29,149,0.2); background: #faf7ff; color: #22104f; font-size: 16px; font-weight: 700; outline: none; }
        .fs input:focus { border-color: #6d28d9; }
        .fs-primary { padding: 15px 0; border: none; border-radius: 18px; font-size: 19px; color: #fff !important; background: #6d28d9; box-shadow: 0 5px 0 #4c1d95; cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, opacity .2s ease; }
        .fs-primary:active { transform: translateY(3px); box-shadow: 0 2px 0 #4c1d95; }
        .fs-primary:disabled { opacity: 0.55; cursor: default; }
        .fs-or { text-align: center; font-size: 12px; font-weight: 700; color: rgba(34,16,79,0.5); }
        .fs-join { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .fs-join input { text-align: center; letter-spacing: 0.4em; font-size: 20px; text-transform: uppercase; }
        .fs-join button { padding: 0 22px; border-radius: 14px; border: 1.5px solid #6d28d9; background: #fff; color: #6d28d9 !important; font-weight: 900; cursor: pointer; }
        .fs-join button:disabled { opacity: 0.4; cursor: default; }
        .fs-code { display: flex; justify-content: center; gap: 7px; }
        .fs-code b { width: 46px; height: 54px; display: grid; place-items: center; border-radius: 13px; background: #f1e9ff; font-size: 26px; font-weight: 900; color: #4c1d95; animation: fsUp .3s ease both; }
        .fs-code b:nth-child(2) { animation-delay: .04s; } .fs-code b:nth-child(3) { animation-delay: .08s; } .fs-code b:nth-child(4) { animation-delay: .12s; } .fs-code b:nth-child(5) { animation-delay: .16s; }
        .fs-share { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .fs-share a, .fs-share button { padding: 11px 0; border-radius: 13px; text-align: center; text-decoration: none; font-size: 14px; font-weight: 800; cursor: pointer; }
        .fs-share a { background: #16a34a; color: #fff !important; border: none; }
        .fs-share button { background: #fff; color: #22104f; border: 1px solid rgba(76,29,149,0.2); }
        .fs-players { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .fs-players li { display: flex; justify-content: space-between; align-items: center; padding: 11px 14px; border-radius: 13px; background: #faf7ff; border: 1px solid rgba(76,29,149,0.12); font-size: 14.5px; font-weight: 800; }
        .fs-players li i { font-style: normal; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #15803d; }
        .fs-players li i.wait { color: #b45309; }
        .fs-stake { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 16px; background: #fff; border: 1px solid rgba(76,29,149,0.16); text-align: left; }
        .fs-stake > em { font-style: normal; font-size: 10.5px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #6d28d9; }
        .fs-stake > b { font-size: 16px; font-weight: 800; } .fs-stake > b u { text-decoration: none; color: #166534; }
        .fs-stake p { margin: 0; font-size: 12.5px; line-height: 1.4; color: rgba(34,16,79,0.7); }
        .fs-chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .fs-chips button { flex: 1; min-width: 62px; padding: 9px 0; border-radius: 12px; border: 1px solid rgba(76,29,149,0.18); background: #faf7ff; font: inherit; font-size: 13.5px; font-weight: 800; color: #22104f; cursor: pointer; }
        .fs-chips button.on { background: #22104f; border-color: #22104f; color: #fff; } .fs-chips button:disabled { opacity: 0.5; cursor: default; }
        .fs-agree { padding: 12px 0; border: none; border-radius: 14px; background: #166534; color: #fff !important; font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; } .fs-agree:disabled { opacity: 0.55; cursor: default; }
        .fs-link { align-self: flex-start; padding: 0; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: #6d28d9 !important; cursor: pointer; }
        .fs-players li.away { opacity: 0.5; } .fs-players li.away i { color: rgba(34,16,79,0.6); }
        .fs-players li.empty { background: transparent; border-style: dashed; color: rgba(34,16,79,0.45); font-weight: 600; }
        .fs-wait { text-align: center; padding: 14px 0; font-size: 14px; font-weight: 700; color: rgba(34,16,79,0.62); }
        .fs-err { text-align: center; font-size: 13px; font-weight: 700; color: #be123c; }
        @media (prefers-reduced-motion: reduce) { .fs-wrap, .fs, .fs-code b { animation: none; } }
      `}</style>
    </div>
  );
}

// Playing the round for G$. The host picks an entry; everyone agrees by signing.
// A signature is not a payment: nothing leaves a wallet unless its owner loses.
function StakeBox({ room, view, active }: { room: FriendRoom; view: RoomView; active: number }) {
  const { sign, canSign } = useRoomPermit();
  const [working, setWorking] = useState(false);
  const terms = view.stakeTerms!; const st = view.stake; const mine = !!st?.signed[view.you];
  const agree = async (entryWei: string, asHost: boolean) => {
    if (working) return;
    setWorking(true); room.say(null);
    const permit = await sign(terms.spender, entryWei);
    if ("error" in permit) room.say(permit.error);
    else if (asHost) await room.setEntry(entryWei, permit);
    else await room.agreeEntry(permit);
    setWorking(false);
  };
  if (!st) {
    if (!room.isHost) return null;
    return (
      <div className="fs-stake">
        <em>Play for G$ · optional</em>
        <div className="fs-chips">
          <button className="on" disabled>Free</button>
          {terms.entries.map((e) => <button key={e} disabled={!canSign || working || room.busy} onClick={() => void agree(e, true)}>{gd(e)} G$</button>)}
        </div>
        <p>{canSign ? "Pick an entry and everyone agrees to it. Nothing leaves a wallet unless its owner loses the round." : "Sign in to play for G$."}</p>
      </div>
    );
  }
  const gain = winnerGain(st.entryWei, st.feeBps, active);
  return (
    <div className="fs-stake">
      <em>Playing for G$</em>
      <b>{gd(st.entryWei)} G$ each · <u>winner gets {gain} G$</u></b>
      <p>The others pay the winner when the round ends. Nothing is taken now, and a tie moves nothing. {st.feeBps / 100}% of each entry is the fee.</p>
      {!mine && (canSign
        ? <button className="fs-agree" disabled={working || room.busy} onClick={() => void agree(st.entryWei, false)}>{working ? "Check your wallet…" : `Agree to ${gd(st.entryWei)} G$`}</button>
        : <p><b>Sign in to agree, or ask the host to play for free.</b></p>)}
      {room.isHost && <button className="fs-link" disabled={working || room.busy} onClick={() => void room.clearEntry()}>Play for free instead</button>}
    </div>
  );
}
