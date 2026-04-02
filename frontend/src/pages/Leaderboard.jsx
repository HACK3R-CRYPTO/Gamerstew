import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';

const BACKEND_URL = import.meta.env.VITE_GAMES_BACKEND_URL || 'http://localhost:3005';

const TABS = [
  { id: 'live',    label: 'LIVE RANKINGS' },
  { id: 'history', label: 'SEASON HISTORY' },
];
const GAME_TABS = [
  { id: 'rhythm', label: 'RHYTHM_RUSH', accent: '#a855f7' },
  { id: 'simon',  label: 'SIMON_MEMORY', accent: '#06b6d4' },
];
const MEDALS = ['🥇', '🥈', '🥉'];
const BADGE_COLORS = { gold: '#f59e0b', silver: '#9ca3af', bronze: '#b45309' };
const GAME_ACCENT  = { rhythm: '#a855f7', simon: '#06b6d4' };

function fmt(addr, username) {
  if (!addr || addr === 'you') return 'YOU';
  if (username) return username;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Badge chip ───────────────────────────────────────────────────────────────
function BadgeChip({ badge }) {
  const color  = BADGE_COLORS[badge.type];
  const medal  = badge.rank === 1 ? '🥇' : badge.rank === 2 ? '🥈' : '🥉';
  const game   = badge.game === 'rhythm' ? 'RR' : 'SM';
  return (
    <div title={`#${badge.rank} in ${badge.game === 'rhythm' ? 'Rhythm Rush' : 'Simon Memory'} — Week ${badge.season} — ${badge.score} pts`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        padding: '2px 7px', borderRadius: '10px',
        background: `${color}18`, border: `1px solid ${color}50`,
        fontSize: '9px', fontWeight: 700, color, letterSpacing: '0.5px',
        cursor: 'default',
      }}
    >
      {medal} W{badge.season} {game}
    </div>
  );
}

// ── Streak banner ────────────────────────────────────────────────────────────
function StreakBanner({ label }) {
  if (!label) return null;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '12px',
      background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
      fontSize: '10px', fontWeight: 900, color: '#f59e0b', letterSpacing: '1px',
    }}>
      🔥 {label}
    </div>
  );
}

