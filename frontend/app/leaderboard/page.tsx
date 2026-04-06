'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACT_ADDRESSES } from '@/lib/contracts';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3005';

const TABS = [
  { id: 'live', label: 'RANKINGS' },
  { id: 'history', label: 'SEASONS' },
  { id: 'pvp', label: 'PVP' },
];
const GAME_TABS = [
  { id: 'rhythm', label: 'RHYTHM_RUSH', accent: '#a855f7' },
  { id: 'simon', label: 'SIMON_MEMORY', accent: '#06b6d4' },
];
const MEDALS = ['🥇', '🥈', '🥉'];
const GAME_ACCENT: Record<string, string> = { rhythm: '#a855f7', simon: '#06b6d4' };

type Entry = { player: string; username?: string; score: number; timestamp: number; gWon?: number };
function fmt(addr: string, username?: string) {
  if (!addr || addr === 'you') return 'YOU';
  if (username) return username;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts: number) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


function SeasonRow({ season, game, myAddress, accent }: { season: { season: number; startTs: number; endTs: number; [key: string]: unknown }; game: string; myAddress?: string; accent: string }) {
  const entries = (season[game] as Entry[]) || [];
  const myRank = myAddress ? entries.findIndex(e => e.player === myAddress.toLowerCase()) + 1 : 0;
  if (entries.length === 0) return null;
  return (
    <div style={{ padding: '12px 16px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', marginBottom: '10px', background: myRank > 0 ? `${accent}08` : 'rgba(0,0,0,0.2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <span style={{ color: '#9ca3af', fontSize: '12px', fontWeight: 700 }}>WEEK {season.season}</span>
          <span style={{ color: '#374151', fontSize: '9px', marginLeft: '8px' }}>{formatDate(season.startTs)} – {formatDate(season.endTs)}</span>
        </div>
        {myRank > 0 && (
          <div style={{ padding: '3px 10px', borderRadius: '10px', background: myRank === 1 ? 'rgba(245,158,11,0.15)' : `${accent}15`, border: `1px solid ${myRank === 1 ? 'rgba(245,158,11,0.4)' : `${accent}40`}`, color: myRank === 1 ? '#f59e0b' : accent, fontSize: '10px', fontWeight: 900 }}>
            {myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : `#${myRank}`} YOUR FINISH
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {entries.slice(0, 3).map((e, i) => {
          const isMe = myAddress && e.player === myAddress.toLowerCase();
          return (
            <div key={e.player} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 8px', borderRadius: '6px', background: isMe ? `${accent}12` : 'transparent' }}>
              <span style={{ fontSize: '14px', minWidth: '20px' }}>{MEDALS[i]}</span>
              <span style={{ color: isMe ? accent : '#9ca3af', fontSize: '11px', fontWeight: isMe ? 700 : 400, flex: 1 }}>{isMe ? 'YOU' : fmt(e.player, e.username)}</span>
              <span style={{ color: i === 0 ? accent : '#6b7280', fontSize: '13px', fontWeight: 900 }}>{e.score}</span>
              <span style={{ color: '#374151', fontSize: '9px' }}>pts</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const { address } = useAccount();
  const [activeTab, setActiveTab] = useState('live');
  const [gameTab, setGameTab] = useState('rhythm');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('game') === 'simon') setGameTab('simon');
  }, []);
  const [podium, setPodium] = useState<Entry[]>([]);
  const [listEntries, setListEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendDown, setBackendDown] = useState(false);
  const [newEntries, setNewEntries] = useState(new Set<string>());
  const [countdown, setCountdown] = useState(15);
  const [seasons, setSeasons] = useState<unknown>(null);
  const [pvpMatches, setPvpMatches] = useState<{ id: number; challenger: string; opponent: string; wager: bigint; gameType: number; status: number; winner: string }[]>([]);
  const [pvpLeaders, setPvpLeaders] = useState<{ address: string; count: number }[]>([]);
  const [listPage, setListPage] = useState(1);
  const [totalListPages, setTotalListPages] = useState(1);
  const [totalEntries, setTotalEntries] = useState(0);
  const prevPlayers = useRef(new Set<string>());
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const publicClient = usePublicClient();

  const tab = GAME_TABS.find(t => t.id === gameTab)!;

  const LIST_SIZE = 7;

  const fetchPodium = useCallback(async (game: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/leaderboard?game=${game}&offset=0&limit=3`);
      const data = await res.json();
      setPodium(data.leaderboard || []);
      setTotalEntries(data.total || 0);
    } catch {}
  }, []);

  const fetchList = useCallback(async (game: string, p = 1, silent = false) => {
    if (!silent) setLoading(true);
    setBackendDown(false);
    try {
      const offset = 3 + (p - 1) * LIST_SIZE;
      const res = await fetch(`${BACKEND_URL}/api/leaderboard?game=${game}&offset=${offset}&limit=${LIST_SIZE}`);
      const data = await res.json();
      const list: Entry[] = data.leaderboard || [];
      const fresh = new Set<string>();
      list.forEach(e => { if (!prevPlayers.current.has(e.player)) fresh.add(e.player); });
      if (fresh.size) { setNewEntries(fresh); setTimeout(() => setNewEntries(new Set()), 2000); }
      prevPlayers.current = new Set(list.map(e => e.player));
      setListEntries(list);
      const total = data.total || 0;
      setTotalEntries(total);
      setTotalListPages(Math.max(1, Math.ceil(Math.max(0, total - 3) / LIST_SIZE)));
    } catch {
      setBackendDown(true);
      setListEntries([]);
    } finally { setLoading(false); }
  }, []);

  const fetchScores = useCallback((game: string, silent = false) => {
    fetchPodium(game);
    fetchList(game, 1, silent);
    setListPage(1);
  }, [fetchPodium, fetchList]);

  const fetchMeta = useCallback(async () => {
    try {
      const sRes = await fetch(`${BACKEND_URL}/api/seasons`);
      if (sRes.ok) setSeasons(await sRes.json());
    } catch (_) {}
  }, []);

  useEffect(() => { fetchScores(gameTab); }, [gameTab, fetchScores]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  useEffect(() => {
    if (activeTab !== 'pvp' || !publicClient) return;
    let cancelled = false;
    (async () => {
      try {
        const ARENA_ABI = [
          { name: 'matchCounter', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function', inputs: [] },
          { name: 'matches', outputs: [{ type: 'tuple', components: [{ name: 'id', type: 'uint256' }, { name: 'challenger', type: 'address' }, { name: 'opponent', type: 'address' }, { name: 'wager', type: 'uint256' }, { name: 'gameType', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'winner', type: 'address' }] }], stateMutability: 'view', type: 'function', inputs: [{ type: 'uint256' }] },
        ] as const;
        const count = await publicClient.readContract({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_ABI, functionName: 'matchCounter' });
        const total = Number(count);
        if (total === 0) return;
        const start = Math.max(0, total - 50);
        const ids = Array.from({ length: total - start }, (_, i) => BigInt(total - 1 - i));
        const results = await publicClient.multicall({
          contracts: ids.map(id => ({ address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_ABI, functionName: 'matches' as const, args: [id] })),
        });
        const matches = results.map((r, i) => {
          if (r.status === 'failure' || !r.result) return null;
          const m = r.result as { id: bigint; challenger: string; opponent: string; wager: bigint; gameType: number; status: number; winner: string };
          return { id: Number(ids[i]), challenger: m.challenger, opponent: m.opponent, wager: m.wager, gameType: Number(m.gameType), status: Number(m.status), winner: m.winner };
        }).filter(Boolean) as typeof pvpMatches;
        if (cancelled) return;
        setPvpMatches(matches);
        const wins: Record<string, number> = {};
        matches.forEach(m => {
          if (m.status === 2 && m.winner && m.winner !== '0x0000000000000000000000000000000000000000') {
            const w = m.winner.toLowerCase();
            wins[w] = (wins[w] || 0) + 1;
          }
        });
        setPvpLeaders(Object.entries(wins).map(([a, c]) => ({ address: a, count: c })).sort((a, b) => b.count - a.count).slice(0, 20));
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [activeTab, publicClient]);

  useEffect(() => {
    if (activeTab !== 'live') return;
    setCountdown(15);
    if (countRef.current) clearInterval(countRef.current);
    countRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { fetchScores(gameTab, true); return 15; }
        return c - 1;
      });
    }, 1000);
    return () => { if (countRef.current) clearInterval(countRef.current); };
  }, [activeTab, gameTab, fetchScores]);

  const allVisible = [...podium, ...listEntries];
  const myRankInPodium = address ? podium.findIndex((e: Entry) => e.player.toLowerCase() === address.toLowerCase()) : -1;
  const myRankInList   = address ? listEntries.findIndex((e: Entry) => e.player.toLowerCase() === address.toLowerCase()) : -1;
  const myRank = myRankInPodium >= 0
    ? myRankInPodium + 1
    : myRankInList >= 0
      ? 3 + (listPage - 1) * LIST_SIZE + myRankInList + 1
      : 0;
  const myScore = address ? allVisible.find((e: Entry) => e.player.toLowerCase() === address.toLowerCase())?.score : null;
  const aboveEntry = myRank > 1
    ? myRankInPodium > 0
      ? podium[myRankInPodium - 1]
      : myRankInList === 0
        ? podium[2]
        : listEntries[myRankInList - 1]
    : null;
  const gap = aboveEntry && myScore != null ? aboveEntry.score - myScore : null;
  const seasonsData = seasons as { currentSeason: number; currentEndsAt: number; live: Record<string, Entry[]>; past: ({ season: number; startTs: number; endTs: number } & Record<string, Entry[]>)[] } | null;

  return (
    <>
      <style>{`
        @keyframes slideDown { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes flashGlow { 0%{box-shadow:none} 30%{box-shadow:0 0 14px currentColor} 100%{box-shadow:none} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{ fontFamily: 'Orbitron, monospace', maxWidth: '560px', margin: '0 auto', padding: '0 4px' }}>

        {/* Header */}
        <div style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1 style={{ color: '#fff', fontSize: '17px', fontWeight: 900, letterSpacing: '2px', margin: 0 }}>LEADERBOARD</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              {activeTab === 'live' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: '#10b981', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <span style={{ color: '#374151', fontSize: '9px' }}>{countdown}s</span>
                </div>
              )}
              <button onClick={() => { fetchScores(gameTab); fetchMeta(); }} style={{ color: '#6b7280', fontSize: '9px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Orbitron, monospace' }}>↺</button>
              <Link href="/" style={{ color: '#6b7280', fontSize: '9px', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', whiteSpace: 'nowrap' }}>← BACK</Link>
            </div>
          </div>
          {backendDown && <p style={{ color: '#f59e0b', fontSize: '10px', letterSpacing: '1px', margin: '3px 0 0' }}>OFFLINE — showing local scores</p>}
        </div>

        {/* Main tabs */}
        <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: '7px', background: activeTab === t.id ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${activeTab === t.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'}`, borderRadius: '8px', color: activeTab === t.id ? '#fff' : '#4b5563', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', cursor: 'pointer', fontFamily: 'Orbitron, monospace', transition: 'all 0.2s' }}>{t.label}</button>
          ))}
        </div>

        {/* Game sub-tabs */}
        {activeTab !== 'pvp' && (
          <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
            {GAME_TABS.map(t => (
              <button key={t.id} onClick={() => { setGameTab(t.id); }} style={{ flex: 1, padding: '7px 6px', background: gameTab === t.id ? `${t.accent}18` : 'rgba(255,255,255,0.02)', border: `1px solid ${gameTab === t.id ? t.accent : 'rgba(255,255,255,0.06)'}`, borderRadius: '8px', color: gameTab === t.id ? t.accent : '#6b7280', fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', cursor: 'pointer', fontFamily: 'Orbitron, monospace', transition: 'all 0.2s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</button>
            ))}
          </div>
        )}

        {/* LIVE RANKINGS */}
        {activeTab === 'live' && (
          <>
            {myRank > 0 && (
              <div style={{ marginBottom: '10px', padding: '10px 14px', background: `${tab.accent}10`, border: `1px solid ${tab.accent}35`, borderRadius: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>YOUR RANK</div>
                    <div style={{ color: tab.accent, fontSize: '22px', fontWeight: 900, lineHeight: 1.1 }}>#{myRank}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>YOUR BEST</div>
                    <div style={{ color: '#fff', fontSize: '22px', fontWeight: 900, lineHeight: 1.1 }}>{myScore}</div>
                  </div>
                </div>
                {gap !== null && gap > 0 && (
                  <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <div style={{ color: '#ef4444', fontSize: '11px', fontWeight: 700, letterSpacing: '1px' }}>
                      {gap === 1 ? `1 PT FROM #${myRank - 1} — SO CLOSE` : `${gap} PTS FROM #${myRank - 1} — PLAY AGAIN`}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '3px' }}>{fmt(aboveEntry!.player, aboveEntry!.username)} is blocking your spot</div>
                  </div>
                )}
                {myRank === 1 && (
                  <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
                    <div style={{ color: '#10b981', fontSize: '11px', fontWeight: 700, letterSpacing: '1px' }}>YOU ARE #1 — DEFEND YOUR THRONE</div>
                    <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '3px' }}>{podium[1] ? `${fmt(podium[1].player, podium[1].username)} is ${myScore! - podium[1].score} pts behind` : 'No challengers yet'}</div>
                  </div>
                )}
              </div>
            )}

            {podium.length >= 3 && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '90px', marginBottom: '10px' }}>
                {[podium[1], podium[0], podium[2]].map((e, i) => {
                  const rank = i === 0 ? 2 : i === 1 ? 1 : 3;
                  const height = rank === 1 ? '100%' : rank === 2 ? '70%' : '52%';
                  const isMe = address && e.player.toLowerCase() === address.toLowerCase();
                  const isNew = newEntries.has(e.player);
                  return (
                    <div key={e.player} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ fontSize: rank === 1 ? '26px' : '20px', marginBottom: '4px' }}>{MEDALS[rank - 1]}</div>
                      <div style={{ width: '100%', height, background: rank === 1 ? `${tab.accent}22` : 'rgba(255,255,255,0.05)', border: `1px solid ${rank === 1 ? tab.accent : 'rgba(255,255,255,0.1)'}`, borderRadius: '8px 8px 0 0', outline: isMe ? `2px solid ${tab.accent}` : 'none', animation: isNew ? 'flashGlow 1.5s ease-out' : 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', padding: '8px' }}>
                        <div style={{ color: rank === 1 ? tab.accent : '#fff', fontSize: '14px', fontWeight: 900 }}>{e.score}</div>
                        <div style={{ color: '#6b7280', fontSize: '9px', marginTop: '2px', textAlign: 'center' }}>{isMe ? 'YOU' : fmt(e.player, e.username)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ background: 'rgba(10,10,20,0.8)', border: `1px solid ${tab.accent}22`, borderRadius: '12px', overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#4b5563', fontSize: '12px', letterSpacing: '1px' }}>LOADING...</div>
              ) : listEntries.length === 0 && podium.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎮</div>
                  <div style={{ color: '#4b5563', fontSize: '12px', letterSpacing: '1px' }}>NO SCORES YET</div>
                </div>
              ) : listEntries.map((e: Entry, i: number) => {
                const globalRank = 3 + (listPage - 1) * LIST_SIZE + i + 1;
                const isMe = address && e.player.toLowerCase() === address.toLowerCase();
                const isNew = newEntries.has(e.player);
                return (
                  <div key={`${e.player}-${i}`} style={{ padding: '10px 14px', borderBottom: i < listEntries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: isMe ? `${tab.accent}0d` : isNew ? 'rgba(16,185,129,0.06)' : 'transparent', outline: isMe ? `1px solid ${tab.accent}40` : 'none', animation: isNew ? 'slideDown 0.4s ease-out' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '12px', minWidth: '26px', textAlign: 'center', color: '#6b7280', fontWeight: 700 }}>{`#${globalRank}`}</span>
                        <div>
                          <div style={{ color: isMe ? tab.accent : '#d1d5db', fontSize: '13px', fontWeight: 700 }}>
                            {isMe ? 'YOU' : fmt(e.player, e.username)}
                            {isNew && <span style={{ color: '#10b981', fontSize: '9px', marginLeft: '6px' }}>NEW</span>}
                          </div>
                          <div style={{ color: '#4b5563', fontSize: '10px', marginTop: '1px' }}>{timeAgo(e.timestamp)}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#fff', fontSize: '16px', fontWeight: 900 }}>{e.score}</div>
                        <div style={{ color: '#4b5563', fontSize: '10px' }}>pts</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!loading && totalListPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', gap: '8px' }}>
                <button onClick={() => { const p = Math.max(1, listPage - 1); setListPage(p); fetchList(gameTab, p, true); }} disabled={listPage === 1} style={{ flex: 1, padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: listPage === 1 ? '#374151' : '#9ca3af', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', cursor: listPage === 1 ? 'not-allowed' : 'pointer', fontFamily: 'Orbitron, monospace' }}>← PREV</button>
                <span style={{ color: '#4b5563', fontSize: '10px', letterSpacing: '1px', whiteSpace: 'nowrap' }}>{listPage} / {totalListPages}</span>
                <button onClick={() => { const p = Math.min(totalListPages, listPage + 1); setListPage(p); fetchList(gameTab, p, true); }} disabled={listPage === totalListPages} style={{ flex: 1, padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: listPage === totalListPages ? '#374151' : '#9ca3af', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', cursor: listPage === totalListPages ? 'not-allowed' : 'pointer', fontFamily: 'Orbitron, monospace' }}>NEXT →</button>
              </div>
            )}
          </>
        )}

        {/* SEASON HISTORY */}
        {activeTab === 'history' && (
          <div>
            {!seasonsData ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#4b5563', fontSize: '12px' }}>LOADING...</div>
            ) : (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 700, letterSpacing: '2px' }}>WEEK {seasonsData.currentSeason} — IN PROGRESS</span>
                    <span style={{ color: '#374151', fontSize: '9px' }}>ends {formatDate(seasonsData.currentEndsAt)}</span>
                  </div>
                  <SeasonRow season={{ season: seasonsData.currentSeason, startTs: 0, endTs: seasonsData.currentEndsAt, rhythm: seasonsData.live.rhythm, simon: seasonsData.live.simon }} game={gameTab} myAddress={address} accent={GAME_ACCENT[gameTab]} />
                </div>
                {seasonsData.past.length === 0 ? (
                  <div style={{ padding: '30px', textAlign: 'center', color: '#374151', fontSize: '11px' }}>No completed seasons yet.</div>
                ) : (
                  <>
                    <div style={{ color: '#4b5563', fontSize: '9px', letterSpacing: '2px', marginBottom: '10px' }}>COMPLETED SEASONS</div>
                    {seasonsData.past.map(s => <SeasonRow key={s.season} season={s} game={gameTab} myAddress={address} accent={GAME_ACCENT[gameTab]} />)}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* PVP ARENA */}
        {activeTab === 'pvp' && (() => {
          const myWins = pvpMatches.filter(m => m.status === 2 && m.winner?.toLowerCase() === address?.toLowerCase()).length;
          const myTotal = pvpMatches.filter(m => m.status === 2 && address && (m.challenger.toLowerCase() === address.toLowerCase() || m.opponent.toLowerCase() === address.toLowerCase())).length;
          const myLosses = myTotal - myWins;
          return (
            <div>
              {address && myTotal > 0 && (
                <div style={{ display: 'flex', gap: '0', marginBottom: '14px', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
                  {[{ v: myWins, l: 'WINS', c: '#10b981' }, { v: myLosses, l: 'LOSSES', c: '#ef4444' }, { v: myTotal > 0 ? `${Math.round(myWins / myTotal * 100)}%` : '—', l: 'RATE', c: '#a855f7' }].map((s, i) => (
                    <div key={s.l} style={{ flex: 1, textAlign: 'center', padding: '10px 4px', background: 'rgba(0,0,0,0.25)', borderRight: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                      <div style={{ color: s.c, fontSize: '16px', fontWeight: 900 }}>{s.v}</div>
                      <div style={{ color: '#2a2a3a', fontSize: '7px', marginTop: '2px' }}>{s.l}</div>
                    </div>
                  ))}
                </div>
              )}
              {pvpLeaders.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  {pvpLeaders.slice(0, 3).map((p, i) => {
                    const isMe = address && p.address === address.toLowerCase();
                    return (
                      <div key={p.address} style={{ flex: 1, textAlign: 'center', padding: '14px 6px', borderRadius: '12px', background: i === 0 ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isMe ? 'rgba(168,85,247,0.3)' : i === 0 ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)'}` }}>
                        <div style={{ fontSize: '18px', marginBottom: '4px' }}>{MEDALS[i]}</div>
                        <div style={{ color: isMe ? '#a855f7' : '#9ca3af', fontSize: '10px', fontWeight: 900 }}>{isMe ? 'YOU' : `${p.address.slice(0, 4)}...`}</div>
                        <div style={{ color: '#fff', fontSize: '16px', fontWeight: 900, marginTop: '2px' }}>{p.count}</div>
                        <div style={{ color: '#374151', fontSize: '7px' }}>WINS</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ padding: '12px', borderRadius: '12px', marginBottom: '14px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ color: '#6b7280', fontSize: '9px', fontWeight: 700, letterSpacing: '2px', marginBottom: '8px' }}>RECENT MATCHES</div>
                {pvpMatches.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#374151', fontSize: '10px' }}>No matches yet</div>
                ) : pvpMatches.slice(0, 5).map(m => {
                  const isMe = address && (m.challenger.toLowerCase() === address.toLowerCase() || m.opponent.toLowerCase() === address.toLowerCase());
                  const iWon = m.status === 2 && m.winner?.toLowerCase() === address?.toLowerCase();
                  const iLost = m.status === 2 && isMe && !iWon && m.winner !== '0x0000000000000000000000000000000000000000';
                  return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ fontSize: '9px', color: '#6b7280' }}>⚔️ {m.challenger.slice(0, 5)}.. vs {m.opponent.slice(0, 5)}..<span style={{ color: '#374151' }}> · {formatUnits(m.wager, 18)} G$</span></span>
                      <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '8px', fontWeight: 900, color: m.status === 2 ? (iWon ? '#10b981' : iLost ? '#ef4444' : '#6b7280') : '#f59e0b', background: m.status === 2 ? (iWon ? 'rgba(16,185,129,0.1)' : iLost ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.03)') : 'rgba(245,158,11,0.08)' }}>
                        {m.status === 2 ? (iWon ? 'WON' : iLost ? 'LOST' : 'DONE') : 'LIVE'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <Link href="/games/arena" style={{ display: 'block', padding: '14px', textAlign: 'center', background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(168,85,247,0.05))', border: '1px solid rgba(168,85,247,0.25)', borderRadius: '12px', color: '#a855f7', fontSize: '12px', fontWeight: 900, letterSpacing: '2px', textDecoration: 'none', fontFamily: 'Orbitron, monospace' }}>CHALLENGE AI</Link>
            </div>
          );
        })()}

        {/* Play buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <Link href="/games/rhythm" style={{ flex: 1, padding: '12px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '8px', color: '#a855f7', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textDecoration: 'none', textAlign: 'center', display: 'block' }}>PLAY RHYTHM</Link>
          <Link href="/games/simon" style={{ flex: 1, padding: '12px', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', borderRadius: '8px', color: '#06b6d4', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textDecoration: 'none', textAlign: 'center', display: 'block' }}>PLAY SIMON</Link>
        </div>
      </div>
    </>
  );
}