// ── Season row (history tab) ─────────────────────────────────────────────────
function SeasonRow({ season, game, myAddress, accent }) {
  const entries = season[game] || [];
  const myRank  = myAddress
    ? entries.findIndex(e => e.player === myAddress.toLowerCase()) + 1
    : 0;

  if (entries.length === 0) return null;

  return (
    <div style={{
      padding: '12px 16px',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px', marginBottom: '10px',
      background: myRank > 0 ? `${accent}08` : 'rgba(0,0,0,0.2)',
    }}>
      {/* Season header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <span style={{ color: '#9ca3af', fontSize: '12px', fontWeight: 700 }}>WEEK {season.season}</span>
          <span style={{ color: '#374151', fontSize: '9px', marginLeft: '8px' }}>
            {formatDate(season.startTs)} – {formatDate(season.endTs)}
          </span>
        </div>
        {myRank > 0 && (
          <div style={{
            padding: '3px 10px', borderRadius: '10px',
            background: myRank === 1 ? 'rgba(245,158,11,0.15)' : `${accent}15`,
            border: `1px solid ${myRank === 1 ? 'rgba(245,158,11,0.4)' : `${accent}40`}`,
            color: myRank === 1 ? '#f59e0b' : accent,
            fontSize: '10px', fontWeight: 900,
          }}>
            {myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : `#${myRank}`} YOUR FINISH
          </div>
        )}
      </div>

      {/* Top 3 of that season */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {entries.slice(0, 3).map((e, i) => {
          const isMe = myAddress && e.player === myAddress.toLowerCase();
          return (
            <div key={e.player} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '5px 8px', borderRadius: '6px',
              background: isMe ? `${accent}12` : 'transparent',
            }}>
              <span style={{ fontSize: '14px', minWidth: '20px' }}>{MEDALS[i]}</span>
              <span style={{ color: isMe ? accent : '#9ca3af', fontSize: '11px', fontWeight: isMe ? 700 : 400, flex: 1 }}>
                {isMe ? 'YOU' : fmt(e.player, e.username)}
              </span>
              <span style={{ color: i === 0 ? accent : '#6b7280', fontSize: '13px', fontWeight: 900 }}>
                {e.score}
              </span>
              <span style={{ color: '#374151', fontSize: '9px' }}>pts</span>
              {e.gWon > 0 && (
                <span style={{
                  padding: '1px 6px', borderRadius: '6px', fontSize: '9px', fontWeight: 700,
                  background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)',
                  color: '#a855f7',
                }}>
                  +{e.gWon} G$
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Leaderboard() {
  const { address } = useAccount();
  const [activeTab,   setActiveTab]   = useState('live');
  const [gameTab,     setGameTab]     = useState('rhythm');
  const [entries,     setEntries]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [backendDown, setBackendDown] = useState(false);
  const [newEntries,  setNewEntries]  = useState(new Set());
  const [countdown,   setCountdown]   = useState(15);
  const [seasons,     setSeasons]     = useState(null);
  const [badges,      setBadges]      = useState(null);
  const prevPlayers = useRef(new Set());
  const countRef    = useRef(null);

  const tab = GAME_TABS.find(t => t.id === gameTab);

  // Fetch leaderboard
  const fetchScores = useCallback(async (game, silent = false) => {
    if (!silent) setLoading(true);
    setBackendDown(false);
    try {
      const res  = await fetch(`${BACKEND_URL}/api/leaderboard?game=${game}`);
      const data = await res.json();
      const list = data.leaderboard || [];

      const fresh = new Set();
      list.forEach(e => { if (!prevPlayers.current.has(e.player)) fresh.add(e.player); });
      if (fresh.size) {
        setNewEntries(fresh);
        setTimeout(() => setNewEntries(new Set()), 2000);
      }
      prevPlayers.current = new Set(list.map(e => e.player));
      setEntries(list);
    } catch {
      setBackendDown(true);
      try {
        const key   = game === 'rhythm' ? 'rhythmrush_scores' : 'simon_scores';
        const local = JSON.parse(localStorage.getItem(key) || '[]');
        setEntries(local.map(e => ({ player: address || 'you', score: e.score, timestamp: Math.floor((e.date || Date.now()) / 1000) })));
      } catch { setEntries([]); }
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Fetch seasons + badges
  const fetchMeta = useCallback(async () => {
    try {
      const [sRes, bRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/seasons`),
        address ? fetch(`${BACKEND_URL}/api/badges/${address}`) : Promise.resolve(null),
      ]);
      if (sRes.ok) setSeasons(await sRes.json());
      if (bRes?.ok) setBadges(await bRes.json());
    } catch (_) {}
  }, [address]);

  useEffect(() => { fetchScores(gameTab); }, [gameTab, fetchScores]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  // Auto-refresh live tab every 15 s
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
    return () => clearInterval(countRef.current);
  }, [activeTab, gameTab, fetchScores]);

  const myRank  = address ? entries.findIndex(e => e.player.toLowerCase() === address.toLowerCase()) + 1 : 0;
  const myScore = address ? entries.find(e => e.player.toLowerCase() === address.toLowerCase())?.score : null;
  const aboveEntry = myRank > 1 ? entries[myRank - 2] : null;
  const gap        = aboveEntry && myScore != null ? aboveEntry.score - myScore : null;

  return (
    <>
      <style>{`
        @keyframes slideDown { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes flashGlow { 0%{box-shadow:none} 30%{box-shadow:0 0 14px currentColor} 100%{box-shadow:none} }
        @keyframes pulse     { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{ fontFamily: 'Orbitron, monospace', maxWidth: '560px', margin: '0 auto' }}>

        {/* ── Header ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <h1 style={{ color: '#fff', fontSize: '20px', fontWeight: 900, letterSpacing: '2px', margin: 0 }}>
              LEADERBOARD
            </h1>
            {backendDown && (
              <p style={{ color: '#f59e0b', fontSize: '10px', letterSpacing: '1px', marginTop: '4px' }}>
                OFFLINE — showing local scores
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {activeTab === 'live' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <span style={{ color: '#374151', fontSize: '9px' }}>LIVE · {countdown}s</span>
              </div>
            )}
            <button onClick={() => { fetchScores(gameTab); fetchMeta(); }}
              style={{ color: '#6b7280', fontSize: '11px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Orbitron, monospace' }}>
              REFRESH
            </button>
            <Link to="/games" style={{ color: '#6b7280', fontSize: '11px', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', borderRadius: '4px' }}>
              ← GAMES
            </Link>
          </div>
        </div>

        {/* ── My badges strip ─────────────────────────────────────── */}
        {badges && (badges.badges.length > 0 || badges.summary.streakLabel) && (
          <div style={{
            marginBottom: '16px', padding: '12px 16px',
            background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)',
            borderRadius: '10px',
          }}>
            <div style={{ color: '#6b7280', fontSize: '9px', letterSpacing: '2px', marginBottom: '8px' }}>YOUR BADGES</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
              {badges.summary.streakLabel && <StreakBanner label={badges.summary.streakLabel} />}
              {badges.badges.slice(0, 8).map((b, i) => <BadgeChip key={i} badge={b} />)}
              {badges.badges.length > 8 && (
                <span style={{ color: '#4b5563', fontSize: '9px' }}>+{badges.badges.length - 8} more</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              {[
                { label: 'GOLD',   count: badges.summary.totalGold,   color: '#f59e0b' },
                { label: 'SILVER', count: badges.summary.totalSilver, color: '#9ca3af' },
                { label: 'BRONZE', count: badges.summary.totalBronze, color: '#b45309' },
              ].map(({ label, count, color }) => count > 0 && (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ color, fontSize: '14px', fontWeight: 900 }}>{count}</div>
                  <div style={{ color: '#374151', fontSize: '8px' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Main tabs ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flex: 1, padding: '9px',
              background:   activeTab === t.id ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)',
              border:       `1px solid ${activeTab === t.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: '8px', color: activeTab === t.id ? '#fff' : '#4b5563',
              fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
              cursor: 'pointer', fontFamily: 'Orbitron, monospace', transition: 'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── Game sub-tabs ────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
          {GAME_TABS.map(t => (
            <button key={t.id} onClick={() => setGameTab(t.id)} style={{
              flex: 1, padding: '9px',
              background:   gameTab === t.id ? `${t.accent}18` : 'rgba(255,255,255,0.02)',
              border:       `1px solid ${gameTab === t.id ? t.accent : 'rgba(255,255,255,0.06)'}`,
              borderRadius: '8px', color: gameTab === t.id ? t.accent : '#6b7280',
              fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
              cursor: 'pointer', fontFamily: 'Orbitron, monospace', transition: 'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ LIVE RANKINGS tab ═══════════════════════════════════════ */}
        {activeTab === 'live' && (
          <>
            {/* My rank + near-miss */}
            {myRank > 0 && (
              <div style={{ marginBottom: '16px', padding: '14px 18px', background: `${tab.accent}10`, border: `1px solid ${tab.accent}35`, borderRadius: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: '10px', letterSpacing: '1px' }}>YOUR RANK</div>
                    <div style={{ color: tab.accent, fontSize: '28px', fontWeight: 900, lineHeight: 1.1 }}>#{myRank}</div>
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
                    <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '3px' }}>
                      {fmt(aboveEntry.player, aboveEntry.username)} is blocking your spot
                    </div>
                  </div>
                )}

                {myRank === 1 && (
                  <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
                    <div style={{ color: '#10b981', fontSize: '11px', fontWeight: 700, letterSpacing: '1px' }}>
                      YOU ARE #1 — DEFEND YOUR THRONE
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '3px' }}>
                      {entries[1] ? `${fmt(entries[1].player, entries[1].username)} is ${myScore - entries[1].score} pts behind` : 'No challengers yet'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Podium */}
            {!loading && entries.length >= 3 && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '120px', marginBottom: '20px' }}>
                {[entries[1], entries[0], entries[2]].map((e, i) => {
                  const rank   = i === 0 ? 2 : i === 1 ? 1 : 3;
                  const height = rank === 1 ? '100%' : rank === 2 ? '70%' : '52%';
                  const isMe   = address && e.player.toLowerCase() === address.toLowerCase();
                  const isNew  = newEntries.has(e.player);
                  return (
                    <div key={e.player} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ fontSize: rank === 1 ? '26px' : '20px', marginBottom: '4px' }}>{MEDALS[rank - 1]}</div>
                      <div style={{
                        width: '100%', height,
                        background:   rank === 1 ? `${tab.accent}22` : 'rgba(255,255,255,0.05)',
                        border:       `1px solid ${rank === 1 ? tab.accent : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: '8px 8px 0 0',
                        outline:      isMe ? `2px solid ${tab.accent}` : 'none',
                        color:        tab.accent,
                        animation:    isNew ? 'flashGlow 1.5s ease-out' : 'none',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', padding: '8px',
                      }}>
                        <div style={{ color: rank === 1 ? tab.accent : '#fff', fontSize: '14px', fontWeight: 900 }}>{e.score}</div>
                        <div style={{ color: '#6b7280', fontSize: '9px', marginTop: '2px', textAlign: 'center' }}>{isMe ? 'YOU' : fmt(e.player, e.username)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Score list */}
            <div style={{ background: 'rgba(10,10,20,0.8)', border: `1px solid ${tab.accent}22`, borderRadius: '12px', overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#4b5563', fontSize: '12px', letterSpacing: '1px' }}>LOADING...</div>
              ) : entries.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎮</div>
                  <div style={{ color: '#4b5563', fontSize: '12px', letterSpacing: '1px' }}>NO SCORES YET</div>
                  <div style={{ color: '#374151', fontSize: '11px', marginTop: '6px' }}>Be the first to play</div>
                </div>
              ) : (
                entries.map((e, i) => {
                  const isMe  = address && e.player.toLowerCase() === address.toLowerCase();
                  const isNew = newEntries.has(e.player);
                  // Show this player's badges inline
                  const theirBadges = isMe && badges ? badges.badges.filter(b => b.game === gameTab).slice(0, 3) : [];
                  return (
                    <div key={`${e.player}-${i}`} style={{
                      padding: '12px 20px',
                      borderBottom: i < entries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      background: isMe ? `${tab.accent}0d` : isNew ? 'rgba(16,185,129,0.06)' : i === 0 ? `${tab.accent}06` : 'transparent',
                      outline:    isMe ? `1px solid ${tab.accent}40` : 'none',
                      animation:  isNew ? 'slideDown 0.4s ease-out' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                          <span style={{ fontSize: i < 3 ? '18px' : '13px', minWidth: '28px', textAlign: 'center', color: '#6b7280' }}>
                            {i < 3 ? MEDALS[i] : `#${i + 1}`}
                          </span>
                          <div>
                            <div style={{ color: isMe ? tab.accent : i === 0 ? '#fff' : '#d1d5db', fontSize: '13px', fontWeight: 700 }}>
                              {isMe ? 'YOU' : fmt(e.player, e.username)}
                              {isNew && <span style={{ color: '#10b981', fontSize: '9px', marginLeft: '6px' }}>NEW</span>}
                            </div>
                            <div style={{ color: '#4b5563', fontSize: '10px', marginTop: '2px' }}>{timeAgo(e.timestamp)}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: i === 0 ? tab.accent : '#fff', fontSize: '18px', fontWeight: 900 }}>{e.score}</div>
                          <div style={{ color: '#4b5563', fontSize: '10px' }}>pts</div>
                        </div>
                      </div>
                      {/* Inline badges for this player */}
                      {theirBadges.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '6px', paddingLeft: '42px' }}>
                          {theirBadges.map((b, bi) => <BadgeChip key={bi} badge={b} />)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ══ SEASON HISTORY tab ══════════════════════════════════════ */}
        {activeTab === 'history' && (
          <div>
            {!seasons ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#4b5563', fontSize: '12px' }}>LOADING...</div>
            ) : (
              <>
                {/* Current season live standings */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 700, letterSpacing: '2px' }}>
                      WEEK {seasons.currentSeason} — IN PROGRESS
                    </span>
                    <span style={{ color: '#374151', fontSize: '9px' }}>
                      ends {formatDate(seasons.currentEndsAt)}
                    </span>
                  </div>
                  <SeasonRow
                    season={{ season: seasons.currentSeason, startTs: 0, endTs: seasons.currentEndsAt, rhythm: seasons.live.rhythm, simon: seasons.live.simon }}
                    game={gameTab}
                    myAddress={address}
                    accent={GAME_ACCENT[gameTab]}
                  />
                </div>

                {/* Past sealed seasons */}
                {seasons.past.length === 0 ? (
                  <div style={{ padding: '30px', textAlign: 'center', color: '#374151', fontSize: '11px' }}>
                    No completed seasons yet — check back after Week 1 ends.
                  </div>
                ) : (
                  <>
                    <div style={{ color: '#4b5563', fontSize: '9px', letterSpacing: '2px', marginBottom: '10px' }}>COMPLETED SEASONS</div>
                    {seasons.past.map(s => (
                      <SeasonRow
                        key={s.season}
                        season={s}
                        game={gameTab}
                        myAddress={address}
                        accent={GAME_ACCENT[gameTab]}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Play buttons ────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <Link to="/rhythm" style={{
            flex: 1, padding: '12px', background: 'rgba(168,85,247,0.1)',
            border: '1px solid rgba(168,85,247,0.3)', borderRadius: '8px',
            color: '#a855f7', fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
            textDecoration: 'none', textAlign: 'center',
          }}>PLAY RHYTHM</Link>
          <Link to="/simon" style={{
            flex: 1, padding: '12px', background: 'rgba(6,182,212,0.1)',
            border: '1px solid rgba(6,182,212,0.3)', borderRadius: '8px',
            color: '#06b6d4', fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
            textDecoration: 'none', textAlign: 'center',
          }}>PLAY SIMON</Link>
        </div>
      </div>
    </>
  );
}
